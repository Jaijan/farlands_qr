/** Real multi-connection concurrency tests. Use ONLY a disposable migrated Supabase database. */
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
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
    console.log(
      'PASS: simultaneous same-participant exits, simultaneous returns, and independent two-gate scans.',
    );
  } finally {
    // Exact UUID-scoped cleanup; never truncate event tables.
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
