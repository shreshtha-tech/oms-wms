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
  const handler = (await import('../api/order-enquiry.js')).default;
  const saleOrders = (await import('../api/sale-orders.js')).default;
  const invoke = async (target, method, body = {}) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; }, setHeader() {} };
    await target({ method, body, query: {} }, res);
    return res;
  };
  const call = (method, body = {}) => invoke(handler, method, body);
  const order = await store.insert('sale_orders', { order_no: 'QA-ORDER', status: 'Confirmed', transmit_status: 'Error', order_date: '2026-09-30' });
  const found = await call('POST', { REQ_SEARCH_FLAG: true, queue: 'all', orderNo: 'QA-ORDER', page: 1, rows: 20 });
  assert.equal(found.statusCode, 200);
  assert.equal(found.payload.records, 1);
  assert.equal(found.payload.rows[0].order_source, '');
  assert.equal(found.payload.rows[0].currency, '');
  assert.equal(found.payload.rows[0].fulfillment_location, '');
  const failedRows = await call('POST', { REQ_SEARCH_FLAG: true, queue: 'failed', orderNo: 'QA-ORDER', page: 1, rows: 20 });
  assert.equal(failedRows.payload.records, 1);
  assert.equal(failedRows.payload.rows[0].status, '');
  for (const body of [
    { action: 'import-file', fileName: 'orders.xlsx', base64: 'not-a-workbook' },
    { action: 'import', rows: [{ order_no: 'QA-PHANTOM', status: 'Shipped' }] },
  ]) assert.equal((await call('POST', body)).statusCode, 501);
  for (const action of ['force-pull', 'putaway', 'retry']) {
    assert.equal((await call('PUT', { action, ids: [order.id] })).statusCode, 501);
  }
  assert.equal((await invoke(saleOrders, 'POST', { order_no: 'QA-NO-LINES', qty: 2, status: 'Confirmed' })).statusCode, 501);
  assert.equal((await invoke(saleOrders, 'PUT', { id: order.id, status: 'Delivered' })).statusCode, 501);
  assert.equal((await invoke(saleOrders, 'DELETE', { id: order.id })).statusCode, 501);
  await client.connect();
  const db = client.db(testDb);
  const saved = await db.collection('sale_orders').findOne({ id: order.id });
  assert.equal(saved.status, 'Confirmed');
  assert.equal(saved.transmit_status, 'Error');
  assert.equal(saved.force_pull_status, undefined);
  assert.equal(saved.putaway_status, undefined);
  assert.equal(await db.collection('sale_orders').countDocuments({}), 1);
  assert.equal(await db.collection('generic_records').countDocuments({ module: 'order_import_job' }), 0);
  console.log('PASS isolated MongoDB order enquiry: search works; import, force pull, putaway, retry, and unsupported sale-order mutations leave order state unchanged.');
} catch (error) {
  failed = true;
  console.error('Order Enquiry integrity test failed:', error.code || error.name || 'TEST_FAILURE');
} finally {
  if (created) {
    try { await client.connect(); await client.db(testDb).dropDatabase(); console.log('Isolated MongoDB test database removed.'); }
    catch (error) { failed = true; console.error('Order Enquiry cleanup failed:', error.code || error.name || 'CLEANUP_FAILURE'); }
  }
  await client.close();
  process.exit(failed ? 1 : 0);
}
