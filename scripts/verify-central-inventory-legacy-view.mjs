import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchCentralInventoryRows, summarizeCentralInventory, toLegacyInventoryRows } from '../inventory/legacy-stock-view.js';

const centralRows = [
  { id: 'sku-a:loc-1', master_sku_id: 'sku-a', location_id: 'loc-1', sku_code: 'SKU-A', name: 'Product A', warehouse: 'WH-1', on_hand: '6', available: 5, reserved: '1' },
  { id: 'sku-a:loc-2', master_sku_id: 'sku-a', location_id: 'loc-2', sku_code: 'SKU-A', name: 'Product A', warehouse: 'WH-2', on_hand: 4, available: '2', reserved: 2 },
];
const legacyRows = toLegacyInventoryRows(centralRows);
assert.deepEqual(legacyRows.map(row => [row.on_hand, row.available, row.reserved]), [[6, 5, 1], [4, 2, 2]]);
assert.ok(legacyRows.every(row => row.stock_source === 'Central Inventory' && row.wac === null));
assert.equal(searchCentralInventoryRows(legacyRows, { skuCode: 'sku-a', skuDesc: 'product' }).length, 2);
assert.equal(searchCentralInventoryRows(legacyRows, { skuCode: 'missing' }).length, 0);

const summary = summarizeCentralInventory(legacyRows, [{ master_sku_code: 'SKU-A', reorder_point: 8 }]);
assert.equal(summary.length, 1);
assert.equal(summary[0].on_hand, 10);
assert.equal(summary[0].available, 7);
assert.equal(summary[0].reserved, 3);
assert.equal(summary[0].locations, 2);
assert.equal(summary[0].low_stock, true);
assert.equal(summarizeCentralInventory(legacyRows, [])[0].low_stock, false);

const api = await readFile(new URL('../api/inventory.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../api/dashboard.js', import.meta.url), 'utf8');
assert.match(api, /listCentralWmsStock\(\)/);
assert.match(api, /Inventory balances can only be changed through Central Inventory workflows/);
assert.doesNotMatch(api, /find\('inventory'|insert\('inventory'|update\('inventory'|remove\('inventory'/);
assert.match(dashboard, /listCentralWmsStock\(\)/);
assert.doesNotMatch(dashboard, /find\('inventory'/);

console.log('PASS legacy inventory reads and low-stock summaries derive from Central Inventory; direct Mongo balance writes are disabled');
