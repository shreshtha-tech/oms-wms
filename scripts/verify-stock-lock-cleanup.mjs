import assert from 'node:assert/strict';
import { releaseStockMappingLock } from '../inventory/stock-lock-cleanup.js';
async function wrapped(operation, { unlockFails = false, releaseFails = false, acknowledged = true } = {}) {
  const calls = [];
  const client = { query: async () => { calls.push('unlock'); if (unlockFails) throw Error('secret cleanup detail'); return { rows: [{ pg_advisory_unlock: acknowledged }] }; },
    release: discard => { calls.push(discard); if (releaseFails) throw Error('secret release detail'); } };
  try { return { result: await operation(), calls }; }
  finally { await releaseStockMappingLock(client, 'fixture-lock', { locked: true }); }
}
assert.deepEqual(await wrapped(async () => 'committed'), { result: 'committed', calls: ['unlock', false] });
assert.deepEqual(await wrapped(async () => 'committed', { unlockFails: true }), { result: 'committed', calls: ['unlock', true] });
assert.deepEqual(await wrapped(async () => 'committed', { acknowledged: false }), { result: 'committed', calls: ['unlock', true] });
assert.equal((await wrapped(async () => 'committed', { releaseFails: true })).result, 'committed');
const primary = Error('primary operation failure');
await assert.rejects(wrapped(async () => { throw primary; }, { unlockFails: true, releaseFails: true }), error => error === primary);
console.log('PASS: confirmed unlock reuses client, failed/unconfirmed unlock discards client, cleanup preserves success and exact primary failure');
