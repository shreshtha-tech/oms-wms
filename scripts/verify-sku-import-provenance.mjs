// Disposable in-memory acceptance: no environment import, server or provider.
import assert from 'node:assert/strict';
delete process.env.MONGODB_URI;
delete process.env.MONGODB_DB;
process.env.NODE_ENV = 'test';
process.env.DMILLS_REQUIRE_PERSISTENCE = 'false';
const { insert, find, getMode } = await import('../api/mongo.js');
const { default: handler } = await import('../api/sku-imports.js');
await insert('generic_records', { module: 'attribute-set', name: 'provenance-fixture', status: 'Active' });
assert.equal(getMode(), 'memory', 'Acceptance must use the explicit empty-memory fixture');
const before = await find('skus', {});
const response = { code: 200, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
await handler({ method: 'POST', body: { import_type: 'CreateUpdate', attribute_set: 'provenance-fixture', file_name: 'missing.csv', success_records: 1, failed_records: 0 }, user: { username: 'provenance-fixture' } }, response);
const claimedImports = await find('generic_records', { module: 'sku-import' });
assert.deepEqual(await find('skus', {}), before, 'Claimed import supplied no actual SKU input');
console.log(JSON.stringify({ layer: 'EXPLICIT_MEMORY_FIXTURE', status: response.code, importRecords: claimedImports.length, claimedProcessed: claimedImports.some(row => row.status === 'Processed'), businessRowsChanged: false }));
assert.equal(response.code, 501, 'A disconnected SKU processor must not report a successful import from client-provided result counts');
assert.equal(claimedImports.length, 0, 'Disconnected import must not persist a processed import record');
console.log('PASS SKU import provenance: disconnected processor rejected without fake processed history.');
