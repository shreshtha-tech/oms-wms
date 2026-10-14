import assert from 'node:assert/strict';
// Explicit empty-memory fixture: never import configured environment files.
if (process.env.MONGODB_URI || process.env.MONGODB_DB) throw new Error('Use an isolated, unconfigured memory store.');
process.env.NODE_ENV = 'test';
process.env.DMILLS_REQUIRE_PERSISTENCE = 'false';
const { default: handler } = await import('../api/sku-imports.js');
const { find, insert, getMode } = await import('../api/mongo.js');
assert.equal(getMode(), 'memory');

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
assert.equal((await call('POST', { ...base, success_records: 0 })).code, 501);
assert.equal((await call('POST', { ...base, import_type: 'CostPriceUpdate' })).code, 400);
const before = await find('skus', {});
const unavailable = await call('POST', base);
assert.equal(unavailable.code, 501);
assert.equal(unavailable.body.error, 'SKU_IMPORT_PROCESSOR_UNAVAILABLE');
assert.deepEqual(await find('skus', {}), before);
assert.equal((await find('generic_records', { module: 'sku-import' })).length, 0);
console.log('PASS SKU Import: configured attributes, format/type validation, unavailable processor, no SKU mutations or fabricated history.');
