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
  const handler = (await import('../api/transporters.js')).default;
  const call = async (method, body = {}) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; }, setHeader() {} };
    await handler({ method, body, user: { username: 'qa-carrier-actor' } }, res);
    return res;
  };
  const initial = await call('POST', { transporter_code: '9011', transporter_name: 'Original Carrier', carrier_type: 'Ground', transporter_type: 'Courier' });
  assert.equal(initial.statusCode, 201);
  assert.equal(initial.payload.created_by, 'qa-carrier-actor');
  await store.insert('fulfillment_orders', { order_no: 'QA-ORDER', courier: 'Original Carrier' });
  await store.insert('shipments', { shipment_no: 'QA-SHIPMENT', courier: 'Original Carrier' });
  const edited = await call('PUT', { id: initial.payload.id, transporter_name: 'Renamed Carrier', transporter_code: 'FORGED', created_by: 'FORGED', created_date: '1900-01-01' });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.payload.transporter_code, '9011');
  assert.equal(edited.payload.transporter_name, 'Renamed Carrier');
  assert.equal(edited.payload.created_by, 'qa-carrier-actor');
  assert.equal(edited.payload.created_date, initial.payload.created_date);
  assert.equal(edited.payload.modified_by, 'qa-carrier-actor');
  const searched = await call('POST', { REQ_SEARCH_FLAG: true, transporterCode: '9011', rows: 20, page: 1 });
  assert.equal(searched.payload.records, 1);
  await client.connect();
  const db = client.db(testDb);
  assert.equal((await db.collection('fulfillment_orders').findOne({ order_no: 'QA-ORDER' })).courier, 'Original Carrier');
  assert.equal((await db.collection('shipments').findOne({ shipment_no: 'QA-SHIPMENT' })).courier, 'Original Carrier');
  assert.equal((await call('DELETE', { id: initial.payload.id })).statusCode, 409);
  console.log('PASS isolated MongoDB transporter create, search, rename, immutable code/audit, historical courier names, and delete guard.');
} catch (error) {
  failed = true;
  console.error('Transporter integrity test failed:', error.code || error.name || 'TEST_FAILURE');
} finally {
  if (created) {
    try { await client.connect(); await client.db(testDb).dropDatabase(); console.log('Isolated MongoDB test database removed.'); }
    catch (error) { failed = true; console.error('Transporter cleanup failed:', error.code || error.name || 'CLEANUP_FAILURE'); }
  }
  await client.close();
  process.exit(failed ? 1 : 0);
}
