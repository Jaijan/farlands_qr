import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
let db: PGlite;
const admin = randomUUID(),
  v1 = randomUUID(),
  v2 = randomUUID();
let counter = 0;
async function query<T = Record<string, unknown>>(sql: string, args: unknown[] = []) {
  return (await db.query<T>(sql, args)).rows;
}
async function scalar(sql: string, args: unknown[] = []) {
  const rows = await query(sql, args);
  return Object.values(rows[0])[0] as any;
}
async function participant(extra: Record<string, string> = {}) {
  const n = ++counter;
  const phone = `+9198765${String(n).padStart(5, '0')}`;
  const details = {
    name: `Participant ${n}`,
    phone,
    email: `p${n}@example.com`,
    team_name: 'Alpha',
    college_name: 'College',
    alternate_contact: '+919876543211',
    ...extra,
  };
  const hash = String(n).padStart(64, '0');
  const batch = randomUUID();
  await scalar('select generate_qr_batch($1,$2,$3)', [
    admin,
    batch,
    JSON.stringify([{ hash, encrypted: 'encrypted-' + n }]),
  ]);
  const qr = await scalar('select id from qr_inventory where token_hash=$1', [hash]);
  const challenge = await scalar(
    "insert into registration_challenges(phone,details,attempts,qr_id,binding_hash,verified_at,verification_method) values($1,$2,1,$3,'binding',now(),'email') returning id",
    [details.phone, JSON.stringify(details), qr],
  );
  const p = await scalar('select complete_qr_claim($1,$2)', [challenge, 'binding']);
  return { ...p, hash, challenge, details, qr };
}
async function scan(p: { hash: string }, actor = v1, mode = 'auto', request = randomUUID()) {
  return scalar('select scan_participant($1,$2,$3,$4,$5)', [
    actor,
    actor === v1 ? 'lease-1' : 'lease-2',
    p.hash,
    mode,
    request,
  ]);
}
async function age(p: { id: string }) {
  await query("update participants set last_scan_at=now()-interval '6 seconds' where id=$1", [
    p.id,
  ]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`,
  );
  let sql = readFileSync('supabase/migrations/202610060001_core.sql', 'utf8')
    .replace('create extension if not exists pgcrypto;', '')
    .replace('alter publication supabase_realtime add table public.event_signal;', '');
  await db.exec(sql);
  await db.exec(readFileSync('supabase/migrations/202610060003_email_verification.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610100001_qr_inventory.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/202610100002_email_qr_claim.sql', 'utf8'));
  for (const id of [admin, v1, v2]) await query('insert into auth.users values($1)', [id]);
  await query(
    "insert into volunteers(id,name,username,role,assigned_exit) values($1,'Admin','admin@example.com','admin',null),($2,'Gate One','one@example.com','volunteer','exit_1'),($3,'Gate Two','two@example.com','volunteer','exit_2')",
    [admin, v1, v2],
  );
  await query('select change_registration($1,true)', [admin]);
  await query('select acquire_lease($1,$2)', [v1, 'lease-1']);
  await query('select acquire_lease($1,$2)', [v2, 'lease-2']);
});
afterAll(async () => {
  await db.close();
});
describe('migrated PostgreSQL behavior', () => {
  it('rejects old or phone-verified pending challenges after the email upgrade', async () => {
    const id = await scalar(
      "insert into registration_challenges(phone,details,binding_hash,verified_at,attempts) values('+919666666666','{}','binding',now(),1) returning id",
    );
    await expect(query('select complete_qr_claim($1,$2)', [id, 'binding'])).rejects.toThrow(
      /unverified/,
    );
    await query("update registration_challenges set verification_method='phone' where id=$1", [id]);
    await expect(query('select complete_qr_claim($1,$2)', [id, 'binding'])).rejects.toThrow(
      /unverified/,
    );
  });
  it('generates 300 unique inventory records without participants and retries the batch safely', async () => {
    const before = await scalar('select count(*)::int from participants');
    const batch = randomUUID();
    const codes = Array.from({ length: 300 }, (_, i) => ({
      hash: (10000 + i).toString(16).padStart(64, '0'),
      encrypted: `encrypted-${i}`,
    }));
    await query('select generate_qr_batch($1,$2,$3)', [admin, batch, JSON.stringify(codes)]);
    await query('select generate_qr_batch($1,$2,$3)', [admin, batch, JSON.stringify(codes)]);
    expect(await scalar('select count(*)::int from participants')).toBe(before);
    expect(
      await scalar(
        'select count(distinct serial_number)::int from qr_inventory where batch_id=$1',
        [batch],
      ),
    ).toBe(300);
    expect(
      await scalar('select count(distinct token_hash)::int from qr_inventory where batch_id=$1', [
        batch,
      ]),
    ).toBe(300);
    await expect(
      query('select generate_qr_batch($1,$2,$3)', [v1, randomUUID(), JSON.stringify(codes)]),
    ).rejects.toThrow(/Access denied/);
    await expect(query('select generate_qr_batch($1,$2,$3)', [admin, batch, '[]'])).rejects.toThrow(
      /request reuse/,
    );
  });
  it('returns an authorized consistent snapshot without QR secrets', async () => {
    const snapshot = await scalar('select monitor_snapshot($1,$2)', [v1, 'lease-1']);
    expect(snapshot.staff.id).toBe(v1);
    expect(snapshot.gates).toHaveLength(2);
    expect(snapshot.registration_open).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('lease_hash');
    expect(JSON.stringify(snapshot)).not.toContain('encrypted_token');
    await expect(scalar('select monitor_snapshot($1,$2)', [v1, 'wrong-lease'])).rejects.toThrow(
      /expired/,
    );
  });
  it('creates email-verified participants and sequential human IDs', async () => {
    const a = await participant(),
      b = await participant();
    expect(a.participant_code).toBe('FARL-0001');
    expect(b.participant_code).toBe('FARL-0002');
    expect(await scalar('select email_verified from participants where id=$1', [a.id])).toBe(true);
    expect(await scalar('select phone_verified from participants where id=$1', [a.id])).toBe(false);
    expect(
      await scalar('select count(*)::int from audit_logs where participant_id=$1', [a.id]),
    ).toBe(3);
  });
  it('rejects duplicate phone and email and consumed challenges', async () => {
    const p = await participant();
    await expect(participant({ phone: p.details.phone })).rejects.toThrow(/unique/);
    await expect(participant({ email: p.details.email })).rejects.toThrow(/unique/);
    expect((await scalar('select complete_qr_claim($1,$2)', [p.challenge, 'binding'])).id).toBe(
      p.id,
    );
  });
  it('enforces registration closure even after challenge creation', async () => {
    await query('select change_registration($1,false)', [admin]);
    await expect(participant()).rejects.toThrow(/closed/);
    await query('select change_registration($1,true)', [admin]);
  });
  it('binds verification to the QR and browser and rejects unverified or revoked claims', async () => {
    const qr = await scalar("select id from qr_inventory where status='unassigned' limit 1");
    const details = {
      name: 'Pending Person',
      phone: '+919111111111',
      email: 'pending@example.org',
      team_name: 'T',
      college_name: 'C',
      alternate_contact: '+919111111112',
    };
    const id = await scalar(
      "insert into registration_challenges(phone,details,qr_id,binding_hash,attempts,verification_method) values($1,$2,$3,'binding',1,'email') returning id",
      [details.phone, JSON.stringify(details), qr],
    );
    await expect(query('select complete_qr_claim($1,$2)', [id, 'wrong'])).rejects.toThrow(
      /invalid/,
    );
    await expect(query('select complete_qr_claim($1,$2)', [id, 'binding'])).rejects.toThrow(
      /unverified/,
    );
    expect(await scalar('select status from qr_inventory where id=$1', [qr])).toBe('unassigned');
    await query('update registration_challenges set verified_at=now() where id=$1', [id]);
    await query('select revoke_inventory_qr($1,$2)', [admin, qr]);
    const hash = await scalar('select token_hash from qr_inventory where id=$1', [qr]);
    await expect(scan({ hash })).rejects.toThrow(/revoked/);
    await expect(query('select complete_qr_claim($1,$2)', [id, 'binding'])).rejects.toThrow(
      /revoked/,
    );
    expect(
      await scalar('select count(*)::int from participants where phone=$1', [details.phone]),
    ).toBe(0);
  });
  it('rejects attendance scans of unassigned cards', async () => {
    const hash = await scalar(
      "select token_hash from qr_inventory where status='unassigned' limit 1",
    );
    await expect(scan({ hash })).rejects.toThrow(/not yet claimed/);
  });
  it('rejects a second verified claimant and leaves its record unconsumed', async () => {
    const p = await participant();
    const id = await scalar(
      "insert into registration_challenges(phone,details,qr_id,binding_hash,attempts,verified_at,verification_method) values('+919222222222',$1,$2,'binding',1,now(),'email') returning id",
      [JSON.stringify({ ...p.details, email: 'second@example.org' }), p.qr],
    );
    await expect(query('select complete_qr_claim($1,$2)', [id, 'binding'])).rejects.toThrow(
      /already claimed/,
    );
    expect(
      await scalar('select consumed_at from registration_challenges where id=$1', [id]),
    ).toBeNull();
  });
  it('keeps legacy participant QR and history intact', async () => {
    const p = await scalar(
      "insert into participants(name,phone,email,team_name,college_name,alternate_contact,phone_verified,email_verified,qr_token_hash) values('Legacy Person','+919333333333','legacy@example.org','T','C','+919333333334',false,true,'legacy-hash') returning id",
    );
    expect((await scan({ hash: 'legacy-hash' })).action).toBe('exit');
    await query('select change_qr($1,$2,$3,$4)', [admin, p, 'legacy-new', 'encrypted']);
    await expect(scan({ hash: 'legacy-hash' })).rejects.toThrow(/revoked/);
    expect(
      await scalar('select count(*)::int from exit_sessions where participant_id=$1', [p]),
    ).toBe(1);
  });
  it('limits OTP verification attempts and expired challenges', async () => {
    const id = await scalar(
      "insert into registration_challenges(phone,details) values('+919876543210','{}') returning id",
    );
    for (let i = 0; i < 5; i++) await query('select otp_attempt($1)', [id]);
    await expect(query('select otp_attempt($1)', [id])).rejects.toThrow(/attempt limit/);
    await query(
      "update registration_challenges set expires_at=now()-interval '1 second' where id=$1",
      [id],
    );
    await expect(query('select otp_attempt($1)', [id])).rejects.toThrow();
  });
  it('records exits and allows a return through the opposite exit', async () => {
    const p = await participant();
    expect((await scan(p)).action).toBe('exit');
    await age(p);
    const r = await scan(p, v2);
    expect(r.action).toBe('return');
    expect(r.session.exit_id).toBe('exit_1');
    expect(r.session.return_exit_id).toBe('exit_2');
    expect(r.session.return_method).toBe('qr');
    expect(await scalar('select status from participants where id=$1', [p.id])).toBe('inside');
  });
  it('deduplicates fast scans across both gates and retries by request ID', async () => {
    const p = await participant();
    const id = randomUUID();
    const first = await scan(p, v1, 'auto', id);
    expect((await scan(p, v2)).action).toBe('duplicate');
    expect(await scan(p, v1, 'auto', id)).toEqual(first);
    expect(
      await scalar('select count(*)::int from exit_sessions where participant_id=$1', [p.id]),
    ).toBe(1);
  });
  it('rejects request ID reuse with a different participant', async () => {
    const a = await participant(),
      b = await participant(),
      id = randomUUID();
    await scan(a, v1, 'exit', id);
    await expect(scan(b, v1, 'exit', id)).rejects.toThrow(/request reuse/);
  });
  it('rejects a second explicit exit and an explicit return while inside', async () => {
    const p = await participant();
    await expect(scan(p, v1, 'return')).rejects.toThrow(/currently inside/);
    await scan(p, v1, 'exit');
    await age(p);
    await expect(scan(p, v2, 'exit')).rejects.toThrow(/already outside/);
  });
  it('enforces the partial unique open-session constraint', async () => {
    const p = await participant();
    await scan(p);
    await expect(
      query("insert into exit_sessions(participant_id,exit_id) values($1,'exit_2')", [p.id]),
    ).rejects.toThrow(/unique/);
  });
  it('marks overdue server-side once and logs manual return actor', async () => {
    const p = await participant();
    await scan(p);
    await query(
      "update exit_sessions set exited_at=now()-interval '31 minutes' where participant_id=$1",
      [p.id],
    );
    await query('select mark_overdue()');
    await query('select mark_overdue()');
    expect(await scalar('select status from exit_sessions where participant_id=$1', [p.id])).toBe(
      'overdue',
    );
    expect(
      await scalar(
        "select count(*)::int from audit_logs where participant_id=$1 and action='participant_marked_overdue'",
        [p.id],
      ),
    ).toBe(1);
    await query('select manual_return($1,null,$2)', [admin, p.id]);
    expect(
      await scalar('select return_method from exit_sessions where participant_id=$1', [p.id]),
    ).toBe('manual');
    expect(
      await scalar(
        "select actor_id from audit_logs where participant_id=$1 and action='participant_manually_returned'",
        [p.id],
      ),
    ).toBe(admin);
    await expect(query('select manual_return($1,null,$2)', [admin, p.id])).rejects.toThrow(
      /currently inside/,
    );
  });
  it('revokes inventory QR and prevents replacement of printed credentials', async () => {
    const p = await participant();
    await expect(
      query('select change_qr($1,$2,$3,$4)', [admin, p.id, 'replacement', 'encrypted']),
    ).rejects.toThrow(/printed codes/);
    await query('select revoke_inventory_qr($1,$2)', [admin, p.qr]);
    await expect(scan(p)).rejects.toThrow(/revoked/);
    expect(await scalar('select status from qr_inventory where id=$1', [p.qr])).toBe('revoked');
    expect(
      await scalar('select count(*)::int from qr_secrets where participant_id=$1', [p.id]),
    ).toBe(0);
  });
  it('rejects unknown tokens and suspended participants', async () => {
    await expect(scan({ hash: 'missing' })).rejects.toThrow(/not found/);
    const p = await participant();
    await query("update participants set status='suspended' where id=$1", [p.id]);
    await expect(scan(p)).rejects.toThrow(/suspended/);
  });
  it('enforces staff authorization and two gate account limits', async () => {
    await expect(query('select change_registration($1,false)', [v1])).rejects.toThrow(
      /Access denied/,
    );
    await expect(query('select acquire_lease($1,$2)', [v1, 'new-lease'])).rejects.toThrow(
      /occupied/,
    );
    const outsider = randomUUID();
    await query('insert into auth.users values($1)', [outsider]);
    await expect(
      query(
        "insert into volunteers(id,name,username,role,assigned_exit) values($1,'Extra','extra@example.com','volunteer','exit_1')",
        [outsider],
      ),
    ).rejects.toThrow(/unique/);
    await expect(query('select require_actor($1,null)', [outsider])).rejects.toThrow(
      /Access denied/,
    );
  });
  it('publishes only an invalidation signal and blocks anonymous table/function access', async () => {
    const before = Number(await scalar('select version from event_signal'));
    await participant();
    expect(Number(await scalar('select version from event_signal'))).toBeGreaterThan(before);
    await db.exec('set role anon');
    await expect(query('select * from participants')).rejects.toThrow(/permission denied/);
    await expect(query('select * from qr_secrets')).rejects.toThrow(/permission denied/);
    await expect(query('select * from qr_inventory')).rejects.toThrow(/permission denied/);
    await expect(query('select * from qr_inventory_secrets')).rejects.toThrow(/permission denied/);
    await expect(query('select * from qr_batches')).rejects.toThrow(/permission denied/);
    await expect(query('select mark_overdue()')).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    await db.exec('set role authenticated');
    expect(await query('select * from event_signal')).toEqual([]);
    await expect(query('select * from participants')).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    await query("select set_config('request.jwt.claim.sub',$1,false)", [v1]);
    await db.exec('set role authenticated');
    expect((await query('select * from event_signal')).length).toBe(1);
    await db.exec('reset role');
  });
  it('rate limits durably', async () => {
    expect(await scalar("select take_rate('test',2,60)")).toBe(true);
    expect(await scalar("select take_rate('test',2,60)")).toBe(true);
    expect(await scalar("select take_rate('test',2,60)")).toBe(false);
  });
  it('expires leases and prevents further actions', async () => {
    await query(
      "update volunteer_sessions set last_seen_at=now()-interval '91 seconds' where volunteer_id=$1",
      [v1],
    );
    expect(await scalar('select valid_lease($1,$2)', [v1, 'lease-1'])).toBe(false);
    await expect(scan(await participant())).rejects.toThrow(/expired/);
    await query('select acquire_lease($1,$2)', [v1, 'replacement']);
    await query('select release_lease($1,$2)', [v1, 'replacement']);
    expect(await scalar('select valid_lease($1,$2)', [v1, 'replacement'])).toBe(false);
  });
});
