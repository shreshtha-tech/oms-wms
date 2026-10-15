import { resolveTestBinary, testBinaryPath } from './lib/test-binaries.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
import pg from 'pg';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';

const suite = process.argv[2] || 'scripts/verify-phase-b-stack.mjs';
const allowed = new Set(['scripts/verify-phase-b-stack.mjs', 'scripts/verify-phase-b-propagation.mjs', 'scripts/verify-phase-b-dispatch.mjs', 'scripts/verify-seller-connections.mjs', 'scripts/verify-session-recovery.mjs', 'scripts/measure-owned-ledger-contention.mjs', 'scripts/verify-receipt-claim-mongo-plan.mjs', 'scripts/measure-receipt-claim-backlog.mjs', 'scripts/verify-partial-reservations.mjs', 'scripts/verify-central-inventory.mjs', 'scripts/verify-variant-identity-db.mjs']);
if (!allowed.has(suite)) throw new Error('Unapproved isolated suite');
const directory = await mkdtemp(join(tmpdir(), 'dmills-phase-b-'));
const nativeEnv = { PATH: testBinaryPath(), DMILLS_SKIP_DOTENV: 'true', LANG: 'C', TMPDIR: directory };
const mongoPort = randomInt(20000, 35000), pgPort = randomInt(35001, 50000);
const name = `${suite === 'scripts/verify-session-recovery.mjs' ? 'codexqa_test_sessions' : 'phase_b'}_${Date.now().toString(36)}_test`;
const env = { ...nativeEnv, NODE_ENV: 'test', MONGODB_DB: name,
  MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}/${name}?replicaSet=phase_b`,
  INVENTORY_DATABASE_URL: `postgresql://127.0.0.1:${pgPort}/${name}`,
  DMILLS_REQUIRE_PERSISTENCE: 'true', NODE_OPTIONS: `--import=${pathToFileURL(resolve('scripts/isolated-stack-preload.mjs')).href}` };
validateTestStores(env);
const processes = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function launch(binary, args) {
  const child = spawn(binary, args, { env: nativeEnv, stdio: ['ignore','ignore','pipe'] });
  child.startupStderr = ''; child.stderr.on('data', chunk => { child.startupStderr = (child.startupStderr + String(chunk)).slice(-2000); });
  child.startError = null; child.on('error', () => { child.startError = true; });
  processes.push(child); return child;
}
async function exited(child) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => { child.once('error', () => reject(new Error('Isolated process launch failed'))); child.once('exit', resolve); });
}
let mongo, admin;
try {
  const init = launch(resolveTestBinary('initdb'), ['-D', join(directory, 'pg'), '-U', 'postgres', '--auth=trust', '--no-locale']);
  if (await exited(init) !== 0) throw new Error('Disposable PostgreSQL initialization failed');
  const postgres = launch(resolveTestBinary('postgres'), ['-D', join(directory, 'pg'), '-h', '127.0.0.1', '-p', String(pgPort), '-k', directory]);
  const mongod = launch(resolveTestBinary('mongod'), ['--replSet', 'phase_b', '--dbpath', directory, '--port', String(mongoPort), '--bind_ip', '127.0.0.1', '--nounixsocket', '--logpath', join(directory, 'mongo.log')]);
  mongo = new MongoClient(`mongodb://127.0.0.1:${mongoPort}/?directConnection=true`, { serverSelectionTimeoutMS: 300 });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (mongod.startError || postgres.startError || mongod.exitCode !== null || postgres.exitCode !== null) throw new Error(`Disposable database process failed: postgres=${postgres.exitCode}, mongod=${mongod.exitCode}; postgres stderr=${postgres.startupStderr || '(empty)'}, mongod stderr=${mongod.startupStderr || '(empty)'}`);
    try { await mongo.connect(); await mongo.db('admin').command({ ping: 1 }); ready = true; break; } catch { await pause(100); }
  }
  if (!ready) throw new Error('Disposable Mongo startup timeout');
  await mongo.db('admin').command({ replSetInitiate: { _id: 'phase_b', members: [{ _id: 0, host: `127.0.0.1:${mongoPort}` }] } });
  ready = false;
  for (let i = 0; i < 100; i++) { if ((await mongo.db('admin').command({ hello: 1 })).isWritablePrimary) { ready = true; break; } await pause(100); }
  if (!ready) throw new Error('Disposable replica-set election timeout');
  for (let i = 0; i < 100; i++) {
    admin = new pg.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 300 });
    try { await admin.connect(); break; } catch { await admin.end().catch(() => {}); admin = null; await pause(100); }
  }
  if (!admin) throw new Error('Disposable PostgreSQL startup timeout');
  await admin.query(`CREATE DATABASE "${name}"`);
  // Explicit test-only role, not the OS user inferred by pg defaults.
  env.PGUSER = 'postgres';
  const child = spawn(process.execPath, [suite], { env, stdio: 'inherit' });
  processes.push(child);
  if (await exited(child) !== 0) throw new Error('Phase B suite failed');
} catch (error) {
  console.error(error.message?.startsWith('Disposable') || error.message?.startsWith('Phase B') ? error.message : 'Isolated stack failed; no configured-store fallback');
  process.exitCode = 1;
} finally {
  await mongo?.close().catch(() => {}); await admin?.end().catch(() => {});
  for (const child of processes.reverse()) {
    if (child.exitCode === null && child.signalCode === null && !child.startError) {
      const done = exited(child); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await done.catch(() => {}); clearTimeout(timer);
    }
  }
  await rm(directory, { recursive: true, force: true });
  console.log('Owned disposable stack removed.');
}
