import assert from 'node:assert/strict';
import { readTenantBalances, balanceReadBudget } from '../inventory/balance-read.js';
let rows = [];
const db = { async query(sql, values) {
  assert.match(sql, /WHERE tenant_id=\$1/);
  assert.match(sql, /ORDER BY master_sku_id,location_id LIMIT \$2/);
  assert.deepEqual(values, ['tenant-a', 10001]);
  return { rows };
} };
assert.deepEqual(await readTenantBalances(db, 'tenant-a'), []);
rows = Array.from({ length: 10000 }, (_, id) => ({ id, on_hand: '1', sellable: '1' }));
assert.equal((await readTenantBalances(db, 'tenant-a')).length, 10000);
rows.push({ id: 10000 });
await assert.rejects(readTenantBalances(db, 'tenant-a'), { code: 'BALANCE_RESULT_LIMIT', status: 413 });
rows = [{ note: 'é'.repeat(balanceReadBudget.bytes / 2) }];
await assert.rejects(readTenantBalances(db, 'tenant-a'), { code: 'BALANCE_RESULT_LIMIT' });
const outage = new Error('controlled query failure');
await assert.rejects(readTenantBalances({ query: async () => { throw outage; } }, 'tenant-a'), error => error === outage);
console.log('PASS: tenant-scoped SQL limit, complete 10,000-row response, excess/UTF-8 byte rejection, original query failure preserved.');
