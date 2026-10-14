// Rehearse the configured loopback inventory schema on an owned PostgreSQL
// process. --with-data copies rows only into the private disposable fixture.
import '../env.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import pg from 'pg';

const raw = process.env.INVENTORY_DATABASE_URL;
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--with-data')) throw new Error('Only --with-data is supported');
const withData = args[0] === '--with-data';
if (!raw) throw new Error('INVENTORY_DATABASE_URL is not configured');
const source = new URL(raw);
if (!['127.0.0.1', 'localhost', '::1'].includes(source.hostname)) {
  throw new Error('This rehearsal accepts only a configured loopback source');
}
const database = decodeURIComponent(source.pathname.slice(1));
if (!database || !/^[A-Za-z0-9_-]+$/.test(database)) throw new Error('Invalid source database selection');

const root = await mkdtemp(join(tmpdir(), 'agon-schema-rehearsal-'));
const port = randomInt(35001, 50000);
const baseEnv = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'C', TMPDIR: root };
const sourceEnv = { ...baseEnv, PGHOST: source.hostname, PGPORT: source.port || '5432',
  PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password),
  PGDATABASE: database, PGSSLMODE: process.env.INVENTORY_DB_SSL === 'true' ? 'verify-full' : 'prefer' };
const targetEnv = { ...baseEnv, PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'postgres', PGDATABASE: 'rehearsal_test' };
const children = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function launch(command, args, env, stdio = ['ignore', 'ignore', 'ignore']) {
  const child = spawn(command, args, { env, stdio });
  children.push(child);
  return child;
}
function exited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
}
async function ledgerFingerprints(db) {
  const tables = [
    ['ci_inventory_event', 't.id'],
    ['ci_inventory_balance', 't.tenant_id,t.master_sku_id,t.location_id'],
    ['ci_reservation', 't.id'],
    ['ci_unified_order', 't.id'],
  ];
  const output = {};
  for (const [table, order] of tables) {
    const row = (await db.query(`SELECT count(*)::int AS rows,
      md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY ${order}), '')) AS fingerprint
      FROM ${table} t`)).rows[0];
    output[table] = row;
  }
  return output;
}
let admin, client, sourceClient, fixturePool;
try {
  const init = launch('/opt/homebrew/bin/initdb', ['-D', join(root, 'pg'), '-U', 'postgres', '--auth=trust', '--no-locale'], baseEnv);
  assert.equal(await exited(init), 0, 'Owned PostgreSQL initialization failed');
  const server = launch('/opt/homebrew/bin/postgres', ['-D', join(root, 'pg'), '-h', '127.0.0.1', '-p', String(port), '-k', root], baseEnv);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Owned PostgreSQL process exited');
    admin = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 300 });
    try { await admin.connect(); break; }
    catch { await admin.end().catch(() => {}); admin = null; await pause(100); }
  }
  assert.ok(admin, 'Owned PostgreSQL did not start');
  await admin.query('CREATE DATABASE rehearsal_test');

  if (withData) {
    const archive = join(root, 'source.backup');
    // mkdtemp creates a private directory; the child also creates its file
    // with a restrictive umask, and the archive is removed in finally.
    process.umask(0o077);
    const dump = launch('/opt/homebrew/bin/pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', archive], sourceEnv);
    assert.equal(await exited(dump), 0, 'Data-bearing dump of configured source failed');
    assert.equal((await stat(archive)).mode & 0o077, 0, 'Temporary archive permissions must exclude other users');
    const restore = launch('/opt/homebrew/bin/pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', 'rehearsal_test', archive], targetEnv);
    assert.equal(await exited(restore), 0, 'Data-bearing restore into owned fixture failed');
  } else {
    const dump = launch('/opt/homebrew/bin/pg_dump', ['--schema-only', '--no-owner', '--no-privileges'], sourceEnv, ['ignore', 'pipe', 'ignore']);
    const restore = launch('/opt/homebrew/bin/psql', ['-X', '--set', 'ON_ERROR_STOP=1', '--quiet'], targetEnv, ['pipe', 'ignore', 'ignore']);
    dump.stdout.pipe(restore.stdin);
    const [dumpCode, restoreCode] = await Promise.all([exited(dump), exited(restore)]);
    assert.equal(dumpCode, 0, 'Schema-only dump of configured source failed');
    assert.equal(restoreCode, 0, 'Schema-only restore into owned fixture failed');
  }

  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'rehearsal_test', connectionTimeoutMillis: 1000 });
  await client.connect();
  const before = await client.query("SELECT to_regclass('public.ci_master_sku') IS NOT NULL AS has_sku, to_regclass('public.ci_outbox') IS NOT NULL AS has_outbox");
  assert.equal(before.rows[0].has_sku, true);
  assert.equal(before.rows[0].has_outbox, true);
  const skuRows = (await client.query('SELECT count(*)::int AS count FROM ci_master_sku')).rows[0].count;
  const outboxRows = (await client.query('SELECT count(*)::int AS count FROM ci_outbox')).rows[0].count;
  const accountRows = (await client.query('SELECT count(*)::int AS count FROM ci_channel_account')).rows[0].count;
  if (withData) {
    sourceClient = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 3000, statement_timeout: 5000,
      ssl: process.env.INVENTORY_DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
    await sourceClient.connect();
    await sourceClient.query('BEGIN READ ONLY');
    for (const [table, count] of [['ci_master_sku', skuRows], ['ci_outbox', outboxRows], ['ci_channel_account', accountRows]]) {
      assert.equal((await sourceClient.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, count, `Restored ${table} row count differs`);
    }
  } else {
    assert.equal(skuRows, 0, 'Schema-only clone must contain no source SKUs');
    assert.equal(outboxRows, 0, 'Schema-only clone must contain no source tasks');
  }
  const beforeLedger = withData ? await ledgerFingerprints(client) : null;
  const authorityBefore = withData ? (await client.query(`SELECT
    count(*) FILTER (WHERE platform IN ('woocommerce','amazon') AND settings->>'providerAuthoritative'='true')::int AS supported_enabled,
    count(*) FILTER (WHERE platform IN ('woocommerce','amazon') AND settings->>'providerAuthoritative' IS DISTINCT FROM 'true')::int AS supported_eligible,
    count(*) FILTER (WHERE platform NOT IN ('woocommerce','amazon') AND settings->>'providerAuthoritative'='true')::int AS unrelated_enabled
    FROM ci_channel_account`)).rows[0] : null;

  process.env.INVENTORY_DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/rehearsal_test`;
  const { migrateInventory, inventoryPool } = await import('../inventory/db.js');
  fixturePool = inventoryPool();
  await migrateInventory();
  const serverSource = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const readinessSql = serverSource.match(/inventoryPool\(\)\.query\(`(SELECT[\s\S]*?AS schema_ready)`\)/)?.[1];
  assert.ok(readinessSql, 'Mounted readiness SQL not found');
  assert.equal((await fixturePool.query(readinessSql)).rows[0].schema_ready, true);
  if (withData) {
    assert.deepEqual(await ledgerFingerprints(fixturePool), beforeLedger,
      'Migration must preserve ledger, balance, reservation, and order rows');
    assert.equal((await fixturePool.query('SELECT count(*)::int AS count FROM ci_master_sku')).rows[0].count, skuRows);
    assert.equal((await fixturePool.query('SELECT count(*)::int AS count FROM ci_channel_account')).rows[0].count, accountRows);
    const authority = (await fixturePool.query(`SELECT
      count(*) FILTER (WHERE platform IN ('woocommerce','amazon') AND settings->>'providerAuthoritative'='true')::int AS supported_enabled,
      count(*) FILTER (WHERE platform NOT IN ('woocommerce','amazon') AND settings->>'providerAuthoritative'='true')::int AS unrelated_enabled
      FROM ci_channel_account`)).rows[0];
    assert.equal(authority.supported_enabled, authorityBefore.supported_enabled + authorityBefore.supported_eligible,
      'Stage 1 cutover must preserve supported existing accounts');
    assert.ok(authority.unrelated_enabled <= authorityBefore.unrelated_enabled,
      'Stage 1 cutover must not grant authority to unrelated platforms');
    const unrelated = (await fixturePool.query(`SELECT tenant_id,id FROM ci_channel_account
      WHERE platform NOT IN ('woocommerce','amazon') ORDER BY id LIMIT 2`)).rows;
    if (unrelated.length === 2) {
      for (const [index, account] of unrelated.entries()) {
        await fixturePool.query(`UPDATE ci_channel_account SET
          settings=settings||'{"providerAuthoritative":true}'::jsonb,
          provider_authority_revision=1 WHERE tenant_id=$1 AND id=$2`, [account.tenant_id, account.id]);
        await fixturePool.query(`INSERT INTO ci_provider_authority_audit
          (tenant_id,account_id,previous_value,new_value,revision,actor,reason)
          VALUES($1,$2,false,true,1,$3,'Disposable correction fixture')`,
        [account.tenant_id, account.id, index === 0 ? 'owner_stage_1_policy' : 'synthetic_operator']);
      }
      await migrateInventory();
      const corrected = await fixturePool.query(`SELECT settings->>'providerAuthoritative' AS enabled,
        provider_authority_revision AS revision FROM ci_channel_account WHERE tenant_id=$1 AND id=$2`,
      [unrelated[0].tenant_id, unrelated[0].id]);
      const preserved = await fixturePool.query(`SELECT settings->>'providerAuthoritative' AS enabled,
        provider_authority_revision AS revision FROM ci_channel_account WHERE tenant_id=$1 AND id=$2`,
      [unrelated[1].tenant_id, unrelated[1].id]);
      assert.deepEqual(corrected.rows[0], { enabled: 'false', revision: '2' }, 'Old automatic grant must be corrected once');
      assert.deepEqual(preserved.rows[0], { enabled: 'true', revision: '1' }, 'Explicit operator decision must remain');
      const audit = await fixturePool.query(`SELECT actor FROM ci_provider_authority_audit
        WHERE tenant_id=$1 AND account_id=$2 AND revision=2`, [unrelated[0].tenant_id, unrelated[0].id]);
      assert.equal(audit.rows[0]?.actor, 'migration_029_scope');
    }
  }
  console.log(JSON.stringify({ result: 'PASS', source: withData ? 'CONFIGURED_LOOPBACK_SNAPSHOT' : 'CONFIGURED_LOOPBACK_SCHEMA_ONLY',
    target: 'OWNED_FRESH_LOOPBACK_POSTGRES', skuRows, outboxRows, accountRows,
    migrationsApplied: 29, readiness: true, ledgerRowsPreserved: withData,
    supportedAuthorityNewGrants: authorityBefore?.supported_eligible ?? null }));
} catch (error) {
  console.log(JSON.stringify({ result: 'FAIL', source: withData ? 'CONFIGURED_LOOPBACK_SNAPSHOT' : 'CONFIGURED_LOOPBACK_SCHEMA_ONLY',
    category: error?.code || error?.name || 'UNKNOWN', stage: /dump|restore/i.test(error?.message || '') ? 'TRANSFER' : 'MIGRATION_OR_READINESS' }));
  process.exitCode = 1;
} finally {
  delete process.env.INVENTORY_DATABASE_URL;
  await fixturePool?.end().catch(() => {});
  await sourceClient?.query('ROLLBACK').catch(() => {});
  await sourceClient?.end().catch(() => {});
  await client?.end().catch(() => {});
  await admin?.end().catch(() => {});
  for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) {
    const done = exited(child); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await done.catch(() => {}); clearTimeout(timer);
  }
  await rm(root, { recursive: true, force: true });
  console.log('Owned schema rehearsal process and directory removed.');
}
