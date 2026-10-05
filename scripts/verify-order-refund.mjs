import assert from 'node:assert/strict';

process.env.MONGODB_URI = '';
const { find, insert } = await import('../api/mongo.js');
const handler = (await import('../api/order-refunds.js')).default;

const invoke = async (method, body = {}) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    setHeader() {},
  };
  await handler({ method, body, headers: {} }, res);
  return res;
};

const refund = await insert('generic_records', {
  module: 'order-refund', order_no: 'REFUND-GUARD-1', client_id: 'CLIENT-1',
  refund_status: 'Pending', status: 'Pending', amount: 125.5,
});
const other = await insert('generic_records', {
  module: 'order-refund', order_no: 'REFUND-GUARD-2', client_id: 'CLIENT-2',
  refund_status: 'Failed', status: 'Failed', amount: 40,
});

const meta = await invoke('GET');
assert.equal(meta.statusCode, 200);
assert.equal(meta.payload.counts.pending, 1);
assert.equal(meta.payload.counts.failed, 1);
assert.equal(meta.payload.record_trust, 'legacy-unverified');
const search = await invoke('POST', { REQ_SEARCH_FLAG: true, clientID: 'CLIENT-1', status: 1, rows: 15, page: 1 });
assert.equal(search.statusCode, 200);
assert.equal(search.payload.records, 1);
assert.equal(search.payload.rows[0].order_no, 'REFUND-GUARD-1');
assert.equal(search.payload.rows[0].record_trust, 'legacy-unverified');

for (const action of ['approve', 'reapprove']) {
  const response = await invoke('PUT', { action, ids: [refund.id, other.id] });
  assert.equal(response.statusCode, 501);
  assert.match(response.payload.error, /payment provider/i);
}
const rows = await find('generic_records', { module: 'order-refund' });
assert.equal(rows.find((row) => row.id === refund.id).refund_status, 'Pending');
assert.equal(rows.find((row) => row.id === other.id).refund_status, 'Failed');
assert.equal(rows.some((row) => row.last_attempt_date), false);
console.log('PASS Order Refund: enquiry retains stored records and labels trust; approval/reapproval cannot invent payment processing or change statuses.');
