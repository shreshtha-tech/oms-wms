import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { applyInventoryEvent, InventoryConflict } from '../inventory/ledger.js';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';

validateTestStores(process.env);
const db = inventoryPool();
const tenantId = `partial-${randomUUID()}`;
const masterSkuId = randomUUID();
const locationId = randomUUID();
const base = { tenantId, masterSkuId, locationId, source: 'partial-fixture' };
const transition = (action, orderId, quantity, eventKey) => applyInventoryEvent({
  ...base, eventKey, eventType: action, delta_reserved_order: action === 'reserve' ? quantity : -quantity,
  delta_on_hand: action === 'consume' ? -quantity : 0,
  reservation: { action, orderId, lineId: 'line', quantity },
});
const reservation = async orderId => (await db.query('SELECT quantity,consumed_qty,released_qty,status FROM ci_reservation WHERE tenant_id=$1 AND external_order_id=$2', [tenantId, orderId])).rows[0];
const balance = async () => (await db.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3', [tenantId, masterSkuId, locationId])).rows[0];

try {
  // Reproduce pre-migration rows before applying the additive migration.
  const names = (await import('node:fs/promises')).readdir;
  for (const name of (await names(new URL('../db/migrations/', import.meta.url))).filter(name => /^0(0[1-9]|1\d|2\d)_.*\.sql$/.test(name)).sort()) {
    await db.query(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.query('INSERT INTO ci_master_sku(id,tenant_id,sku,product_name) VALUES($1,$2,$3,$4)', [masterSkuId, tenantId, 'PARTIAL-TEST', 'Partial fixture']);
  await db.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'WH','warehouse')", [locationId, tenantId]);
  await db.query('INSERT INTO ci_inventory_balance(tenant_id,master_sku_id,location_id,on_hand) VALUES($1,$2,$3,100)', [tenantId, masterSkuId, locationId]);
  for (const [orderId, status] of [['legacy-active', 'active'], ['legacy-consumed', 'consumed'], ['legacy-released', 'released']]) {
    await db.query('INSERT INTO ci_reservation(tenant_id,master_sku_id,location_id,source,external_order_id,external_line_id,quantity,status) VALUES($1,$2,$3,$4,$5,$6,4,$7)', [tenantId, masterSkuId, locationId, base.source, orderId, 'line', status]);
  }
  await migrateInventory();
  assert.deepEqual([await reservation('legacy-active'), await reservation('legacy-consumed'), await reservation('legacy-released')].map(row => [Number(row.consumed_qty), Number(row.released_qty), row.status]), [[0, 0, 'active'], [4, 0, 'consumed'], [0, 4, 'released']]);
  await transition('reserve', 'split', 20, 'reserve-split');
  const consumes = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => transition('consume', 'split', 1, `ship:split:${i}`)));
  assert.equal(consumes.filter(result => result.status === 'fulfilled').length, 20);
  assert.deepEqual([Number((await reservation('split')).consumed_qty), (await reservation('split')).status], [20, 'consumed']);
  await assert.rejects(() => transition('consume', 'split', 1, 'ship:split:21'), InventoryConflict);
  assert.equal((await transition('consume', 'split', 1, 'ship:split:0')).duplicate, true);
  await assert.rejects(() => transition('consume', 'split', 2, 'ship:split:0'), InventoryConflict);
  await transition('reserve', 'race', 10, 'reserve-race');
  const race = await Promise.allSettled([transition('consume', 'race', 7, 'ship:race'), transition('release', 'race', 7, 'cancel:race')]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  const raceRow = await reservation('race');
  assert.equal(Number(raceRow.consumed_qty) + Number(raceRow.released_qty), 7);
  await transition(raceRow.consumed_qty === '7' ? 'release' : 'consume', 'race', 3, 'race-remainder');
  assert.equal((await reservation('race')).status, 'closed_partial');
  const bulkSku = randomUUID();
  await db.query('INSERT INTO ci_master_sku(id,tenant_id,sku,product_name) VALUES($1,$2,$3,$4)', [bulkSku, tenantId, 'BULK-TEST', 'Bulk fixture']);
  const bulkBase = { ...base, masterSkuId: bulkSku };
  await applyInventoryEvent({ ...bulkBase, eventKey: 'bulk-opening', eventType: 'receipt', delta_on_hand: 10 });
  const reserves = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => applyInventoryEvent({ ...bulkBase, eventKey: `reserve-bulk-${i}`, eventType: 'reserve', delta_reserved_order: 1,
    reservation: { action: 'reserve', orderId: `bulk-${i}`, lineId: 'line', quantity: 1 },
  })));
  assert.equal(reserves.filter(result => result.status === 'fulfilled').length, 10);
  assert.equal(Number((await db.query('SELECT reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2', [tenantId, bulkSku])).rows[0].reserved_order), 10);
  const stock = await balance();
  assert.equal(Number(stock.reserved_order), 0);
  assert.ok(Number(stock.on_hand) >= Number(stock.reserved_order));
  await migrateInventory();
  assert.equal((await reservation('race')).status, 'closed_partial');
  console.log('PASS partial reservations: backfill, reapply, concurrent consume/release, replay and balance');
} finally {
  await db.end();
}
