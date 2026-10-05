import '../env.js';
import { randomInt, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { MongoClient } from 'mongodb';

const baseUrl = process.env.INVENTORY_DATABASE_URL;
if (!baseUrl) throw new Error('INVENTORY_DATABASE_URL is required.');
const configured = new URL(baseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(configured.hostname)) throw new Error('Only a local PostgreSQL server is permitted.');
const suffix = `${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
const pgName = `codexqa_inbound_ds_${suffix}`, mongoName = `codexqa_inbound_ds_${suffix}`;
const mongoDir = await mkdtemp(join(tmpdir(), 'codexqa-inbound-mongo-'));
const port = randomInt(20000, 50000);
const mongoUri = `mongodb://127.0.0.1:${port}`;
const mongod = spawn('/opt/homebrew/bin/mongod', ['--dbpath', mongoDir, '--port', String(port), '--bind_ip', '127.0.0.1',
  '--nounixsocket', '--logpath', join(mongoDir, 'mongod.log')], { stdio: 'ignore' });
let mongoError = null;
mongod.on('error', error => { mongoError = error; });
const admin = new pg.Client({ connectionString: baseUrl, connectionTimeoutMillis: 8000 });
let pgCreated = false, failure = null;
try {
  const probe = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 500 });
  let mongoReady = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (mongoError || mongod.exitCode !== null) throw new Error('Disposable mongod failed to start.');
    try { await probe.connect(); await probe.db('admin').command({ ping: 1 }); mongoReady = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 150)); }
  }
  await probe.close().catch(() => {});
  if (!mongoReady) throw new Error('Disposable mongod did not become ready.');
  await admin.connect();
  await admin.query(`CREATE DATABASE "${pgName}"`);
  pgCreated = true;
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${pgName}`;
  const child = spawn(process.execPath, ['scripts/verify-inbound-dual-store.mjs'], {
    cwd: process.cwd(), env: { ...process.env, INVENTORY_DATABASE_URL: testUrl.toString(), MONGODB_URI: mongoUri, MONGODB_DB: mongoName },
    stdio: 'inherit',
  });
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
  });
  if (code !== 0) failure = new Error(`Dual-store verifier exited with ${code ?? signal}.`);
} catch (error) { failure = error; }
finally {
  if (pgCreated) {
    try { await admin.query(`DROP DATABASE "${pgName}" WITH (FORCE)`); console.log('Disposable inbound PostgreSQL database removed.'); }
    catch (error) { failure ||= error; console.error('Could not remove disposable inbound PostgreSQL database.'); }
  }
  await admin.end().catch(() => {});
  if (mongod.exitCode === null) {
    mongod.kill('SIGTERM');
    await new Promise(resolve => { const timer = setTimeout(() => { mongod.kill('SIGKILL'); resolve(); }, 10000);
      mongod.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
  await rm(mongoDir, { recursive: true, force: true });
}
if (failure) throw failure;
