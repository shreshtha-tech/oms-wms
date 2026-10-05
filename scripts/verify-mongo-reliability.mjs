import assert from 'node:assert/strict';
import { createMongoConnection } from '../api/mongo-connection.js';
let available = false, creations = 0, connects = 0, closes = 0;
const outage = () => Object.assign(new Error('private mongodb://credentials'), { name: 'MongoNetworkError' });
class Client {
  constructor() { creations++; }
  async connect() { connects++; await new Promise(resolve => setTimeout(resolve, 5)); if (!available) throw outage(); }
  db() { return { command: async () => { if (!available) throw outage(); return { ok: 1 }; } }; }
  async close() { closes++; }
}
const logs = [];
const connection = createMongoConnection({ uri: 'test', database: 'test', Client, retryMs: 0, log: (...args) => logs.push(args) });
const failed = await Promise.allSettled(Array.from({ length: 20 }, () => connection.connect()));
assert.ok(failed.every(result => result.status === 'rejected' && result.reason.statusCode === 503));
assert.equal(connects, 1); assert.equal(connection.status().state, 'DEGRADED');
available = true;
await connection.connect(); assert.equal(connection.status().state, 'READY'); assert.equal(creations, 1);
available = false;
await assert.rejects(connection.probe(), error => error.code === 'DATABASE_UNAVAILABLE');
assert.equal(connection.status().state, 'DEGRADED');
available = true; await connection.probe(); assert.equal(connection.status().state, 'READY');
await assert.rejects(connection.run(() => { throw Object.assign(new Error('invalid'), { code: 11000 }); }), error => error.code === 11000);
for (const timeout of [{ code: 50 }, { code: 262 }, { name: 'MongoOperationTimeoutError' }]) {
  await assert.rejects(connection.run(() => { throw Object.assign(new Error('private query timeout'), timeout); }), error => error.status === 504 && error.code === 'DATABASE_TIMEOUT' && !error.message.includes('private'));
  assert.equal(connection.status().state, 'READY', 'A query deadline must not poison a healthy connection');
}
await assert.rejects(connection.run(() => { throw outage(); }), error => error.status === 503);
await assert.rejects(connection.run(() => { throw Object.assign(new Error('private topology'), { name: 'PoolClearedOnNetworkError' }); }), error => error.status === 503);
assert.ok(!JSON.stringify(logs).includes('credentials'));
await connection.close(); assert.equal(closes, 1); assert.equal(connection.status().state, 'STOPPED');
await assert.rejects(connection.connect(), error => error.status === 503);
console.log('PASS: shared pool, single-flight outage, retry, loss after startup, redaction, business errors and shutdown');
