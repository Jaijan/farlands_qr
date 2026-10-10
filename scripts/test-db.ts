/** Real multi-connection concurrency tests. Use ONLY a disposable migrated Supabase database. */
import { Client } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a disposable migrated Supabase database.');
const a = new Client({ connectionString: url }),
  b = new Client({ connectionString: url });
const admin = randomUUID(),
  v1 = randomUUID(),
  v2 = randomUUID(),
  p = randomUUID(),
  p2 = randomUUID(),
  prefix = `test-${randomUUID()}`;
const batch = randomUUID();
const claimed: string[] = [];
const challenges: string[] = [];
async function main() {
  await a.connect();
  await b.connect();
  try {
    // Refuse to mix synthetic fixtures with real event records.
    const existing = await a.query(
      'select (select count(*) from participants)+(select count(*) from volunteers) as n',
    );
    assert.equal(Number(existing.rows[0].n), 0, 'Use an EMPTY disposable database.');
    await a.query('insert into auth.users(id) values($1),($2),($3)', [admin, v1, v2]);
    await a.query(
      "insert into volunteers(id,name,username,role,assigned_exit) values($1,'Test admin',$4,'admin',null),($2,'Test gate 1',$5,'volunteer','exit_1'),($3,'Test gate 2',$6,'volunteer','exit_2')",
      [admin, v1, v2, `${prefix}-a`, `${prefix}-1`, `${prefix}-2`],
    );
    await a.query(
      "insert into participants(id,name,phone,email,team_name,college_name,alternate_contact,phone_verified,qr_token_hash) values($1,'Concurrency One','+919000000001',$3,'Test','Test','+919000000009',true,$4),($2,'Concurrency Two','+919000000002',$5,'Test','Test','+919000000009',true,$6)",
      [
        p,
        p2,
        `${prefix}@example.com`,
        `${prefix}-hash`,
        `${prefix}-2@example.com`,
        `${prefix}-hash2`,
      ],
    );
    await a.query('select acquire_lease($1,$2)', [v1, `${prefix}-lease1`]);
    await a.query('select acquire_lease($1,$2)', [v2, `${prefix}-lease2`]);
    await a.query('select change_registration($1,true)', [admin]);
    const claimHash = createHash('sha256').update(prefix).digest('hex');
    await a.query('select generate_qr_batch($1,$2,$3)', [
      admin,
      batch,
      JSON.stringify([{ hash: claimHash, encrypted: 'test-encrypted' }]),
    ]);
    const qr = (await a.query('select id from qr_inventory where batch_id=$1', [batch])).rows[0].id;
    for (let i = 0; i < 2; i++) {
      const details = {
        name: `Claim ${i}`,
        phone: `+91944444444${i}`,
        email: `${prefix}-claim${i}@example.org`,
        team_name: 'Test',
        college_name: 'Test',
        alternate_contact: '+919444444449',
      };
      const result = await a.query(
        "insert into registration_challenges(phone,details,qr_id,binding_hash,verified_at,attempts) values($1,$2,$3,'binding',now(),1) returning id",
        [details.phone, JSON.stringify(details), qr],
      );
      challenges.push(result.rows[0].id);
    }
    const claims = await Promise.allSettled([
      a.query('select complete_qr_claim($1,$2) as result', [challenges[0], 'binding']),
      b.query('select complete_qr_claim($1,$2) as result', [challenges[1], 'binding']),
    ]);
    for (const result of claims)
      if (result.status === 'fulfilled') claimed.push(result.value.rows[0].result.id);
    assert.equal(claimed.length, 1, 'Only one concurrent claimant may succeed');
    const rejected = claims.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.match(rejected.reason.message, /already claimed/);
    assert.equal(
      Number(
        (await a.query('select count(*) from participants where qr_token_hash=$1', [claimHash]))
          .rows[0].count,
      ),
      1,
    );
    const scan = (c: Client, actor: string, lease: string, hash: string, mode = 'auto') =>
      c.query('select scan_participant($1,$2,$3,$4,$5) as result', [
        actor,
        lease,
        hash,
        mode,
        randomUUID(),
      ]);
    const results = await Promise.all([
      scan(a, v1, `${prefix}-lease1`, `${prefix}-hash`),
      scan(b, v2, `${prefix}-lease2`, `${prefix}-hash`),
    ]);
    assert.deepEqual(results.map((r) => r.rows[0].result.action).sort(), ['duplicate', 'exit']);
    assert.equal(
      Number(
        (
          await a.query(
            'select count(*) from exit_sessions where participant_id=$1 and returned_at is null',
            [p],
          )
        ).rows[0].count,
      ),
      1,
    );
    await a.query("update participants set last_scan_at=now()-interval '6 seconds' where id=$1", [
      p,
    ]);
    const returnResults = await Promise.all([
      scan(a, v1, `${prefix}-lease1`, `${prefix}-hash`, 'return'),
      scan(b, v2, `${prefix}-lease2`, `${prefix}-hash`, 'return'),
    ]);
    assert.deepEqual(returnResults.map((r) => r.rows[0].result.action).sort(), [
      'duplicate',
      'return',
    ]);
    await a.query("update participants set last_scan_at=now()-interval '6 seconds' where id=$1", [
      p,
    ]);
    await Promise.all([
      scan(a, v1, `${prefix}-lease1`, `${prefix}-hash`, 'exit'),
      scan(b, v2, `${prefix}-lease2`, `${prefix}-hash2`, 'exit'),
    ]);
    assert.equal(
      Number(
        (await a.query('select count(*) from exit_sessions where returned_at is null')).rows[0]
          .count,
      ),
      2,
    );
    const manual = await Promise.allSettled([
      a.query('select manual_return($1,$2,$3)', [v1, `${prefix}-lease1`, p]),
      b.query('select manual_return($1,$2,$3)', [v2, `${prefix}-lease2`, p]),
    ]);
    assert.equal(manual.filter((r) => r.status === 'fulfilled').length, 1);
    assert.match(
      (manual.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message,
      /currently inside/,
    );
    assert.equal(
      Number(
        (
          await a.query(
            "select count(*) from audit_logs where participant_id=$1 and action='participant_manually_returned'",
            [p],
          )
        ).rows[0].count,
      ),
      1,
    );
    await a.query('select release_lease($1,$2)', [v1, `${prefix}-lease1`]);
    const leases = await Promise.allSettled([
      a.query('select acquire_lease($1,$2)', [v1, `${prefix}-new1`]),
      b.query('select acquire_lease($1,$2)', [v1, `${prefix}-new2`]),
    ]);
    assert.equal(leases.filter((r) => r.status === 'fulfilled').length, 1);
    assert.match(
      (leases.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message,
      /occupied/,
    );
    console.log(
      'PASS: concurrent QR claims, same-participant exits/returns, independent two-gate scans, manual returns, and exclusive gate leases.',
    );
  } finally {
    // Exact UUID-scoped cleanup; never truncate event tables.
    await a.query('delete from registration_challenges where id=any($1::uuid[])', [challenges]);
    await a.query(
      'delete from qr_inventory_secrets where qr_id in (select id from qr_inventory where batch_id=$1)',
      [batch],
    );
    await a.query('delete from qr_inventory where batch_id=$1', [batch]);
    await a.query('delete from qr_batches where id=$1', [batch]);
    await a.query('delete from qr_secrets where participant_id=any($1::uuid[])', [claimed]);
    await a.query('delete from audit_logs where participant_id=any($1::uuid[])', [claimed]);
    await a.query('delete from participants where id=any($1::uuid[])', [claimed]);
    await a.query('delete from scan_requests where participant_id=any($1::uuid[])', [[p, p2]]);
    await a.query(
      'delete from audit_logs where actor_id=any($1::uuid[]) or participant_id=any($2::uuid[])',
      [
        [admin, v1, v2],
        [p, p2],
      ],
    );
    await a.query('delete from exit_sessions where participant_id=any($1::uuid[])', [[p, p2]]);
    await a.query('delete from participants where id=any($1::uuid[])', [[p, p2]]);
    await a.query('delete from volunteer_sessions where volunteer_id=any($1::uuid[])', [[v1, v2]]);
    await a.query('delete from volunteers where id=any($1::uuid[])', [[admin, v1, v2]]);
    await a.query('delete from auth.users where id=any($1::uuid[])', [[admin, v1, v2]]);
    await a.end();
    await b.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
