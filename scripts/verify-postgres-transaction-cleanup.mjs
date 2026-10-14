import assert from 'node:assert/strict';
import { runPostgresTransaction } from '../reliability/postgres-transaction.js';
import { sendDatabaseError } from '../reliability/api-errors.js';
function fixture({ rollbackFails = false, releaseFails = false, commitError } = {}) {
  const calls = [];
  return { calls, pool: { connect: async () => ({ query: async sql => {
    calls.push(sql);
    if (sql === 'ROLLBACK' && rollbackFails) throw Error('rollback detail');
    if (sql === 'COMMIT' && commitError) throw commitError;
  }, release: discard => { calls.push(['release', discard]); if (releaseFails) throw Error('release detail'); } }) } };
}
const success = fixture({ releaseFails: true });
assert.equal(await runPostgresTransaction(success.pool, async () => 'committed'), 'committed');
assert.deepEqual(success.calls, ['BEGIN', 'COMMIT', ['release', false]]);
const primary = Error('primary operation failure');
const failed = fixture({ rollbackFails: true, releaseFails: true });
await assert.rejects(runPostgresTransaction(failed.pool, async () => { throw primary; }), error => error === primary);
assert.deepEqual(failed.calls, ['BEGIN', 'ROLLBACK', ['release', true]]);
const commitError = Object.assign(Error('commit unavailable'), { code: 'DATABASE_UNAVAILABLE' });
const commit = fixture({ commitError, releaseFails: true });
await assert.rejects(runPostgresTransaction(commit.pool, async () => 'unconfirmed'), error => error.code === 'DATABASE_COMMIT_UNCERTAIN' && error.database === 'postgresql' && error.status === 503);
assert.deepEqual(commit.calls.at(-1), ['release', true]);
const business = Object.assign(Error('deferred constraint detail'), { code: '23505' });
await assert.rejects(runPostgresTransaction(fixture({ commitError: business }).pool, async () => 'unconfirmed'), error => error === business);
const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
assert.equal(sendDatabaseError(response, { code: 'DATABASE_COMMIT_UNCERTAIN', database: 'postgresql', message: 'private detail' }), true);
assert.equal(response.code, 503);
assert.match(response.body.message, /reconcile/);
assert.ok(!JSON.stringify(response.body).includes('private detail'));
console.log('PASS: PostgreSQL cleanup preserves outcomes, lost commit requires reconciliation, definitive constraints retain primary error and HTTP response is sanitized');
