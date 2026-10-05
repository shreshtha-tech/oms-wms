import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPostgresConnection } from '../reliability/postgres-connection.js';
let failure, config;
class Pool extends EventEmitter {
  constructor(options) { super(); config = options; this.totalCount = 1; this.idleCount = 1; this.waitingCount = 0; }
  async query() { if (failure) throw failure; return { rows: [{ value: 1 }] }; }
  async connect() { if (failure) throw failure; return { query: this.query.bind(this), release() {} }; }
  async end() {}
}
const connection = createPostgresConnection({}, Pool);
assert.equal(config.max, 10); assert.equal(config.connectionTimeoutMillis, 8000); assert.equal(config.statement_timeout, 15000);
await connection.probe(); assert.equal(connection.status().state, 'READY');
failure = Object.assign(new Error('secret transport'), { code: 'ECONNRESET' });
connection.pool.emit('error', failure); assert.equal(connection.status().state, 'DEGRADED');
await assert.rejects(connection.probe(), error => error.status === 503 && !error.message.includes('secret'));
failure = undefined; await connection.probe(); assert.equal(connection.status().state, 'READY');
const client = await connection.pool.connect();
failure = Object.assign(new Error('secret transaction transport'), { code: 'ECONNRESET' });
await assert.rejects(client.query('transaction operation'), error => error.status === 503 && !error.message.includes('secret'));
failure = Object.assign(new Error('transaction timeout'), { code: '57014' });
await assert.rejects(client.query('slow transaction operation'), error => error.status === 504);
failure = undefined; await client.query('recovered transaction'); client.release();
failure = Object.assign(new Error('duplicate'), { code: '23505' }); await assert.rejects(connection.pool.query('insert'), error => error.code === '23505');
failure = Object.assign(new Error('timeout'), { code: '57014' }); await assert.rejects(connection.pool.query('slow'), error => error.status === 504);
await connection.pool.end(); assert.equal(connection.status().state, 'STOPPED');
console.log('PASS PostgreSQL: bounded pool, idle failure, safe 503, recovery, constraint preservation, query timeout, shutdown');
