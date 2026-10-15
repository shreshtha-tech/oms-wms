import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.MONGODB_URI = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const inbound = (await import('../api/inbound-realtime.js')).default;
const { find, findOne, insert } = await import('../api/mongo.js');

const call = async (body, query = {}) => {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
  await inbound({ method: body ? 'POST' : 'GET', body, query }, response);
  return response;
};

await insert('purchase_orders', {
  po_no: 'PO-RT-CHECK', vendor: 'RT Vendor', warehouse: 'RT-WH', status: 'Released',
  line_items: [{ sku_code: 'RT-SKU', sku_name: 'RT Item', qty: 8 }],
});
await insert('generic_records', { module: 'location', location_code: 'RT-WH', location_name: 'Realtime Warehouse', status: 'Active' });
const statusSpoof = await call({ action: 'save', inboundType: 'With PO', poNo: 'PO-RT-CHECK',
  warehouse: 'RT-WH', status: 'Confirmed', lines: [{ skuCode: 'RT-SKU', rcvdQty: 3 }] });
assert.equal(statusSpoof.code, 409, 'A draft save must not accept a client-provided confirmed status');
assert.equal((await find('grn')).length, 0, 'Status spoofing must not create a confirmed GRN');
const draft = await call({ action: 'save', inboundType: 'With PO', poNo: 'PO-RT-CHECK', warehouse: 'RT-WH', lines: [{ skuCode: 'RT-SKU', expQty: 8, rcvdQty: 3 }] });
assert.equal(draft.code, 201);
const id = draft.body.row.id;
const draftInvoiceEdit = await call({ action: 'save-invoice', id, inboundType: 'With PO', poNo: 'PO-RT-CHECK',
  invoiceNo: 'RT-DRAFT-INVOICE', lines: [{ skuCode: 'RT-SKU', rcvdQty: 3 }] });
assert.equal(draftInvoiceEdit.code, 200);
assert.equal((await findOne('grn', { id })).invoice_no, 'RT-DRAFT-INVOICE');
const receipt = { action: 'confirm', id, inboundType: 'With PO', poNo: 'PO-RT-CHECK', warehouse: 'RT-WH', requestId: 'realtime-receipt-1', lines: [{ skuCode: 'RT-SKU', expQty: 8, rcvdQty: 3 }] };
assert.equal((await call({ ...receipt, requestId: undefined })).code, 400);
assert.equal((await findOne('grn', { id })).central_request_id, undefined);

await insert('purchase_orders', { po_no: 'PO-RT-UNRELEASED', vendor: 'RT Vendor', warehouse: 'RT-WH', status: 'Pending Confirmation', line_items: [{ sku_code: 'RT-SKU', qty: 8 }] });
assert.equal((await call({ ...receipt, id: undefined, poNo: 'PO-RT-UNRELEASED', requestId: 'rt-unreleased' })).code, 409);
assert.equal((await find('grn')).filter(row => row.central_request_id === 'rt-unreleased').length, 0);

const savedConsoleError = console.error;
console.error = () => {};
const unavailable = await call(receipt);
assert.equal(unavailable.code, 503);
assert.match(unavailable.body.error, /Receipt tenant unavailable/);
assert.equal(unavailable.body.receiptPending, undefined, 'No receipt can be pending before the command is staged');
const unstaged = await findOne('grn', { id });
assert.equal(unstaged.status, 'Pending Confirmation');
assert.equal(unstaged.central_request_id, undefined);
assert.equal(unstaged.central_receipt_status, undefined);

const changedRetry = await call({ ...receipt, lines: [{ skuCode: 'RT-SKU', expQty: 8, rcvdQty: 4 }] });
assert.equal(changedRetry.code, 503);
assert.equal((await findOne('grn', { id })).received_qty, 3);
assert.equal((await call(receipt)).code, 503);
assert.equal((await find('grn')).filter(row => row.central_request_id === 'realtime-receipt-1').length, 0);

const unsupported = await call({ action: 'confirm', inboundType: 'Direct Inbound', lines: [{ skuCode: 'RT-SKU', rcvdQty: 1 }] });
assert.equal(unsupported.code, 501);
const fakeImport = await call({ action: 'import', inboundType: 'With PO', rows: [{ skuCode: 'RT-SKU', rcvdQty: 1 }] });
assert.equal(fakeImport.code, 501);
const beforeReverse = await findOne('grn', { id });
assert.equal((await call({ action: 'reverse', id })).code, 501);
assert.equal((await findOne('grn', { id })).status, beforeReverse.status);

await insert('purchase_orders', {
  po_no: 'PO-RT-OVER', vendor: 'RT Vendor', warehouse: 'RT-WH', status: 'Released',
  line_items: [{ sku_code: 'RT-SKU', qty: 8 }],
});
await insert('grn', {
  inbound_no: 'LEGACY-RT', po_no: 'PO-RT-OVER', warehouse: 'RT-WH', status: 'Confirmed',
  lines: [{ skuCode: 'RT-SKU', rcvdQty: 7 }],
});
const overReceiptDraft = await call({ action: 'save', inboundType: 'With PO', poNo: 'PO-RT-OVER', warehouse: 'RT-WH', lines: [{ skuCode: 'RT-SKU', rcvdQty: 2 }] });
const overReceipt = await call({ action: 'confirm', id: overReceiptDraft.body.row.id, inboundType: 'With PO', poNo: 'PO-RT-OVER', warehouse: 'RT-WH', requestId: 'rt-over-receipt', lines: [{ skuCode: 'RT-SKU', rcvdQty: 2 }] });
assert.equal(overReceipt.code, 409);
assert.equal((await findOne('grn', { id: overReceiptDraft.body.row.id })).central_request_id, undefined);

await insert('purchase_orders', {
  po_no: 'PO-RT-OLD', vendor: 'RT Vendor', warehouse: 'RT-WH', status: 'Released',
  line_items: [{ sku_code: 'RT-SKU', qty: 8 }],
});
const oldConfirmed = await insert('grn', {
  inbound_no: 'LEGACY-RT-2', po_no: 'PO-RT-OLD', warehouse: 'RT-WH', status: 'Confirmed',
  lines: [{ skuCode: 'RT-SKU', rcvdQty: 2 }],
});
const oldReplay = await call({ action: 'confirm', id: oldConfirmed.id, inboundType: 'With PO', poNo: 'PO-RT-OLD', warehouse: 'RT-WH', requestId: 'old-confirmed', lines: [{ skuCode: 'RT-SKU', rcvdQty: 2 }] });
assert.equal(oldReplay.code, 409);
console.error = savedConsoleError;

const ui = await readFile(new URL('../src/eretail/modules/InboundRealtime.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(ui, /Document saved|Receive All applied/);
assert.match(ui, /no file was saved/);
assert.match(ui, /received quantities were not changed/);
assert.match(ui, /receiptPending/);
const apiSource = await readFile(new URL('../api/inbound-realtime.js', import.meta.url), 'utf8');
const serviceSource = await readFile(new URL('../inventory/wms-operations.js', import.meta.url), 'utf8');
assert.match(apiSource, /stageReceiptCommand\(/);
assert.match(apiSource, /central_receipt_fingerprint/);
assert.match(apiSource, /source: 'wms_inbound_realtime'/);
assert.match(serviceSource, /eventType: 'inbound_receipt'/);

console.log('Inbound RealTime: PO receipts stage an idempotent Central Inventory request; unsupported types, imports and reversals fail closed; fake UI successes are removed.');
