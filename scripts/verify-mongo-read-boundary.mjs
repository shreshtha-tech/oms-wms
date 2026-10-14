import assert from 'node:assert/strict';
import { readMongoRows, readMongoOne, mongoReadBudget } from '../api/mongo-read.js';

function fixture(count, { large = false, failure, closeFailure, limit = mongoReadBudget.rows + 1 } = {}) {
  let closed = false, visited = 0;
  const cursor = {
    sort() { return this; }, project() { return this; },
    limit(value) { assert.equal(value, limit); return this; },
    batchSize(value) { assert.equal(value, 25); return this; },
    async *[Symbol.asyncIterator]() {
      for (let id = 0; id < Math.min(count, limit); id++) { visited++; if (failure) throw failure; yield large ? { id, text: 'x'.repeat(mongoReadBudget.bytes) } : { id }; }
    },
    async close() { closed = true; if (closeFailure) throw closeFailure; },
  };
  return { collection: { find(query, options) { assert.equal(query.tenant, 'fixture'); assert.equal(options.maxTimeMS, 15000); assert.equal(options.timeoutMS, 15000); assert.equal(options.timeoutMode, 'cursorLifetime'); return cursor; } }, status: () => ({ closed, visited }) };
}
for (const count of [0, 1, mongoReadBudget.rows]) {
  const item = fixture(count);
  assert.equal((await readMongoRows(item.collection, { tenant: 'fixture' })).length, count);
  assert.equal(item.status().closed, true);
}
const oversized = fixture(mongoReadBudget.rows + 100);
await assert.rejects(readMongoRows(oversized.collection, { tenant: 'fixture' }), error => error.status === 413 && error.code === 'DATABASE_RESULT_LIMIT');
assert.deepEqual(oversized.status(), { closed: true, visited: mongoReadBudget.rows + 1 });
const bigDocument = fixture(3, { large: true });
await assert.rejects(readMongoRows(bigDocument.collection, { tenant: 'fixture' }), error => error.code === 'DATABASE_RESULT_LIMIT');
assert.deepEqual(bigDocument.status(), { closed: true, visited: 1 });
const page = fixture(200, { limit: 100 });
assert.equal((await readMongoRows(page.collection, { tenant: 'fixture' }, { limit: 100 })).length, 100);
assert.deepEqual(page.status(), { closed: true, visited: 100 });
const oversizedPage = fixture(2, { large: true, limit: 1 });
await assert.rejects(readMongoRows(oversizedPage.collection, { tenant: 'fixture' }, { limit: 1 }), error => error.code === 'DATABASE_RESULT_LIMIT');
for (const limit of [0,-1,1.5,'10',true,10001]) {
 await assert.rejects(readMongoRows({ find() { assert.fail('Invalid page must fail before dispatch'); } }, {}, { limit }), error => error.code === 'DATABASE_PAGE_INVALID');
}
const primary = Object.assign(new Error('controlled private query text'), { code: 50 });
const failed = fixture(1, { failure: primary, closeFailure: new Error('cleanup') });
await assert.rejects(readMongoRows(failed.collection, { tenant: 'fixture' }), error => error === primary);
assert.equal(failed.status().closed, true);
await assert.rejects(readMongoRows(fixture(0, { closeFailure: primary }).collection, { tenant: 'fixture' }), error => error === primary);
let oneCalls = 0;
const collection = { find() { throw new Error('findOne must not materialize a cursor'); }, async findOne(query, options) { oneCalls++; assert.deepEqual(query, { id: 1 }); assert.equal(options.maxTimeMS, 15000); assert.equal(options.timeoutMS, 15000); return { id: 1 }; } };
assert.deepEqual(await readMongoOne(collection, { id: 1 }), { id: 1 }); assert.equal(oneCalls, 1);
assert.equal(await readMongoOne({ findOne: async () => null }, {}), null);

// Verify the public helper's memory contract without configured persistence.
delete process.env.MONGODB_URI; delete process.env.MONGODB_DB;
process.env.NODE_ENV = 'test'; process.env.DMILLS_REQUIRE_PERSISTENCE = 'false';
const { insert, find, findOne, sendDatabaseUnavailable } = await import('../api/mongo.js');
await insert('skus', { sku_code: 'READ-FIXTURE', name: 'Read fixture' });
assert.equal((await findOne('products', { sku_code: 'READ-FIXTURE' })).name, 'Read fixture');
assert.equal(await findOne('skus', { sku_code: 'ABSENT' }), null);
await insert('generic_records', { module: 'oversized-fixture', text: 'x'.repeat(mongoReadBudget.bytes) });
let denied;
try { await find('generic_records', { module: 'oversized-fixture' }); } catch (error) { denied = error; }
assert.equal(denied?.code, 'DATABASE_RESULT_LIMIT');
const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
assert.equal(sendDatabaseUnavailable(response, denied), true); assert.equal(response.code, 413);
assert.equal(JSON.stringify(response.body).includes('oversized-fixture'), false);
console.log('PASS Mongo reads: complete-or-error row/byte bounds, deadline, bounded cursor, cleanup, original error, genuine findOne, memory alias and safe HTTP 413.');
