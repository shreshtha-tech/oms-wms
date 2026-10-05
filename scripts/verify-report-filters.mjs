import assert from 'node:assert/strict';
if (process.env.MONGODB_URI) throw new Error('This fixture requires an isolated in-memory store.');
const { insert } = await import('../api/mongo.js');
const { default: report } = await import('../api/reports.js');
const call = async (type, filters = {}) => {
  const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await report({ method: 'GET', query: { type, ...filters } }, res);
  return res;
};
for (const channel of ['constructor', '__proto__', 'Channel fixture']) {
  for (const qty of ['2', '3']) await insert('sale_orders', { channel, qty, amount: '10', order_date: '2026-09-29', status: 'Shipped' });
}
for (const type of ['sales-report', 'mis-report-2']) {
  const result = await call(type, { from: '2026-09-29', to: '2026-09-29' });
  assert.equal(result.code, 200);
  assert.equal(result.body.rows.length, 3);
  for (const row of result.body.rows) assert.deepEqual(row.slice(1, 4), [2, 5, 20]);
}
for (const [warehouse, order_date, qty] of [
  ['Fixture A', '2026-09-29', '2'], ['Fixture A', '2026-09-29', '3'],
  ['Fixture B', '2026-09-29', '100'], ['Fixture A', '2026-09-28', '100'],
  ['Fixture A', '', '100'],
]) await insert('fulfillment_orders', { warehouse, order_date, qty, sku_code: '__proto__', sku_name: 'Fixture product', amount: '10' });
const selected = await call('sku-wise-sales', { warehouse: 'Fixture A', from: '2026-09-29', to: '2026-09-29' });
assert.equal(selected.code, 200);
assert.deepEqual(selected.body.rows, [['__proto__', 'Fixture product', '-', 5, 20]]);
const upperBoundOnly = await call('sku-wise-sales', { warehouse: 'Fixture A', to: '2026-09-28' });
assert.equal(upperBoundOnly.body.rows[0][3], 100, 'undated records must not pass an upper date bound');
for (const filters of [{ from: '2026-02-30' }, { to: 'invalid' }, { from: '2026-09-30', to: '2026-09-29' }]) {
  assert.equal((await call('sales-report', filters)).code, 400);
}
await insert('sale_orders', { channel: 'Invalid fixture', qty: 'not a quantity', amount: 10 });
assert.equal((await call('sales-report')).code, 422);
console.log('PASS report filters: warehouse/date scope, undated exclusion, numeric totals, property-name keys and invalid input rejection.');
