import assert from 'node:assert/strict';
import { validateMongoUpdate, updateMongoDocuments, mongoMutationBudget } from '../api/mongo-mutation.js';

let dispatches = 0;
const forbidden = { findOneAndUpdate() { dispatches++; throw new Error('Unexpected write'); }, updateMany() { dispatches++; throw new Error('Unexpected write'); } };
for (const [ids, fields] of [[Array.from({ length: 1001 }, (_, i) => i + 1), {}], [[0], {}], [[{ $ne: null }], {}], [1, null], [1, []], [1, { id: 2 }], [[1, 2], { id: 1 }], [1, { text: 'x'.repeat(mongoMutationBudget.fieldBytes) }]]) {
  await assert.rejects(updateMongoDocuments(forbidden, ids, fields), error => ['DATABASE_MUTATION_LIMIT', 'DATABASE_MUTATION_INVALID'].includes(error.code));
}
assert.equal(dispatches, 0, 'Invalid/oversized requests must be rejected before writes');
assert.deepEqual(validateMongoUpdate([1, 1, 2], {}), [1, 2]);
assert.deepEqual(await updateMongoDocuments(forbidden, [], {}), []);
const single = { async findOneAndUpdate(query, update, options) { assert.deepEqual(query, { id: 1 }); assert.equal(options.includeResultMetadata, false); assert.equal(options.timeoutMS, 15000); return { id: 1, value: 'business-value', ...update.$set }; }, find() { throw new Error('No post-write read'); } };
assert.deepEqual(await updateMongoDocuments(single, 1, { status: 'Updated' }), [{ id: 1, value: 'business-value', status: 'Updated' }]);
assert.deepEqual(await updateMongoDocuments({ findOneAndUpdate: async () => null }, 1, {}), []);
let stored = [{ id: 1, status: 'Before' }, { id: 2, status: 'Before' }], sessionEnds = 0, readFailure;
const session = { async withTransaction(operation) { const before = structuredClone(stored); try { return await operation(); } catch (error) { stored = before; throw error; } }, async endSession() { sessionEnds++; } };
const client = { startSession: () => session };
const collection = {
  async updateMany(query, update, options) { assert.equal(options.session, session); stored = stored.map(row => query.id.$in.includes(row.id) ? { ...row, ...update.$set } : row); },
  find(query, options) {
    assert.equal(options.session, session);
    return { limit() { return this; }, batchSize() { return this; }, async *[Symbol.asyncIterator]() { if (readFailure) throw readFailure; for (const row of stored) if (query.id.$in.includes(row.id)) yield row; }, async close() {} };
  },
};
readFailure = Object.assign(new Error('controlled readback fault'), { code: 50 });
await assert.rejects(updateMongoDocuments(collection, [1, 2], { status: 'Changed' }, client), error => error === readFailure);
assert.ok(stored.every(row => row.status === 'Before'), 'Injected transaction fixture restores original state on readback failure');
readFailure = null;
assert.ok((await updateMongoDocuments(collection, [1, 2], { status: 'Changed' }, client)).every(row => row.status === 'Changed'));
assert.equal(sessionEnds, 2);

delete process.env.MONGODB_URI; delete process.env.MONGODB_DB; process.env.NODE_ENV = 'test'; process.env.DMILLS_REQUIRE_PERSISTENCE = 'false';
const { insert, update, find, findOne, saveValidationMaster, sendDatabaseUnavailable, updateIfRevision, updateAdminIfVersion, transitionGrnReceipt, claimUnmappedSkuLink } = await import('../api/mongo.js');
for (const [module, codeField, defaultField] of [['receipt-validation', 'receiving_validation_code', 'isDefault'], ['lottable-validation', 'lot_val_code', 'is_default']]) {
  await Promise.all(['FIRST', 'SECOND'].map(code => saveValidationMaster(null, { module, code, [codeField]: code, [defaultField]: true })));
  assert.equal((await find('generic_records', { module, [defaultField]: true })).length, 1);
  await assert.rejects(saveValidationMaster(null, { module, code: 'SECOND', [codeField]: 'SECOND', [defaultField]: true }), { statusCode: 409 });
  assert.equal((await find('generic_records', { module, [defaultField]: true })).length, 1);
}
for (const operation of [
  () => updateIfRevision('generic_records', 1, 0, { id: 2 }),
  () => updateAdminIfVersion(1, 0, { id: 2 }),
  () => transitionGrnReceipt(1, {}, { id: 2 }),
  () => claimUnmappedSkuLink(1, { id: 2 }),
]) await assert.rejects(operation(), { code: 'DATABASE_MUTATION_INVALID' });
const row = await insert('generic_records', { module: 'mutation-fixture', status: 'Before' });
await assert.rejects(insert('generic_records', { id: row.id, module: 'mutation-fixture' }), { code: 'DATABASE_MUTATION_INVALID' });
assert.equal((await find('generic_records', { id: row.id })).length, 1);
await assert.rejects(update('generic_records', row.id, { id: row.id + 1 }), error => error.code === 'DATABASE_MUTATION_INVALID');
assert.equal((await findOne('generic_records', { id: row.id })).status, 'Before');
assert.equal((await update('generic_records', row.id, { status: 'After' }))[0].status, 'After');
const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
assert.equal(sendDatabaseUnavailable(response, { code: 'DATABASE_MUTATION_LIMIT' }), true); assert.equal(response.code, 413);
console.log('PASS Mongo mutations: pre-write ID/field limits, immutable identity, atomic single-document result, transactional batch readback faults and explicit-memory integration. Real DB rollback remains separate.');
