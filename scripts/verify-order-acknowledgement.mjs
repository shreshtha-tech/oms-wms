import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Use only an isolated in-memory store; never mutate a configured tenant.
process.env.MONGODB_URI = '';
process.env.DMILLS_REQUIRE_PERSISTENCE = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { find, insert } = await import('../api/mongo.js');
const orderAcknowledgement = (await import('../api/order-acknowledgement.js')).default;

async function invoke(method, body = {}) {
  const response = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    setHeader() {},
  };
  await orderAcknowledgement({ method, body, query: {}, headers: {} }, response);
  return response;
}

const pending = await insert('fulfillment_orders', {
  order_no: 'SAFE-ACK-PENDING', ext_order_no: 'SAFE-EXT-PENDING',
  channel: 'SAFE-CHANNEL', sku_code: 'SAFE-ACK-SKU', qty: 2,
  status: 'Pending', ack_status: 'Pending Acknowledgement',
});
const history = await insert('fulfillment_orders', {
  order_no: 'SAFE-ACK-HISTORY', ext_order_no: 'SAFE-EXT-HISTORY',
  channel: 'SAFE-CHANNEL', sku_code: 'SAFE-ACK-SKU', qty: 1,
  status: 'Pending', ack_status: 'Rejected', rejection_reason: 'Out of Stock',
});
const oldAudit = await insert('generic_records', {
  module: 'order-acknowledgement-audit', order_no: history.order_no, action: 'Rejected',
});

const meta = await invoke('GET');
assert.equal(meta.payload.available, false);
assert.equal(meta.payload.dataTrust, 'legacy-unverified');
const pendingSearch = await invoke('POST', { action: 'search', tab: 'pending', rows: 20, page: 1 });
assert.equal(pendingSearch.payload.rows[0].orderNo, pending.order_no);
assert.equal(pendingSearch.payload.rows[0].trust, 'legacy-unverified');
const historySearch = await invoke('POST', { action: 'search', tab: 'history', rows: 20, page: 1 });
assert.equal(historySearch.payload.rows[0].orderNo, history.order_no);

for (const body of [
  { action: 'accept', ids: [pending.id] },
  { action: 'reject', ids: [pending.id], rejectionReason: 'Out of Stock', rejectionRemarks: 'Safe test' },
]) {
  const result = await invoke('POST', body);
  assert.equal(result.statusCode, 501);
  assert.match(result.payload.error, /authenticated channel connector/);
}
const audit = await invoke('POST', { action: 'audit', orderNo: history.order_no });
assert.equal(audit.payload.trust, 'legacy-unverified');
assert.equal(audit.payload.rows[0].trust, 'legacy-unverified');
assert.deepEqual(await find('fulfillment_orders', { id: pending.id }), [pending]);
assert.deepEqual(await find('generic_records', { module: 'order-acknowledgement-audit' }), [oldAudit]);

const ui = await readFile(new URL('../src/eretail/modules/OrderAcknowledgement.tsx', import.meta.url), 'utf8');
assert.match(ui, /Provider acknowledgement is unavailable until an authenticated channel connector/);
assert.doesNotMatch(ui, /action: 'accept'|action: 'reject'|Confirm Reject/);
console.log('PASS Order Acknowledgement: search is read-only, provider actions fail closed, and neither order status nor audit history changes.');
