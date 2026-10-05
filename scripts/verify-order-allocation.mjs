import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Use only an isolated in-memory store; never mutate a configured tenant.
process.env.MONGODB_URI = '';
process.env.DMILLS_REQUIRE_PERSISTENCE = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { find, insert } = await import('../api/mongo.js');
const orderAllocation = (await import('../api/order-allocation.js')).default;

async function invoke(method, body = {}) {
  const response = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    setHeader() {},
  };
  await orderAllocation({ method, body, query: {}, headers: {} }, response);
  return response;
}

const order = await insert('fulfillment_orders', {
  order_no: 'SAFE-ALLOC-ORDER', ext_order_no: 'SAFE-ALLOC-EXT',
  sku_code: 'SAFE-ALLOC-SKU', status: 'Pending', qty: 4, open_qty: 4,
});
const meta = await invoke('GET');
assert.equal(meta.payload.allocationAvailable, false);
assert.equal(meta.payload.dataTrust, 'legacy-unverified');
const search = await invoke('POST', { REQ_SEARCH_FLAG: true, fromOrderNo: order.order_no, rows: 50, page: 1 });
assert.equal(search.payload.gridModel[0].orderNo, order.order_no);
assert.equal(search.payload.gridModel[0].trust, 'legacy-unverified');
const found = await invoke('POST', { action: 'import', orders: [order.order_no, 'MISSING-ORDER'] });
assert.equal(found.payload.rows[0].orderNo, order.order_no);
assert.deepEqual(found.payload.notFound, ['MISSING-ORDER']);

for (const action of ['allocate', 'unAllocate', 'close']) {
  const result = await invoke('PUT', { action, ids: [order.id], reason: '10', remarks: 'Safe test' });
  assert.equal(result.statusCode, 501);
}
assert.deepEqual(await find('fulfillment_orders', { id: order.id }), [order]);
assert.deepEqual(await find('fulfillment_audit'), []);

const ui = await readFile(new URL('../src/eretail/modules/Allocate.tsx', import.meta.url), 'utf8');
assert.match(ui, /Allocate, UnAllocate, and Close SO are disabled until Central Inventory/);
assert.doesNotMatch(ui, /label: 'Allocate'|label: 'UnAllocate'|label: 'Close SO'/);
console.log('PASS Order Allocation: enquiry/import are read-only, allocation/unallocation/cancellation fail closed, and order/audit state remains unchanged.');
