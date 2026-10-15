import { resolveTestBinary } from './lib/test-binaries.mjs';
// Starts a disposable PostgreSQL cluster. Never imports env.js or reads a
// configured database URL, and never connects to an existing database server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import pg from 'pg';
import { prepareMigrationHistory } from '../inventory/migration-history.js';

const binaries = dirname(resolveTestBinary('initdb'));
const node = process.execPath;
const root = await mkdtemp(join(tmpdir(), 'oms-migration-history-'));
const cleanEnv = { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C', TMPDIR: root, NODE_ENV: 'test', DMILLS_SKIP_DOTENV: 'true' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exit = child => child.exitCode !== null ? Promise.resolve(child.exitCode) : new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
let server, admin, pool;
try {
  for (const binary of ['initdb', 'postgres']) await access(join(binaries, binary));
  const init = spawn(join(binaries, 'initdb'), ['-D', join(root, 'data'), '-U', 'postgres', '--auth=trust', '--no-locale'], { env: cleanEnv, stdio: 'ignore' });
  assert.equal(await exit(init), 0, 'Owned PostgreSQL initialization must succeed');
  // Pick an ephemeral loopback port; fail safely if another process claims it.
  const probe = createServer();probe.listen(0, '127.0.0.1');await new Promise(resolve => probe.once('listening', resolve));
  const port = probe.address().port;await new Promise(resolve => probe.close(resolve));
  server = spawn(join(binaries, 'postgres'), ['-D', join(root, 'data'), '-h', '127.0.0.1', '-p', String(port), '-k', root], { env: cleanEnv, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Owned PostgreSQL exited before readiness');
    const candidate = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 200 });
    try { await candidate.connect();admin = candidate;break; }
    catch { await candidate.end().catch(() => {});await pause(100); }
  }
  assert.ok(admin, 'Owned PostgreSQL readiness timed out');
  await admin.query('CREATE DATABASE codexqa_test_migrations_history');
  const url = `postgresql://postgres@127.0.0.1:${port}/codexqa_test_migrations_history`;
  // Only the generated cluster's address reaches the application DB module.
  process.env.INVENTORY_DATABASE_URL = url;
  delete process.env.INVENTORY_DB_SSL;
  const { migrateInventory, inventoryPool } = await import('../inventory/db.js');
  pool = inventoryPool();
  await migrateInventory();
  const history = () => pool.query('SELECT name,checksum,verification_count FROM ci_schema_migration ORDER BY name');
  const first = (await history()).rows;
  assert.equal(first.length, 35);
  for (const row of first) {
    assert.match(row.checksum, /^[a-f0-9]{64}$/);
    assert.equal(Number(row.verification_count), 1);
  }
  await migrateInventory();
  const second = (await history()).rows;
  assert.ok(second.every(row => Number(row.verification_count) === 2));
  assert.deepEqual(second.map(({ name, checksum }) => ({ name, checksum })), first.map(({ name, checksum }) => ({ name, checksum })));
  // A changed historical checksum must fail before replaying any business DDL.
  await pool.query("UPDATE ci_schema_migration SET checksum=repeat('0',64) WHERE name=$1", [first[0].name]);
  await assert.rejects(migrateInventory, error => error.code === 'MIGRATION_CHECKSUM_MISMATCH');
  assert.ok((await history()).rows.every(row => Number(row.verification_count) === 2));
  await pool.query('UPDATE ci_schema_migration SET checksum=$2 WHERE name=$1', [first[0].name, first[0].checksum]);
  await pool.query("INSERT INTO ci_schema_migration(name,checksum) VALUES('999_future.sql',repeat('0',64))");
  await assert.rejects(migrateInventory, error => error.code === 'MIGRATION_HISTORY_AHEAD');
  await pool.query("DELETE FROM ci_schema_migration WHERE name='999_future.sql'");
  // Adopt an unjournaled existing schema only by successfully replaying the
  // same idempotent sequence; preserve its business rows.
  await pool.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES('history-fixture','KEEP','Keep existing data')");
  await pool.query('DROP TABLE ci_schema_migration');
  await migrateInventory();
  assert.equal((await history()).rows.length, 35);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ci_master_sku WHERE tenant_id='history-fixture'")).rows[0].n, 1);
  // Missing/duplicate manifest entries are rejected before database access.
  const noDatabase = { query() { throw Error('Must not contact database'); } };
  await assert.rejects(() => prepareMigrationHistory(noDatabase, [{ name: 'bad.sql', sql: 'SELECT 1' }]), { code: 'MIGRATION_MANIFEST_INVALID' });
  await assert.rejects(() => prepareMigrationHistory(noDatabase, [{ name: '001_a.sql', sql: 'SELECT 1' }, { name: '001_a.sql', sql: 'SELECT 2' }]), { code: 'MIGRATION_MANIFEST_INVALID' });
  // Existing owned fixture tests exercise concurrent runners, mid-sequence SQL
  // failure, preserved constraints/data, repair/retry and session-lock release.
  const child = spawn(node, ['scripts/verify-migration-recovery.mjs'], { env: { ...cleanEnv, INVENTORY_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  const code = await exit(child);
  assert.equal(code, 0, `Owned migration recovery checks failed: ${output.slice(-3000)}`);
  assert.match(output, /PASS migration recovery/);
  console.log(output.trim());
  console.log('PASS migration history: 35 checksums recorded, repeat verification retained, drift and newer history rejected, invalid manifests rejected, existing crash/concurrency/repair checks passed. Disposable PostgreSQL only.');
} finally {
  if (pool) await pool.end();
  if (admin) await admin.end();
  if (server && server.exitCode === null) { const stopped = exit(server);server.kill('SIGTERM');await stopped; }
  await rm(root, { recursive: true, force: true });
}
