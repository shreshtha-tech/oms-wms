import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// This verifier must never touch a configured database or a running tenant.
process.env.MONGODB_URI = '';
process.env.DMILLS_REQUIRE_PERSISTENCE = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { find, insert } = await import('../api/mongo.js');
const deliverySplit = (await import('../api/delivery-split.js')).default;

async function invoke(method, body = {}) {
  const response = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    setHeader() {},
  };
  await deliverySplit({ method, body, query: {}, headers: {} }, response);
  return response;
}

const order = await insert('fulfillment_orders', {
  order_no: 'SAFE-SPLIT-ORDER', delivery_no: 'SAFE-SPLIT-DELIVERY',
  sku_code: 'SAFE-SPLIT-SKU', qty: 7, amount: 700, status: 'Allocated',
});
const meta = await invoke('GET');
assert.equal(meta.payload.available, false);
assert.equal(meta.payload.dataTrust, 'legacy-unverified');
assert.equal(meta.payload.deliveries[0].outDelNo, order.delivery_no);

const search = await invoke('POST', { action: 'search', outDelNo: order.delivery_no, rows: 20, page: 1 });
assert.equal(search.statusCode, 200);
assert.equal(search.payload.rows[0].qty, 7, 'read-only enquiry must show the stored quantity');

for (const body of [
  { action: 'sku-lookup', outDelNo: order.delivery_no, skuCode: order.sku_code },
  { action: 'add-sku', outDelNo: order.delivery_no, skuCode: order.sku_code, uQty: 2 },
  { action: 'confirm', outDelNo: order.delivery_no, lines: [{ statusCode: '7', qty: 2 }] },
]) {
  const result = await invoke('POST', body);
  assert.equal(result.statusCode, 501);
  assert.match(result.payload.error, /Central Inventory/);
}

const audit = await invoke('POST', { action: 'audit', outDelNo: order.delivery_no });
assert.equal(audit.payload.trust, 'legacy-unverified');
assert.deepEqual(audit.payload.rows, []);
assert.deepEqual(await find('fulfillment_orders'), [order], 'blocked split requests must not mutate or create fulfillment orders');
assert.deepEqual(await find('generic_records', { module: 'delivery-split-audit' }), [], 'blocked split requests must not create audit rows');

const ui = await readFile(new URL('../src/eretail/modules/DeliverySplit.tsx', import.meta.url), 'utf8');
assert.match(ui, /Delivery splitting is unavailable until Central Inventory/);
assert.match(ui, /Legacy split audit rows are unverified/);
assert.doesNotMatch(ui, /Confirm Splitting|Scan SKU|action:\s*'add-sku'/);
console.log('PASS Delivery Split: isolated in-memory search is read-only, SKU and split writes fail closed, quantities and audit rows stay unchanged, and the UI explains the boundary.');
