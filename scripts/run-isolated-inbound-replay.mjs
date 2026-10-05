import '../env.js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const baseUrl = process.env.INVENTORY_DATABASE_URL;
if (!baseUrl) throw new Error('INVENTORY_DATABASE_URL is required.');
const configured = new URL(baseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(configured.hostname)) throw new Error('This verifier requires a local PostgreSQL server.');
const databaseName = `codexqa_inbound_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
const admin = new pg.Client({ connectionString: baseUrl, connectionTimeoutMillis: 8000 });
let created = false, failure = null;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${databaseName}`;
  const child = spawn(process.execPath, ['scripts/verify-inbound-committed-replay.mjs'], {
    cwd: process.cwd(), env: { ...process.env, INVENTORY_DATABASE_URL: testUrl.toString(), MONGODB_URI: '' }, stdio: 'inherit',
  });
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
  });
  if (code !== 0) failure = new Error(`Inbound replay verifier exited with ${code ?? signal}.`);
} catch (error) { failure = error; }
finally {
  if (created) {
    try { await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); console.log('Isolated inbound-replay PostgreSQL database removed.'); }
    catch (error) { failure ||= error; console.error('Isolated inbound-replay database cleanup failed.'); }
  }
  await admin.end().catch(() => {});
}
if (failure) throw failure;
