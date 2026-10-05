import '../env.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
const uri = new URL(process.env.INVENTORY_DATABASE_URL || '');
if (!['localhost','127.0.0.1','::1'].includes(uri.hostname)) throw new Error('This controlled migration accepts only the configured local PostgreSQL database. Use the deployment migration step for remote databases.');
const sql = await readFile(new URL('../db/migrations/019_reliability_login.sql',import.meta.url),'utf8');
const plan = { migration: '019_reliability_login.sql', additive: true, destructive: false, sha256: createHash('sha256').update(sql).digest('hex'), apply: process.argv.includes('--apply') };
console.log(JSON.stringify(plan));
if (plan.apply) {
 const client = new pg.Client({ connectionString: uri.toString(), connectionTimeoutMillis: 8000, statement_timeout: 30000 });
 try {
  await client.connect(); await client.query("SELECT pg_advisory_lock(hashtextextended('ci-schema-migrations',0))");
  await client.query(sql);
  const result = await client.query("SELECT to_regclass('public.ci_login_rate_limit') IS NOT NULL AS applied");
  if(!result.rows[0].applied)throw new Error('Migration verification failed');
  console.log('Applied and verified additive login-throttling schema.');
 } finally { await client.end(); }
}
