import assert from 'node:assert/strict';
import { recoverExpiredPublications } from '../inventory/publication-recovery.js';
import { runInventoryTaskBatch } from '../inventory/workers.js';
for (const limit of [0, -1, 1.5, '1', true, 101, Infinity]) await assert.rejects(runInventoryTaskBatch(limit), /integer from 1 to 100/);
const calls = [];
await recoverExpiredPublications({ query: async (sql, params) => {
  calls.push({ sql, params });
  return calls.length === 1 ? { rows: [
    { mapping_id: 'mapping-a', remote_target_quantity: 0, publication_state: 'UNKNOWN_REMOTE_STATE' },
    { mapping_id: 'mapping-b', remote_target_quantity: 7, publication_state: 'READBACK_PENDING' },
  ] } : { rows: [] };
} }, 'owned-tenant', 2);
assert.match(calls[0].sql, /ORDER BY id FOR UPDATE SKIP LOCKED LIMIT \$2/);
assert.match(calls[0].sql, /WHERE tenant_id=\$1 AND id IN/);
assert.deepEqual(calls[0].params, ['owned-tenant', 2]);
assert.deepEqual(calls[1].params, ['owned-tenant', 'mapping-a', 0, 'unknown_remote']);
assert.deepEqual(calls[2].params, ['owned-tenant', 'mapping-b', 7, 'readback_pending']);
console.log('PASS: invalid batch rejection before DB access, bounded tenant-scoped recovery query, zero target and both uncertainty projections');
