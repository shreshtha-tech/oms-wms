import assert from 'node:assert/strict';
import handler from '../api/sku-imports.js';
import { find, insert } from '../api/mongo.js';

if (process.env.MONGODB_URI) throw new Error('Use an isolated, unconfigured memory store.');
const call = async (method, body = {}) => {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method, body, query: {} }, response);
  return response;
};
assert.deepEqual((await call('GET')).body.attributeSets, []);
await insert('generic_records', { module: 'attribute-set', name: 'Configured test set', status: 'Active' });
await insert('generic_records', { module: 'attribute-set', name: 'Inactive test set', status: 'Inactive' });
assert.deepEqual((await call('GET')).body.attributeSets, ['Configured test set']);
const base = { import_type: 'CreateUpdate', attribute_set: 'Configured test set', file_name: 'test.csv', success_records: 1, failed_records: 0 };
assert.equal((await call('POST', { ...base, file_name: 'test.xlsx' })).code, 400);
assert.equal((await call('POST', { ...base, success_records: 0 })).code, 400);
assert.equal((await call('POST', { ...base, import_type: 'CostPriceUpdate' })).code, 400);
assert.equal((await call('POST', base)).code, 201);
assert.equal((await find('generic_records', { module: 'sku-import' })).length, 1);
console.log('SKU Import configured attributes, unsupported format/type and result validation passed.');
