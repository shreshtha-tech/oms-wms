import '../env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createPostgresConnection } from '../reliability/postgres-connection.js';
import { sendDatabaseError } from '../reliability/api-errors.js';
const configured = new URL(process.env.INVENTORY_DATABASE_URL || '');
assert.ok(['localhost','127.0.0.1','::1'].includes(configured.hostname), 'Only local fixture PostgreSQL is allowed');
const name = `codexqa_pool_${randomUUID().replaceAll('-','').slice(0,12)}`;
const fixture = new URL(configured); fixture.pathname = `/${name}`;
const admin = new pg.Client({connectionString:configured.toString(),connectionTimeoutMillis:8000});
let created=false, connection, held;
try {
 await admin.connect(); await admin.query(`CREATE DATABASE "${name}"`); created=true;
 connection=createPostgresConnection({connectionString:fixture.toString(),max:1,connectionTimeoutMillis:150,statement_timeout:150});
 await connection.pool.query('CREATE TABLE integrity (id integer PRIMARY KEY, value integer NOT NULL)');
 await connection.pool.query('INSERT INTO integrity VALUES (1,42)');
 held=await connection.pool.connect();
 await assert.rejects(connection.pool.connect(), error=>error.status===503 && error.code==='DATABASE_UNAVAILABLE');
 assert.equal(connection.status().state,'DEGRADED');
 held.release(); held=undefined;
 await connection.probe(); assert.equal(connection.status().state,'READY');
 await assert.rejects(connection.pool.query('SELECT pg_sleep(1)'),error=>error.status===504 && error.code==='DATABASE_TIMEOUT');
 held=await connection.pool.connect(); await held.query('BEGIN');
 await assert.rejects(held.query('SELECT pg_sleep(1)'),error=>error.status===504);
 await held.query('ROLLBACK'); held.release();held=undefined;
 held=await connection.pool.connect();
 const pid=(await held.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 // Only the backend acquired from this disposable database is terminated.
 const pending=assert.rejects(held.query('SELECT pg_sleep(1)'),error=>error.status===503 && error.code==='DATABASE_UNAVAILABLE');
 await admin.query('SELECT pg_terminate_backend($1)',[pid]); await pending;
 held.release(true); held=undefined;
 await connection.probe();
 assert.equal((await connection.pool.query('SELECT value FROM integrity WHERE id=1')).rows[0].value,42);
 await assert.rejects(connection.pool.query('INSERT INTO integrity VALUES (1,99)'),error=>{
  assert.equal(error.code,'23505');
  const response={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  assert.equal(sendDatabaseError(response,error),true);assert.equal(response.code,409);
  assert.ok(!JSON.stringify(response.body).includes('integrity_pkey'));
  assert.ok(!JSON.stringify(response.body).includes('Key (id)'));
  return true;
 });
 console.log('PASS real PostgreSQL failures: bounded pool exhaustion, recovery, slow query/transaction deadlines, terminated fixture backend, reconnect, durable row preserved, business conflict preserved');
} finally {
 held?.release(true);
 if(connection)await connection.pool.end();
 if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
 await admin.end();
 console.log('Disposable PostgreSQL failure fixture removed.');
}
