import assert from 'node:assert/strict';
// This fixture must never read or mutate a configured MongoDB.
process.env.MONGODB_URI = '';
process.env.DMILLS_REQUIRE_PERSISTENCE = '';
const { default: qc } = await import('../api/inbound-qc.js');
const { default: enquiry } = await import('../api/inbound-enquiry.js');
const { default: report } = await import('../api/reports.js');
const { find, findOne, insert } = await import('../api/mongo.js');
const inbound = await insert('grn', {
  grn_no: 'QC-CHECK-1', inbound_no: 'QC-CHECK-1', po_no: 'PO-CHECK-1', warehouse: 'CHECK-WH',
  grn_date: '2026-09-29', status: 'Confirmed', status_code: 4,
  central_receipt_status: 'committed', central_receipt_event_ids: ['historical-event'],
  qc_done: true, qc_completed_date: '2026-09-29',
  received_qty: 5, lines: [{ sku_code: 'CHECK-SKU', received_qty: 5 }],
  qc_rejected: [{ skuNo: 'CHECK-SKU', rejQty: 2, reasonCode: '01', reason: 'Expired' }],
});
const call = async (handler, body, query = {}) => {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method: body ? 'POST' : 'GET', body, query }, response);
  return response;
};
const before = await findOne('grn', { id: inbound.id });
const scan = { action: 'scan', id: inbound.id, scanType: '2', skuCode: 'CHECK-SKU', reasonCode: '01', qty: 1, requestId: 'qc-unsafe-request' };
for (const body of [scan, { ...scan, scanType: '1' }, { ...scan, scanType: '3' },
  { action: 'confirm', id: inbound.id }, { action: 'create-rtv', id: inbound.id }]) {
  const response = await call(qc, body);
  assert.equal(response.code, 501, `${body.action} must fail closed without a Central Inventory disposition`);
  assert.match(response.body.error, /Central Inventory/);
}
const launch = await call(enquiry, { action: 'qc', id: inbound.id });
assert.equal(launch.code, 501, 'Enquiry must not mark the inbound as opened for QC');
assert.deepEqual(await findOne('grn', { id: inbound.id }), before, 'QC attempts must leave the GRN unchanged');
assert.equal((await find('generic_records', { module: 'inbound-rtv' })).length, 0, 'QC attempts must not create an RTV');
const historical = await call(qc, { action: 'search', inboundNo: 'QC-CHECK-1' });
assert.equal(historical.code, 200);
assert.equal(historical.body.row.rejected[0].rejQty, 2);
const result = await call(report, null, { type: 'inbound-qc-report', warehouse: 'CHECK-WH' });
assert.deepEqual(result.body.rows.find(row => row[0] === 'QC-CHECK-1').slice(3), [5, 3, 2, '60%']);
console.log('PASS Inbound QC fail-closed actions leave GRN/RTV unchanged; historical enquiry and report remain available');
