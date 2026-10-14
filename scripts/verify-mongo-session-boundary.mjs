import assert from 'node:assert/strict';
import { withMongoSession } from '../api/mongo-session.js';
import { readMongoRows } from '../api/mongo-read.js';

function fixture({ failure, cleanupFailure } = {}) {
  let cleanupCalls = 0, transactionCalls = 0;
  const session = {
    async withTransaction(operation, options) {
      transactionCalls++;
      assert.equal(options.timeoutMS, 60000); assert.equal(options.maxCommitTimeMS, 15000);
      if (failure) throw failure;
      return operation();
    },
    async endSession() { cleanupCalls++; if (cleanupFailure) throw cleanupFailure; },
  };
  return { client: { startSession: () => session }, session, status: () => ({ cleanupCalls, transactionCalls }) };
}
const primary = Object.assign(new Error('controlled private transaction text'), { code: 11000 });
const cleanup = new Error('controlled private cleanup text');
const failed = fixture({ failure: primary, cleanupFailure: cleanup });
await assert.rejects(withMongoSession(failed.client, async () => 'unused'), error => error === primary);
assert.equal(failed.status().cleanupCalls, 1);
const committed = fixture({ cleanupFailure: cleanup });
assert.equal(await withMongoSession(committed.client, async session => { assert.equal(session, committed.session); return 'committed'; }), 'committed');
assert.equal(committed.status().cleanupCalls, 1);
for (const unknown of [{ errorLabels: ['UnknownTransactionCommitResult'] }, { hasErrorLabel: label => label === 'UnknownTransactionCommitResult', name: 'MongoOperationTimeoutError' }]) {
  const uncertain = fixture({ failure: Object.assign(new Error('controlled private commit text'), unknown) });
  await assert.rejects(withMongoSession(uncertain.client, async () => 'unused'), error => error.code === 'DATABASE_COMMIT_UNCERTAIN' && error.status === 503 && !error.message.includes('private'));
  assert.deepEqual(uncertain.status(), { cleanupCalls: 1, transactionCalls: 1 });
}
let closed = false;
const transaction = fixture();
await withMongoSession(transaction.client, async session => {
  const inherited = { start: 123, timeoutMS: 60000 };
  let clones = 0;
  session.timeoutContext = { clone() { clones++; return inherited; } };
  const cursor = { limit() { return this; }, batchSize() { return this; }, async *[Symbol.asyncIterator]() { yield { id: 1 }; }, async close() { closed = true; } };
  const collection = { find(query, options) { assert.equal(options.session, session); assert.equal(options.timeoutMS, undefined, 'Transaction reads must not override the session deadline'); assert.equal(options.timeoutContext, inherited, 'Cursor must inherit the existing absolute transaction deadline'); return cursor; } };
  assert.deepEqual(await readMongoRows(collection, {}, { session }), [{ id: 1 }]);
  assert.equal(clones, 1);
});
assert.equal(closed, true);
delete process.env.MONGODB_URI; delete process.env.MONGODB_DB; process.env.NODE_ENV = 'test'; process.env.DMILLS_REQUIRE_PERSISTENCE = 'false';
const { sendDatabaseUnavailable } = await import('../api/mongo.js');
const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
assert.equal(sendDatabaseUnavailable(response, { code: 'DATABASE_COMMIT_UNCERTAIN' }), true);
assert.equal(response.code, 503); assert.equal(response.body.error, 'DATABASE_COMMIT_UNCERTAIN');
assert.ok(response.body.message.includes('reconcile')); assert.ok(!response.body.message.includes('Please try again'));
console.log('PASS Mongo sessions: cleanup preserves committed result/primary error, bounded transaction options, unknown commit classification, session-owned read deadline and truthful HTTP response.');
