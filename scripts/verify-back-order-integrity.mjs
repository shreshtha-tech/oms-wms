import assert from 'node:assert/strict';

process.env.MONGODB_URI = '';
const { find, insert } = await import('../api/mongo.js');
const handler = (await import('../api/back-orders.js')).default;

const invoke = async (method, action = '', body = {}) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    setHeader() {},
  };
  await handler({ method, query: { action }, body, headers: {} }, res);
  return res;
};

const backOrder = await insert('back_orders', {
  skuCode: 'BO-GUARD-SKU', siteLocation: 'BO-GUARD-LOC', vendorCode: 'BO-GUARD-VENDOR',
  orderDate: '2026-09-20', expectedDate: '2026-10-10', priorityCode: 'High',
  toOrderQty: 4, unitCost: 12.5, inventory: 900, isProcessed: false,
});
const search = await invoke('POST', 'search', {
  skuCode: 'BO-GUARD-SKU', priorityCode: '-1', channelCode: '-1',
  fromOrderDate: '2026-09-01', toOrderDate: '2026-09-30',
  fromExpDelDate: '2026-10-01', toExpDelDate: '2026-10-31', rows: 20, page: 1,
});
assert.equal(search.statusCode, 200);
assert.equal(search.payload.records, 1);
assert.equal(search.payload.rows[0].inventory, null);
assert.equal(search.payload.rows[0].inventory_trust, 'central-unmapped');
assert.equal((await invoke('POST', 'search', { fromOrderDate: '2026-10-01' })).payload.records, 0);
assert.equal((await invoke('POST', 'search', { fromExpDelDate: '2026-11-01' })).payload.records, 0);

const edited = await invoke('PUT', '', { id: backOrder.id, toOrderQty: 6, unitCost: 10, isProcessed: true, inventory: 0, status: 'Processed' });
assert.equal(edited.statusCode, 200);
assert.equal(edited.payload.toOrderQty, 6);
assert.equal(edited.payload.unitCost, 10);
assert.equal(edited.payload.inventory, null);
assert.equal((await invoke('PUT', '', { id: backOrder.id, toOrderQty: 0 })).statusCode, 400);
assert.equal((await invoke('PUT', '', { id: backOrder.id, unitCost: '' })).statusCode, 400);
assert.equal((await invoke('PUT', '', { id: backOrder.id, isProcessed: true })).statusCode, 400);
assert.equal((await invoke('POST', 'create-po', { poMainGridData: [{ id: backOrder.id }] })).statusCode, 501);
assert.equal((await invoke('POST', '', { skuCode: 'PHANTOM' })).statusCode, 501);
assert.equal((await find('purchase_orders')).length, 0);
const stored = (await find('back_orders', { id: backOrder.id }))[0];
assert.equal(stored.isProcessed, false);
assert.notEqual(stored.status, 'Processed');
assert.equal(stored.inventory, 900, 'historical data is preserved while unavailable to users');
assert.equal(stored.toOrderQty, 6);
const processed = await insert('back_orders', { skuCode: 'BO-GUARD-DONE', isProcessed: true, toOrderQty: 2, unitCost: 5 });
assert.equal((await invoke('PUT', '', { id: processed.id, toOrderQty: 3 })).statusCode, 409);
console.log('PASS Back Orders: planning edits are constrained, old stock is hidden, filters work, and duplicate/phantom PO paths create no records.');
