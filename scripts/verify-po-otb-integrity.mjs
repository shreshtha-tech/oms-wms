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
  const handler = (await import('../api/purchase-orders.js')).default;
  const grnHandler = (await import('../api/grn.js')).default;
  const asnHandler = (await import('../api/manage-asn.js')).default;
  const callHandler = async (target, method, body = {}, query = {}) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; }, setHeader() {} };
    await target({ method, body, query }, res);
    return res;
  };
  const call = (method, body = {}, query = {}) => callHandler(handler, method, body, query);
  await store.insert('skus', { sku_code: 'QA-SKU-OTB', category: 'QA-CATEGORY' });
  const budget = await store.insert('otb_budgets', { otb_id: 'QA-OTB', status: 'Confirmed', start_date: '2026-01-01', end_date: '2026-12-31', location: 'QA-WH', vendor_code: 'QA-VENDOR', operand_type: 'Category', operand: 'QA-CATEGORY', total_budget: 100, consumed: 0, open_to_buy: 100 });
  const body = { po_no: 'QA-PO-OTB', vendor: 'QA Vendor', vendor_code: 'QA-VENDOR', warehouse: 'QA-WH', po_date: '2026-09-30', expected_date: '2026-10-10', buyer_name: 'QA Buyer', recv_validation_code: 'Standard', qty: 1, amount: 60, line_items: [{ sku_code: 'QA-SKU-OTB', po_qty: 1 }], status: 'Released' };
  const draft = await call('POST', body);
  assert.equal(draft.statusCode, 201);
  assert.equal(draft.payload.status, 'Pending Confirmation');
  const attempts = await Promise.all(Array.from({ length: 4 }, () => call('PUT', { id: draft.payload.id, action: 'confirm' })));
  assert.ok(attempts.every((result) => result.statusCode === 501));
  assert.equal((await call('PUT', { id: draft.payload.id, vendor_code: 'OTHER', otb_guarded: false })).statusCode, 200);
  assert.equal((await call('PUT', { id: draft.payload.id, action: 'confirm' })).statusCode, 501);
  assert.equal((await call('PUT', { id: draft.payload.id, status: 'Received' })).statusCode, 409);
  const overBudget = await call('POST', { ...body, po_no: 'QA-PO-OVER', amount: 101 });
  assert.equal(overBudget.statusCode, 409);
  await client.connect();
  const db = client.db(testDb);
  assert.equal((await db.collection('purchase_orders').findOne({ id: draft.payload.id })).status, 'Pending Confirmation');
  assert.equal((await db.collection('purchase_orders').findOne({ id: draft.payload.id })).otb_guarded, true);
  assert.equal(await db.collection('purchase_orders').countDocuments({}), 1);
  const savedBudget = await db.collection('otb_budgets').findOne({ id: budget.id });
  assert.equal(savedBudget.consumed, 0);
  assert.equal(savedBudget.open_to_buy, 100);
  const plain = await call('POST', { ...body, po_no: 'QA-PO-PLAIN', vendor_code: 'OTHER' });
  assert.equal(plain.statusCode, 201);
  assert.equal((await call('PUT', { id: plain.payload.id, action: 'confirm' })).statusCode, 200);
  const existingGrn = await store.insert('grn', { asn_no: 'QA-ASN-OLD', po_no: 'QA-PO-PLAIN', status: 'Pending Confirmation' });
  assert.equal((await callHandler(grnHandler, 'POST', { asn_no: 'QA-ASN-FAKE', po_no: 'QA-PO-PLAIN', status: 'Received' })).statusCode, 501);
  assert.equal((await callHandler(grnHandler, 'PUT', { id: existingGrn.id, status: 'Received' })).statusCode, 501);
  assert.equal((await callHandler(grnHandler, 'DELETE', { id: existingGrn.id })).statusCode, 501);
  assert.equal((await db.collection('grn').findOne({ id: existingGrn.id })).status, 'Pending Confirmation');
  assert.equal((await db.collection('purchase_orders').findOne({ id: plain.payload.id })).status, 'Confirmed');
  const asnBody = { asn_no: 'QA-ASN', asn_type: '4', po_no: 'QA-PO-PLAIN', lines: [{ sku_code: 'QA-SKU-OTB', exp_qty: 1, pending_qty: 1, rcvd_qty: 99 }], operation: '1' };
  const asn = await callHandler(asnHandler, 'POST', asnBody);
  assert.equal(asn.statusCode, 201);
  assert.equal(asn.payload.received_qty, 0);
  assert.equal(asn.payload.lines[0].rcvd_qty, 0);
  const editedAsn = await callHandler(asnHandler, 'PUT', { ...asnBody, id: asn.payload.id, row_version: asn.payload.row_version });
  assert.equal(editedAsn.statusCode, 200);
  assert.equal(editedAsn.payload.received_qty, 0);
  assert.equal((await db.collection('grn').findOne({ id: asn.payload.id })).received_qty, 0);
  console.log('PASS isolated MongoDB PO/ASN/GRN: OTB and legacy receipt paths fail closed without budget, PO, or GRN drift; client ASN quantities cannot invent receipts.');
} catch (error) {
  failed = true;
  console.error('PO OTB integrity test failed:', error.code || error.name || 'TEST_FAILURE');
} finally {
  if (created) {
    try { await client.connect(); await client.db(testDb).dropDatabase(); console.log('Isolated MongoDB test database removed.'); }
    catch (error) { failed = true; console.error('PO OTB cleanup failed:', error.code || error.name || 'CLEANUP_FAILURE'); }
  }
  await client.close();
  process.exit(failed ? 1 : 0);
}
