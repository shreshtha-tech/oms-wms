import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.MONGODB_URI = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { insert, find } = await import('../api/mongo.js');
const moveHandler = (await import('../api/inventory-move.js')).default;
const scanHandler = (await import('../api/inventory-move-scan.js')).default;
const invoke = async (handler, method, body = {}, query = {}) => {
  const res = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    setHeader() {},
  };
  await handler({ method, body, query, headers: {} }, res);
  return res;
};

const source = await insert('inventory', { sku_code: 'DM-SKU', name: 'D-Mills Product', warehouse: 'DMWH', bin: 'BIN-A', available: 10, on_hand: 10 });
const moveMeta = await invoke(moveHandler, 'GET');
assert.equal(moveMeta.payload.source, 'central-inventory');
assert.deepEqual(moveMeta.payload.products, []);
assert.deepEqual(moveMeta.payload.bins, []);
for (const action of ['search', 'execute', 'import']) {
  const response = await invoke(moveHandler, 'POST', { action, rows: [{ id: source.id, toBin: 'BIN-B', toQty: 3 }] });
  assert.equal(response.statusCode, 501, `inventory-move ${action} must be blocked`);
}

const scanMeta = await invoke(scanHandler, 'GET');
assert.equal(scanMeta.payload.source, 'central-inventory');
assert.deepEqual(scanMeta.payload.bins, []);
assert.deepEqual(scanMeta.payload.lpns, []);
for (const action of ['show-inventory', 'add-sku', 'lpn-move', 'lpn-to-lpn']) {
  const response = await invoke(scanHandler, 'POST', { action, skuCode: 'DM-SKU', fromLPN: 'LPN-A', toBin: 'BIN-B', qty: 3 });
  assert.equal(response.statusCode, 501, `inventory-move-scan ${action} must be blocked`);
}

const inventory = await find('inventory');
assert.equal(inventory.length, 1);
assert.equal(inventory[0].available, 10);
assert.equal(inventory[0].on_hand, 10);
assert.equal((await find('inventory_moves')).length, 0);

const moveUi = await readFile(new URL('../src/eretail/modules/InventoryMove.tsx', import.meta.url), 'utf8');
const scanUi = await readFile(new URL('../src/eretail/modules/InventoryMoveScan.tsx', import.meta.url), 'utf8');
assert.match(moveUi, /Bin-level moves are paused/);
assert.match(moveUi, /Execute Move<\/Btn>/);
assert.match(scanUi, /Bin and LPN moves are paused/);

console.log('PASS bin/LPN move endpoints return 501, UI identifies the missing mapping, and isolated Mongo stock remains unchanged');
