import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.MONGODB_URI = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { find, insert } = await import('../api/mongo.js');
const handler = (await import('../api/order-maintenance.js')).default;

async function invoke(method, body = {}, query = {}) {
  const response = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
  await handler({ method, body, query, headers: {} }, response);
  return response;
}

const order = await insert('sale_orders', {
  order_no: 'SAFE-ORDER-MAINTENANCE', status: 'Confirmed', amount: 200,
  qty: 2, verification_status: 'Complete',
  lines: [{ sku_code: 'SAFE-OM-SKU', qty: 2, open_qty: 2, status: 'Confirmed' }],
});

const view = await invoke('GET', {}, { orderNo: order.order_no });
assert.equal(view.statusCode, 200);
assert.equal(view.payload.order.order_no, order.order_no);
assert.deepEqual(view.payload.order.lines, order.lines);

for (const [action, body] of [
  ['save', { lines: [{ sku_code: 'SAFE-OM-SKU', qty: 99, open_qty: 99 }] }],
  ['close', { reason: 'Safe test' }],
  ['seller-cancel', { cancelReason: 'Buyer request' }],
  ['seller-close', { lines: [0], reason: 'Safe test' }],
  ['seller-back-status', { lines: [0] }],
  ['seller-return', { lines: [{ sku_code: 'SAFE-OM-SKU', qty: 1 }], returnType: 'Customer Return' }],
  ['quick-ship', {}],
  ['eway', { operation: 'generate', document_type: 'TaxInvoice', eway_bill_no: 'FAKE-EWB' }],
  ['eway', { operation: 'save', document_type: 'TaxInvoice', eway_bill_no: 'FAKE-EWB' }],
  ['eway', { operation: 'cancel', reason: 'Duplicate' }],
  ['eway', { operation: 'extend', reason: '1' }],
]) {
  const result = await invoke('POST', { orderNo: order.order_no, action, ...body });
  assert.equal(result.statusCode, 501, `${action} must remain unavailable without its ledger/provider transaction`);
}

const pdf = await invoke('GET', {}, { orderNo: order.order_no, download: 'eway-pdf' });
assert.equal(pdf.statusCode, 501, 'E-way Bill print must not create a synthetic PDF');

const comment = await invoke('POST', { orderNo: order.order_no, action: 'comment', comments: 'Safe activity note' });
assert.equal(comment.statusCode, 201, 'non-stock activity metadata remains saveable');
assert.equal((await find('generic_records', { module: 'order_eway', order_no: order.order_no })).length, 0);
assert.equal((await find('generic_records', { module: 'order_return', order_no: order.order_no })).length, 0);

const unchanged = (await find('sale_orders', { id: order.id }))[0];
assert.equal(unchanged.status, 'Confirmed');
assert.equal(unchanged.lines[0].qty, 2);
assert.equal(unchanged.lines[0].open_qty, 2);

const ui = await readFile(new URL('../src/eretail/sales/OrderMaintenance.tsx', import.meta.url), 'utf8');
assert.ok(ui.includes('Order edits that change lines or quantities, close/cancel, Quick Ship, return creation and E-way Bill operations are unavailable'));
assert.ok(ui.includes('Save Order (Unavailable)'));
assert.ok(ui.includes('Verified GST e-way bill connector is not configured'));
assert.ok(!ui.includes("['Close SO',()=>setCloseOpen(true)]"));
const marketOrderUi = await readFile(new URL('../src/eretail/sales/MarketOrderView.tsx', import.meta.url), 'utf8');
assert.ok(marketOrderUi.includes('Cancel, close, status reversal and return creation are unavailable'));
assert.ok(marketOrderUi.includes('disabled title="Central Inventory reservation release is not connected"'));
assert.ok(!marketOrderUi.includes("['Close SO','close']"));
assert.ok(!marketOrderUi.includes("['Raise Return','return']"));
console.log('PASS Order Maintenance and Market Order View: status/quantity edits, close/cancel, quick ship, return creation and simulated E-way Bill actions fail closed; controls are gated and no synthetic PDF or order mutation is produced.');
