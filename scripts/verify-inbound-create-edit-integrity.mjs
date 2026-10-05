import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.MONGODB_URI = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const inbound = (await import('../api/inbound-create-edit.js')).default;
const { find, findOne, insert } = await import('../api/mongo.js');
const call = async body => {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
  await inbound({ method: 'POST', body }, response);
  return response;
};

await insert('purchase_orders', {
  po_no: 'PO-INBOUND-CHECK', vendor: 'Check Vendor', warehouse: 'Check Warehouse', status: 'Released',
  line_items: [{ sku_code: 'CHECK-SKU', sku_name: 'Check Item', qty: 8 }],
});
await insert('generic_records', { module: 'location', location_code: 'CHECK-WH', location_name: 'Check Warehouse', status: 'Active' });

const validLine = { sku_code: 'CHECK-SKU', rcvdUOMQty: 3 };
assert.equal((await call({ action: 'import', poNo: 'MISSING', rows: [validLine] })).code, 404);
const invalid = await call({ action: 'import', poNo: 'PO-INBOUND-CHECK', rows: [validLine, { sku_code: 'FOREIGN', rcvdUOMQty: 1 }, { ...validLine, rcvdUOMQty: 0 }] });
assert.equal(invalid.body.successItems, 1);
assert.equal(invalid.body.failedItems, 2);
assert.equal((await call({ action: 'save', poNo: 'MISSING', lines: [{ skuCode: 'CHECK-SKU', rcvdUOMQty: 3 }] })).code, 404);
assert.equal((await call({ action: 'confirm', poNo: 'PO-INBOUND-CHECK', lines: [{ skuCode: 'FOREIGN', rcvdUOMQty: 1 }], requestId: 'check-foreign' })).code, 400);

const saved = await call({ action: 'save', poNo: 'PO-INBOUND-CHECK', lines: [{ skuCode: 'CHECK-SKU', rcvdUOMQty: 3 }] });
assert.equal(saved.code, 201);
assert.equal(saved.body.row.received_qty, 3);
const id = saved.body.row.id;
assert.equal((await call({ action: 'save', id, poNo: 'DIFFERENT', lines: [{ skuCode: 'CHECK-SKU', rcvdUOMQty: 1 }] })).code, 404);
const updated = await call({ action: 'save', id, poNo: 'PO-INBOUND-CHECK', lines: [{ skuCode: 'CHECK-SKU', rcvdUOMQty: 4 }] });
assert.equal(updated.code, 200);
assert.equal((await findOne('grn', { id })).received_qty, 4);
assert.equal((await call({ action: 'confirm', id, poNo: 'PO-INBOUND-CHECK', warehouse: 'Check Warehouse', lines: [{ skuCode: 'CHECK-SKU', rcvdUOMQty: 9 }], requestId: 'check-over-receive' })).code, 409);

const requestId = 'check-inbound-receipt';
const confirm = { action: 'confirm', id, poNo: 'PO-INBOUND-CHECK', warehouse: 'Check Warehouse', lines: [{ skuCode: 'CHECK-SKU', rcvdUOMQty: 4 }], requestId };
const savedConsoleError = console.error;
console.error = () => {};
const unavailable = await call(confirm);
assert.equal(unavailable.code, 503);
assert.match(unavailable.body.error, /Central Inventory tenant is not configured/);
const staged = await findOne('grn', { id });
assert.equal(staged.status, 'Central Receipt Pending');
assert.equal(staged.central_request_id, requestId);
assert.equal(staged.central_receipt_status, 'pending');
assert.equal(unavailable.body.receiptPending.centralRequestId, requestId);
assert.equal((await find('grn')).filter(row => row.central_request_id === requestId).length, 1);

const changedReplay = await call({ ...confirm, lines: [{ skuCode: 'CHECK-SKU', rcvdUOMQty: 5 }] });
assert.equal(changedReplay.code, 409);
assert.equal((await findOne('grn', { id })).received_qty, 4);
const sameReplay = await call(confirm);
assert.equal(sameReplay.code, 503);
console.error = savedConsoleError;
assert.equal((await find('grn')).filter(row => row.central_request_id === requestId).length, 1);

const service = await readFile(new URL('../inventory/wms-operations.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../api/inbound-create-edit.js', import.meta.url), 'utf8');
assert.match(api, /receiveCentralInboundStock\(/);
assert.match(api, /central_receipt_fingerprint/);
assert.match(service, /eventType: 'inbound_receipt'/);
assert.match(service, /applyInventoryEventInTransaction\(db/);

console.log('Inbound Create/Edit PO validation, exact location staging, over-receipt guard, stable replay, and fail-closed Central Inventory confirmation passed.');
