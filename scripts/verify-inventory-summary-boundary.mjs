import assert from 'node:assert/strict';
import { readInventorySummary } from '../inventory/read-model.js';
let calls = 0;
let row = { catalog_skus: '3', counted_skus: '2', sellable: '7', low_stock: '1', active_accounts: '2' };
const db = { query: async (sql, values) => { calls++; assert.deepEqual(values, ['tenant-a']); assert.match(sql, /l.location_type IN \('warehouse','store'\)/); assert.match(sql, /COUNT\(DISTINCT b.master_sku_id\)/); assert.match(sql, /AND m.active/); return { rows: row ? [row] : [] }; } };
const result = await readInventorySummary('tenant-a', db);
assert.deepEqual(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'generatedAt')), { catalogSkus: 3, countedSkus: 2, sellable: 7, lowStock: 1, activeAccounts: 2 });
assert.equal(calls, 1);
for (const value of ['9007199254740992', '-1', 'NaN', '1.5']) { row.sellable = value; await assert.rejects(readInventorySummary('tenant-a', db), /numeric range/); }
row = null;
await assert.rejects(readInventorySummary('tenant-a', db), /unavailable/);
console.log('PASS: summary uses one aggregate query and preserves payload shape; unsafe totals or missing rows reject. SQL semantics need owned DB parity evidence.');
