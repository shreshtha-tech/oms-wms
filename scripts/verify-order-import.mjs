import assert from 'node:assert/strict';
import handler from '../api/order-import.js';

const call = async (method, body = {}) => {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method, body }, response);
  return response;
};

const metadata = await call('GET');
assert.deepEqual(metadata.body.importTypes.map(row => row[1]), ['--- Select ---', 'Normal Order Import', 'Order Updation', 'POS Order Import', 'Update logistics detail']);
assert.deepEqual(metadata.body.pageSizes, [20, 50, 100, 200]);
assert.equal((await call('POST', { action: 'import', importType: '-1' })).body.error, 'Import Type is mandatory.');
assert.equal((await call('POST', { action: 'import', importType: '530' })).body.error, 'No file chosen to import.');
for (const [id] of metadata.body.importTypes.slice(1)) {
  const response = await call('POST', { action: 'template', importType: id });
  assert.equal(response.code, 501);
  assert.match(response.body.error, /storage is not connected/i);
}
const attempted = await call('POST', { action: 'import', importType: '530', fileName: 'orders.csv', content: 'ORDER-1,EXT-1,SKU-1\nFAIL-ORDER,EXT-2,SKU-2,invalid' });
assert.equal(attempted.code, 501);
assert.match(attempted.body.error, /No business processor is connected/i);
assert.equal((await call('POST', { action: 'results', result: 'Success' })).code, 501);
console.log('PASS Order Import: metadata and input validation remain; template, import, and history clearly report missing services without fabricated success.');
