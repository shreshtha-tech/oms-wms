import { resolveTestBinary, testBinaryPath } from './lib/test-binaries.mjs';
// Owns an entirely fresh loopback PostgreSQL process. No dotenv/configured DB use.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import pg from 'pg';
import { createPostgresConnection } from '../reliability/postgres-connection.js';
import { verifyInventorySummaryPostgres } from './verify-inventory-summary-postgres.mjs';
import { verifyPublicationRecoveryPostgres } from './verify-publication-recovery-postgres.mjs';
import { verifyReconciliationPagePostgres } from './verify-reconciliation-page-postgres.mjs';
import { verifyStockLockCleanupPostgres } from './verify-stock-lock-cleanup-postgres.mjs';
import { verifyPostgresCommitLoss } from './verify-postgres-commit-loss.mjs';
import { verifyReceiptClaimPlanPostgres } from './verify-receipt-claim-plan-postgres.mjs';

// Driver defaults must not inherit configured credentials or connection options.
for (const name of Object.keys(process.env)) if (name.startsWith('PG')) delete process.env[name];
const evidenceFile = new URL('../docs/hardening/postgres-failure-evidence.json', import.meta.url);
await mkdir(new URL('../docs/hardening/', import.meta.url), { recursive: true });
await writeFile(evidenceFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), status: 'RUNNING', layer: 'OWNED_FRESH_LOOPBACK_POSTGRES', runtime: process.version, results: [] }, null, 2)}\n`);
const root = await mkdtemp(join(tmpdir(), 'agon-pg-failures-'));
const port = randomInt(35001, 50000);
const database = `hardening_${Date.now().toString(36)}_test`;
const env = { PATH: testBinaryPath(), DMILLS_SKIP_DOTENV: 'true', LANG: 'C', TMPDIR: root };
const children = [], results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function launch(binary, args) {
  const child = spawn(binary, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', bytes => {
    const message = bytes.toString();
    if (/no space left/i.test(message)) child.failureCategory = 'ENOSPC';
    else if (/operation not permitted|permission denied/i.test(message)) child.failureCategory = 'FIXTURE_PERMISSION_DENIED';
  });
  child.on('error', error => { child.launchError = error; });
  children.push(child); return child;
}
const exited = child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve(child.exitCode) : new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
let admin, connection, held;
async function check(name, operation) {
  const start = performance.now();
  try { await operation(); results.push({ name, result: 'PASS', durationMs: Math.round(performance.now() - start) }); }
  catch (error) { results.push({ name, result: 'FAIL', errorCategory: error.code || error.name }); throw error; }
}
try {
  const init = launch(resolveTestBinary('initdb'), ['-D', join(root, 'pg'), '-U', 'postgres', '--auth=trust', '--no-locale']);
  if (await exited(init) !== 0) throw Object.assign(new Error('Owned PostgreSQL initialization failed'), { code: init.failureCategory || 'FIXTURE_INIT_FAILED' });
  const server = launch(resolveTestBinary('postgres'), ['-D', join(root, 'pg'), '-h', '127.0.0.1', '-p', String(port), '-k', root]);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.launchError || server.exitCode !== null) throw new Error('Owned PostgreSQL process failed');
    admin = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 300 });
    try { await admin.connect(); break; } catch { await admin.end().catch(() => {}); admin = null; await pause(100); }
  }
  if (!admin) throw new Error('Owned PostgreSQL startup timed out');
  await admin.query(`CREATE DATABASE "${database}"`);
  connection = createPostgresConnection({ host: '127.0.0.1', port, user: 'postgres', database, max: 1, connectionTimeoutMillis: 150, statement_timeout: 150 });
  await connection.pool.query('CREATE TABLE integrity_fixture (id integer PRIMARY KEY, value integer NOT NULL)');
  await connection.pool.query('INSERT INTO integrity_fixture VALUES (1,42)');
  await check('pool-exhaustion-and-acquisition-recovery', async () => {
    held = await connection.pool.connect();
    await assert.rejects(connection.pool.connect(), error => error.status === 503 && error.code === 'DATABASE_UNAVAILABLE');
    assert.equal(connection.status().state, 'DEGRADED');
    held.release(); held = null;
    await connection.probe(); assert.equal(connection.status().state, 'READY');
  });
  await check('statement-timeout-and-transaction-rollback', async () => {
    held = await connection.pool.connect();
    await held.query('BEGIN'); await held.query('UPDATE integrity_fixture SET value=99 WHERE id=1');
    await assert.rejects(held.query('SELECT pg_sleep(1)'), error => error.status === 504 && error.code === 'DATABASE_TIMEOUT');
    await held.query('ROLLBACK'); held.release(); held = null;
    assert.equal((await connection.pool.query('SELECT value FROM integrity_fixture WHERE id=1')).rows[0].value, 42);
  });
  await check('terminated-active-backend-rolls-back-and-recovers', async () => {
    held = await connection.pool.connect();
    await held.query('BEGIN'); await held.query('UPDATE integrity_fixture SET value=100 WHERE id=1');
    const pid = (await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pending = assert.rejects(held.query('SELECT pg_sleep(1)'), error => error.status === 503 && error.code === 'DATABASE_UNAVAILABLE');
    await admin.query('SELECT pg_terminate_backend($1)', [pid]); await pending;
    held.release(true); held = null;
    await connection.probe();
    assert.equal((await connection.pool.query('SELECT value FROM integrity_fixture WHERE id=1')).rows[0].value, 42);
  });
  await check('business-constraint-not-retried-or-misclassified', async () => {
    await assert.rejects(connection.pool.query('INSERT INTO integrity_fixture VALUES(1,99)'), error => error.code === '23505');
    assert.equal((await connection.pool.query('SELECT count(*)::int AS count FROM integrity_fixture')).rows[0].count, 1);
  });
  await check('idle-transaction-termination-rolls-back-and-recovers', async () => {
    held = await connection.pool.connect();
    let timer;
    const terminated = new Promise((resolve, reject) => {
      held.once('error', resolve);
      timer = setTimeout(() => reject(new Error('Owned idle transaction was not terminated')), 3000);
    });
    try {
      await held.query('BEGIN');
      await held.query('SET LOCAL idle_in_transaction_session_timeout = 150');
      await held.query('UPDATE integrity_fixture SET value=101 WHERE id=1');
      const error = await terminated;
      assert.equal(error.code, '25P03');
      await assert.rejects(held.query('SELECT 1'), error => error.code === 'DATABASE_UNAVAILABLE');
    } finally { clearTimeout(timer); held.release(true); held = null; }
    await connection.probe();
    assert.equal((await connection.pool.query('SELECT value FROM integrity_fixture WHERE id=1')).rows[0].value, 42);
  });
  await check('aggregate-inventory-summary-tenant-and-stock-semantics', async () => {
    held = await connection.pool.connect();
    try { await verifyInventorySummaryPostgres(held); }
    finally { held.release(true); held = null; }
  });
  await check('publication-recovery-bounds-lock-skipping-rollback-and-tenant-isolation', async () => {
    await verifyPublicationRecoveryPostgres({ host: '127.0.0.1', port, user: 'postgres', database, connectionTimeoutMillis: 1000 });
  });
  const serverVersion = (await connection.pool.query('SHOW server_version')).rows[0].server_version;
  await check('reconciliation-keyset-pages-cover-wrap-and-isolate-tenants', async () => {
    held = await connection.pool.connect();
    try { await verifyReconciliationPagePostgres(held); }
    finally { held.release(true); held = null; }
  });
  const idleTransactionTimeout = (await connection.pool.query('SHOW idle_in_transaction_session_timeout')).rows[0].idle_in_transaction_session_timeout;
  await check('stock-lock-backend-loss-preserves-result-and-recovers-pool', async () => {
    await verifyStockLockCleanupPostgres({ host: '127.0.0.1', port, user: 'postgres', database, connectionTimeoutMillis: 1000 });
  });
  await check('actual-commit-ack-loss-is-uncertain-with-one-committed-result', async () => {
    await verifyPostgresCommitLoss({ host: '127.0.0.1', port, user: 'postgres', database, connectionTimeoutMillis: 1000 });
  });
  let receiptClaimPlan;
  await check('receipt-result-claim-plan-under-disposable-backlog', async () => {
    receiptClaimPlan = await verifyReceiptClaimPlanPostgres({ host: '127.0.0.1', port, user: 'postgres', database, connectionTimeoutMillis: 1000 });
  });
  await check('readiness-detects-missing-publication-column', async () => {
    const readinessDatabase = `readiness_${Date.now().toString(36)}_test`;
    await admin.query(`CREATE DATABASE "${readinessDatabase}"`);
    process.env.INVENTORY_DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/${readinessDatabase}`;
    const { inventoryPool, migrateInventory } = await import('../inventory/db.js');
    const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
    const sql = source.match(/inventoryPool\(\)\.query\(`(SELECT[\s\S]*?AS schema_ready)`\)/)?.[1];
    assert.ok(sql, 'Extract the mounted readiness SQL');
    try {
      await migrateInventory();
      assert.equal((await inventoryPool().query(sql)).rows[0].schema_ready, true);
      // The owned fixture is torn down after this final check. Removing one
      // publication column must turn readiness off before that endpoint 500s.
      await inventoryPool().query('ALTER TABLE ci_outbox DROP COLUMN provider_response_reference');
      assert.equal((await inventoryPool().query(sql)).rows[0].schema_ready, false);
    } finally {
      await inventoryPool().end();
      delete process.env.INVENTORY_DATABASE_URL;
    }
  });
  await connection.pool.end();
  assert.equal(connection.status().state, 'STOPPED'); connection = null;
  await mkdir(new URL('../docs/hardening/', import.meta.url), { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), status: 'PASS', layer: 'OWNED_FRESH_LOOPBACK_POSTGRES', runtime: process.version, serverVersion, fixtureConfiguration: { maxConnections: 1, acquisitionTimeoutMs: 150, statementTimeoutMs: 150, idleTransactionInjectionMs: 150 }, idleTransactionTimeout, receiptClaimPlan, results, limitations: ['Test deadlines override production defaults.', 'No configured store, inventory ledger, provider, HTTP server, staging or production accessed.', 'No load capacity, percentile SLO, full database outage/restart or restore claim.'] }, null, 2)}\n`);
  console.log(JSON.stringify({ result: 'PASS', checks: results.length, evidence: 'docs/hardening/postgres-failure-evidence.json' }));
} catch (error) {
  await writeFile(evidenceFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), status: 'FAIL', layer: 'OWNED_FRESH_LOOPBACK_POSTGRES', runtime: process.version, errorCategory: error.code || error.name, results }, null, 2)}\n`);
  console.error('Owned PostgreSQL verification failed', { category: error.code || error.name, message: error.name === 'AssertionError' ? 'Acceptance assertion failed' : 'Fixture setup or execution unavailable' });
  process.exitCode = 1;
} finally {
  held?.release(true); await connection?.pool.end().catch(() => {}); await admin?.end().catch(() => {});
  for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null && !child.launchError) {
    const done = exited(child); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await done.catch(() => {}); clearTimeout(timer);
  }
  await rm(root, { recursive: true, force: true });
  console.log('Owned disposable PostgreSQL process and directory removed.');
}
