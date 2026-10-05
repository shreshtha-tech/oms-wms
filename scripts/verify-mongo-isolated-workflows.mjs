import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../env.js';
import { MongoClient } from 'mongodb';

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required for persistent workflow verification.');
const configuredDb = process.env.MONGODB_DB || 'd_mills_global';
const testDb = `codexqa_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
if (testDb === configuredDb || !testDb.startsWith('codexqa_') || Buffer.byteLength(testDb) > 38) throw new Error('Refusing to test in the configured database.');
process.env.MONGODB_DB = testDb;

const direct = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
let failed = false;
let created = false;
try {
  const { waitForDataReady, insert } = await import('../api/mongo.js');
  assert.equal(await waitForDataReady(), 'mongo', 'The test must use MongoDB persistence.');
  created = true;
  const backOrders = (await import('../api/back-orders.js')).default;
  const refunds = (await import('../api/order-refunds.js')).default;
  const ars = (await import('../api/ars.js')).default;
  const invoke = async (handler, method, body = {}, query = {}, path = '') => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
      setHeader() {},
    };
    await handler({ method, body, query, path, headers: {} }, res);
    return res;
  };

  const source = await insert('back_orders', {
    skuCode: 'QA-BO-1', siteLocation: 'QA-LOC', vendorCode: 'QA-VENDOR',
    orderDate: '2026-09-20', expectedDate: '2026-10-10',
    toOrderQty: 4, unitCost: 12.5, inventory: 999, isProcessed: false,
  });
  const boSearch = await invoke(backOrders, 'POST', { skuCode: 'QA-BO-1', rows: 20, page: 1 }, { action: 'search' });
  assert.equal(boSearch.statusCode, 200);
  assert.equal(boSearch.payload.records, 1);
  assert.equal(boSearch.payload.rows[0].inventory, null);
  assert.equal((await invoke(backOrders, 'PUT', { id: source.id, toOrderQty: 6, isProcessed: true, inventory: 0 })).statusCode, 200);
  const poAttempts = await Promise.all(Array.from({ length: 4 }, () => invoke(backOrders, 'POST', { poMainGridData: [{ id: source.id }] }, { action: 'create-po' })));
  assert.ok(poAttempts.every((result) => result.statusCode === 501));
  assert.equal((await invoke(backOrders, 'POST', { skuCode: 'PHANTOM' })).statusCode, 501);

  const refund = await insert('generic_records', { module: 'order-refund', order_no: 'QA-REFUND-1', refund_status: 'Pending', status: 'Pending', amount: 45 });
  assert.equal((await invoke(refunds, 'POST', { REQ_SEARCH_FLAG: true, status: 1, rows: 15, page: 1 })).payload.records, 1);
  assert.equal((await invoke(refunds, 'PUT', { action: 'approve', ids: [refund.id] })).statusCode, 501);
  assert.equal((await invoke(refunds, 'PUT', { action: 'reapprove', ids: [refund.id] })).statusCode, 501);

  const rule = await insert('ars_rules', { rule_id: 'QA-ARS-1', ars_method: 'Sales History', status: 'Active', last_run_date: '' });
  const log = await insert('ars_execution_logs', { execution_id: 'QA-ARS-LOG-1', status: 'Document Generated', execution_details: [{ sku_code: 'QA-SKU', status: 'Document Created' }] });
  assert.equal((await invoke(ars, 'PUT', { entity: 'rules', action: 'run', id: rule.id }, { entity: 'rules' })).statusCode, 501);
  assert.equal((await invoke(ars, 'POST', { entity: 'logs', action: 'approve-all', id: log.id }, { entity: 'logs' })).statusCode, 501);
  assert.equal((await invoke(ars, 'POST', { entity: 'logs', action: 'process-all', id: log.id }, { entity: 'logs' })).statusCode, 501);
  assert.equal((await invoke(ars, 'POST', { entity: 'links' }, { entity: 'links' }, '/api/downloadArsAttribute')).statusCode, 501);

  await direct.connect();
  const db = direct.db(testDb);
  const savedBackOrder = await db.collection('back_orders').findOne({ id: source.id });
  const savedRefund = await db.collection('generic_records').findOne({ id: refund.id });
  const savedRule = await db.collection('ars_rules').findOne({ id: rule.id });
  const savedLog = await db.collection('ars_execution_logs').findOne({ id: log.id });
  assert.equal(savedBackOrder.toOrderQty, 6);
  assert.equal(savedBackOrder.isProcessed, false);
  assert.equal(savedBackOrder.inventory, 999);
  assert.equal(await db.collection('purchase_orders').countDocuments({}), 0);
  assert.equal(await db.collection('back_orders').countDocuments({}), 1);
  assert.equal(savedRefund.refund_status, 'Pending');
  assert.equal(savedRefund.last_attempt_date, undefined);
  assert.equal(savedRule.last_run_date, '');
  assert.equal(savedLog.status, 'Document Generated');
  assert.equal(savedLog.execution_details[0].status, 'Document Created');
  assert.equal(await db.collection('downloads').countDocuments({}), 0);
  console.log('PASS isolated MongoDB persistence: saved planning edit is visible through a second client; back-order PO, refund, and ARS guarded actions leave no PO, payment status, job, or execution mutation.');
} catch (error) {
  failed = true;
  console.error('Isolated MongoDB workflow verification failed:', error.code || error.name || 'TEST_FAILURE', error.message?.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[redacted URI]') || '');
} finally {
  if (created) {
    try {
      await direct.connect();
      if (!testDb.startsWith('codexqa_') || testDb === configuredDb) throw new Error('Test database name safety check failed.');
      await direct.db(testDb).dropDatabase();
      console.log('Isolated MongoDB test database removed.');
    } catch (error) {
      failed = true;
      console.error('Isolated MongoDB cleanup failed for', testDb, ':', error.code || error.name || 'CLEANUP_FAILURE');
    }
  }
  await direct.close();
}
process.exit(failed ? 1 : 0);
