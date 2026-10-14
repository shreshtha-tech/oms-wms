import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import customerReturnEditor from '../api/customer-return-editor.js';
import returnWithoutOrder from '../api/return-without-order.js';
import returns from '../api/returns.js';
import vendorReturnEditor from '../api/vendor-return-editor.js';
import { find, getMode, insert, update } from '../api/mongo.js';

if (process.env.MONGODB_URI) throw new Error('Run this verifier without a configured MongoDB database.');
assert.equal(getMode(), 'memory', 'The return verifier must never write to the configured business tenant.');

async function call(handler, method, body = {}) {
  const response = {
    code: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await handler({ method, body }, response);
  return response;
}

const locationCode = 'AUD-RET-LOC';
const skuCode = 'AUD-RET-SKU';
await insert('generic_records', { module: 'location', location_code: locationCode, location_name: 'Return Audit Warehouse' });
await insert('vendors', { vendor_code: 'AUD-RET-VENDOR', vendor_name: 'Return Audit Vendor' });
await insert('partners', { type: 'Customer', code: 'AUD-RET-CUSTOMER', client_id: 'AUD-RET-CLIENT' });
await insert('skus', { sku_code: skuCode, name: 'Return Audit SKU', sale_price: 12 });
await insert('generic_records', { module: 'return-reason', code: 'AUD-RET-REASON', name: 'Audit reason', status: 'Active' });
await insert('inventory', { sku_code: skuCode, warehouse: locationCode, on_hand: 11, available: 11 });

const orderNo = 'AUD-RET-ORDER';
const deliveryNo = 'AUD-RET-DELIVERY';
await insert('sale_orders', { order_no: orderNo, external_order_no: 'AUD-RET-EXT', delivery_no: deliveryNo, items: [{ sku_code: skuCode, qty: 2, delivered_qty: 2 }] });
await insert('fulfillment_orders', { order_no: orderNo, delivery_no: deliveryNo, sku_code: skuCode, qty: 2 });
const stockBefore = {
  inventory: await find('inventory', { sku_code: skuCode }),
  skuTransactions: await find('sku_transactions'),
  stockAdjustments: await find('stock_adjustments'),
};

const customerConfirmation = await call(customerReturnEditor, 'POST', {
  action: 'confirm', external_order_no: 'AUD-RET-EXT', order_no: orderNo, delivery_no: deliveryNo,
  delivery_location: locationCode, request_type: '0', return_type: '2', category: '-1', delivery_type: '2',
  transporter: '-1', remarks: 'Isolated integrity verification',
  lines: [{ sku_code: skuCode, return_qty: 1, qty: 1, unit_price: 12 }],
});
assert.equal(customerConfirmation.code, 201);
assert.equal(customerConfirmation.body.status, 'Confirmed');
assert.match(customerConfirmation.body.workflowNotice, /No physical receipt, QC, stock posting, or refund/i);

await insert('vendors', { vendor_code: 'AUD-RET-VENDOR-EDITOR', vendor_name: 'Return Editor Vendor' });
const vendorDraft = await call(vendorReturnEditor, 'POST', {
  action: 'save', rtv_source: '2', site_location: locationCode, return_type: '10',
  vendor_code: 'AUD-RET-VENDOR-EDITOR', lines: [{ sku_code: skuCode, qty: 1, base_cost: 12 }],
});
assert.equal(vendorDraft.code, 201);
const vendorConfirmation = await call(vendorReturnEditor, 'PUT', {
  action: 'confirm', id: vendorDraft.body.id, rtv_source: '2', site_location: locationCode,
  return_type: '10', vendor_code: 'AUD-RET-VENDOR-EDITOR',
  lines: [{ sku_code: skuCode, qty: 1, base_cost: 12 }],
});
assert.equal(vendorConfirmation.code, 200);
assert.equal(vendorConfirmation.body.status, 'Confirmed');
assert.match(vendorConfirmation.body.workflowNotice, /No stock was reserved, removed, or shipped/i);

const legacyVendorCase = await insert('returns', { kind: 'vendor', status: 'Created', activity: [] });
const vendorStatus = await call(returns, 'POST', { entity: 'action', id: legacyVendorCase.id, action: 'confirm' });
assert.equal(vendorStatus.code, 200);
assert.match(vendorStatus.body.workflowNotice, /No stock was reserved, removed, or shipped/i);
await update('returns', legacyVendorCase.id, { status: 'Allocated' });
const quickShip = await call(returns, 'POST', { entity: 'action', id: legacyVendorCase.id, action: 'quick-ship' });
assert.equal(quickShip.code, 501);
assert.match(quickShip.body.error, /No status or inventory was changed/i);
assert.equal((await findOneReturn(legacyVendorCase.id)).status, 'Allocated');

const confirmedCustomerCase = await insert('returns', { kind: 'customer', status: 'Confirmed', request_type: 'Request & Inbound', activity: [] });
const inbound = await call(returns, 'POST', { entity: 'action', id: confirmedCustomerCase.id, action: 'inbound' });
assert.equal(inbound.code, 501);
assert.match(inbound.body.error, /No status or inventory was changed/i);
assert.equal((await findOneReturn(confirmedCustomerCase.id)).status, 'Confirmed');

const closedCustomerCase = await insert('returns', { kind: 'customer', status: 'Closed', activity: [] });
const refund = await call(returns, 'POST', { entity: 'action', id: closedCustomerCase.id, action: 'refund' });
assert.equal(refund.code, 501);
assert.match(refund.body.error, /No payment was issued/i);
assert.equal((await findOneReturn(closedCustomerCase.id)).status, 'Closed');

const customerLookup = await call(returnWithoutOrder, 'POST', { action: 'customer', custCode: 'AUD-RET-CUSTOMER' });
assert.equal(customerLookup.code, 200);
const scannedReturn = await call(returnWithoutOrder, 'POST', {
  action: 'scan', custCode: 'AUD-RET-CUSTOMER', scannedSkuCode: skuCode,
  scannQty: 1, reason: 'AUD-RET-REASON', lpn: '', returnNo: '',
});
assert.equal(scannedReturn.code, 200);
assert.equal(scannedReturn.body.status, 'Open');
const noOrderConfirmation = await call(returnWithoutOrder, 'POST', {
  action: 'confirm', returnNo: scannedReturn.body.returnCode, remarks: 'Isolated integrity verification',
});
assert.equal(noOrderConfirmation.code, 200);
assert.equal(noOrderConfirmation.body.status, 'Confirmed');
assert.match(noOrderConfirmation.body.workflowNotice, /No physical receipt, QC, or Central Inventory stock posting/i);
assert.equal(noOrderConfirmation.body.inboundNo, undefined);

assert.deepEqual(await find('inventory', { sku_code: skuCode }), stockBefore.inventory, 'Return workflows must not change legacy stock balances.');
assert.deepEqual(await find('sku_transactions'), stockBefore.skuTransactions, 'Return workflows must not create stock transactions.');
assert.deepEqual(await find('stock_adjustments'), stockBefore.stockAdjustments, 'Return workflows must not create stock adjustments.');

const beforeLegacyWrites = await find('returns');
const forgedLegacyCreate = await call(returns, 'POST', {
  rma_no: 'FORGED-RETURN', order_no: 'UNRELATED-ORDER', sku_code: 'PHANTOM-SKU', qty: 999, status: 'Shipped',
});
assert.equal(forgedLegacyCreate.code, 501);
assert.match(forgedLegacyCreate.body.error, /no record was created/i);
const legacyTarget = beforeLegacyWrites.find(row => row.id === legacyVendorCase.id);
const forgedLegacyUpdate = await call(returns, 'PUT', { id: legacyVendorCase.id, status: 'Shipped', kind: 'customer', arbitrary: 'caller' });
assert.equal(forgedLegacyUpdate.code, 501);
assert.equal((await findOneReturn(legacyVendorCase.id)).status, legacyTarget.status);
const forgedLegacyDelete = await call(returns, 'DELETE', { id: legacyVendorCase.id });
assert.equal(forgedLegacyDelete.code, 501);
assert.deepEqual(await find('returns'), beforeLegacyWrites, 'Untyped legacy mutations must not create, rewrite, or remove return records');

const customerUi = await readFile(new URL('../src/eretail/returns/CustomerReturnEditor.tsx', import.meta.url), 'utf8');
const vendorUi = await readFile(new URL('../src/eretail/returns/VendorReturnEditor.tsx', import.meta.url), 'utf8');
const noOrderUi = await readFile(new URL('../src/eretail/returns/ReturnWithoutOrder.tsx', import.meta.url), 'utf8');
assert.match(customerUi, /It does not receive, inspect, or restock returned goods, or issue refunds/);
assert.match(customerUi, /disabled=\{x!=='Save Eway Bill'\|\|!f\.id\}/);
assert.match(vendorUi, /does not move Central Inventory stock or send a shipment/);
assert.match(vendorUi, /disabled=\{x!=='Save Eway Bill'\|\|!f\.id\}/);
assert.match(noOrderUi, /Confirm changes the document status only/);
console.log('PASS Returns: typed customer/vendor/no-order flows retain their current behavior, untyped legacy create/update/delete reject without mutation, unsupported physical actions fail closed, and no stock rows or transactions change.');

async function findOneReturn(id) {
  return (await find('returns', { id }))[0];
}
