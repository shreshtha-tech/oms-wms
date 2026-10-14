import assert from 'node:assert/strict';
import { inventoryDriftCount } from '../inventory/drift-count.js';
let query;
assert.equal(await inventoryDriftCount({ query: async (sql, params) => { query = { sql, params }; return { rows: [{ drift_count: '1000000' }] }; } }, 'owned-tenant'), 1000000);
assert.match(query.sql, /count\(\*\)::text/);
assert.match(query.sql, /m.tenant_id=s.tenant_id/);
assert.deepEqual(query.params, ['owned-tenant']);
for (const value of [undefined, '-1', '1.5', '9007199254740992', 1]) await assert.rejects(inventoryDriftCount({ query: async () => ({ rows: [{ drift_count: value }] }) }, 'owned-tenant'), /integer range/);
console.log('PASS: aggregate drift count, tenant join, safe-integer conversion and invalid/overflow rejection');
