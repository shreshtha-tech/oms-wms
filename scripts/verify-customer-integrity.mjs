import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../env.js';
import { MongoClient } from 'mongodb';

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
const configuredDb = process.env.MONGODB_DB || 'd_mills_global';
const testDb = `codexqa_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
if (testDb === configuredDb || Buffer.byteLength(testDb) > 38) throw new Error('Unsafe test database name.');
process.env.MONGODB_DB = testDb;
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
let created = false;
let failed = false;
try {
  const store = await import('../api/mongo.js');
  assert.equal(await store.waitForDataReady(), 'mongo');
  created = true;
  const handler = (await import('../api/customers.js')).default;
  const call = async (method, body = {}) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; }, setHeader() {} };
    await handler({ method, body, user: { username: 'qa-customer-actor' } }, res);
    return res;
  };
  const initial = await call('POST', { customer_name: 'Original Customer', type: '1 - B2C', primary_email: 'customer@example.test' });
  assert.equal(initial.statusCode, 201);
  const { id, customer_code } = initial.payload;
  assert.ok(customer_code.startsWith('CUS'));
  assert.equal(initial.payload.created_by, 'qa-customer-actor');
  await store.insert('sale_orders', { order_no: 'QA-ORDER', customer: 'Original Customer', customer_code });
  await store.insert('returns', { return_no: 'QA-RETURN', customer: 'Original Customer', customer_code });
  const edited = await call('PUT', { id, customer_name: 'Renamed Customer', customer_code: 'FORGED', created_by: 'FORGED', created_date: '1900-01-01', modified_by: 'FORGED' });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.payload.customer_code, customer_code);
  assert.equal(edited.payload.customer_name, 'Renamed Customer');
  assert.equal(edited.payload.created_by, 'qa-customer-actor');
  assert.equal(edited.payload.created_date, initial.payload.created_date);
  assert.equal(edited.payload.modified_by, 'qa-customer-actor');
  const searched = await call('POST', { REQ_SEARCH_FLAG: true, customerCode: customer_code, rows: 20, page: 1 });
  assert.equal(searched.payload.records, 1);
  await client.connect();
  const db = client.db(testDb);
  assert.equal((await db.collection('partners').findOne({ id })).name, 'Renamed Customer');
  assert.equal((await db.collection('sale_orders').findOne({ order_no: 'QA-ORDER' })).customer, 'Original Customer');
  assert.equal((await db.collection('returns').findOne({ return_no: 'QA-RETURN' })).customer, 'Original Customer');
  assert.equal((await call('DELETE', { id })).statusCode, 409);
  console.log('PASS isolated MongoDB customer create, search, rename, immutable code, protected order/return history, and delete guard.');
} catch (error) {
  failed = true;
  console.error('Customer integrity test failed:', error.code || error.name || 'TEST_FAILURE');
} finally {
  if (created) {
    try { await client.connect(); await client.db(testDb).dropDatabase(); console.log('Isolated MongoDB test database removed.'); }
    catch (error) { failed = true; console.error('Customer cleanup failed:', error.code || error.name || 'CLEANUP_FAILURE'); }
  }
  await client.close();
  process.exit(failed ? 1 : 0);
}
