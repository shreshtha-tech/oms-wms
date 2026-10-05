import assert from 'node:assert/strict';
import report from '../api/reports.js';
import { getMode, insert } from '../api/mongo.js';

if (process.env.MONGODB_URI) throw new Error('Run this isolated check without MONGODB_URI.');
assert.equal(getMode(), 'memory');

const call = async (type, filters = {}) => {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await report({ method: 'GET', query: { type, ...filters } }, response);
  return response;
};

await insert('grn', {
  grn_no: 'AUDIT-QC-1', po_no: 'AUDIT-PO-1', vendor: 'Audit vendor', warehouse: 'Audit warehouse',
  grn_date: '2026-09-29', qc_completed_date: '2026-09-29T12:30:00.000Z',
  received_qty: 10, qc_done: true, qc_rejected: [{ rejQty: 2 }],
});
await insert('sale_orders', {
  order_no: 'AUDIT-ORDER-1', invoice_no: 'AUDIT-INVOICE-1', customer: 'Audit customer',
  order_date: '2026-09-29', qty: 1, amount: 10, payment_mode: 'COD', status: 'Shipped',
});
await insert('fulfillment_orders', {
  order_no: 'AUDIT-UNALLOC-1', sku_code: 'AUDIT-SKU-1', warehouse: 'Audit warehouse',
  channel: 'Audit channel', qty: 1, status: 'Pending', unallocation_date: '2026-09-29',
  unallocation_reason: 'Recorded audit reason', unallocated_by: 'Audit actor',
});

const qc = await call('inbound-qc-report', { from: '2026-09-29', to: '2026-09-29' });
assert.equal(qc.code, 200);
assert.deepEqual(qc.body.rows.find(row => row[0] === 'AUDIT-QC-1').slice(3), [10, 8, 2, '80%']);
const invoice = await call('invoice-report');
assert.equal(invoice.code, 200);
assert.equal(invoice.body.rows.find(row => row[1] === 'AUDIT-ORDER-1')[0], 'AUDIT-INVOICE-1');
const unallocation = await call('order-unallocation');
assert.equal(unallocation.code, 200);
assert.deepEqual(unallocation.body.rows.find(row => row[0] === 'AUDIT-UNALLOC-1').slice(6, 8),
  ['Recorded audit reason', 'Audit actor']);
for (const type of ['inventory-ageing', 'inventory-ledger', 'fin-inv-sku', 'fin-inv-sku-bin']) {
  const result = await call(type);
  assert.equal(result.code, 501);
  assert.match(result.body.error, /requires/i);
}
const mis = await call('mis-report');
assert.equal(mis.code, 200);
assert.deepEqual(mis.body.rows.find(row => row[0] === 'Inventory Units (Central Inventory)'),
  ['Inventory Units (Central Inventory)', 'Unavailable in this report']);
for(const [index,source] of [
 {received_qty:'invalid',qc_rejected:[]},
 {received_qty:10,qc_rejected:[{rejQty:11}]},
 {received_qty:10,qc_rejected:[{rejQty:-1}]},
 {received_qty:10,qc_rejected:[{rejQty:'invalid'}]},
 {qc_rejected:[]},
 {received_qty:10},
].entries()){
 const warehouse=`Invalid QC fixture ${index}`;
 await insert('grn',{grn_no:`INVALID-QC-${index}`,warehouse,qc_done:true,...source});
 const result=await call('inbound-qc-report',{warehouse});
 assert.equal(result.code,422,`Invalid or missing QC source must fail closed (case ${index})`);
 assert.equal(result.body.rows,undefined,'No fabricated QC percentages or clamped accepted quantities may be returned');
}
console.log('PASS truthful reports: recorded QC/invoice/unallocation, unsupported inventory guards, invalid/missing QC provenance rejection.');
