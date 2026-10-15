import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inventoryPool, migrateInventory, transaction } from '../inventory/db.js';
import { upsertMaster } from '../inventory/sku-service.js';
import { applyInventoryEvent } from '../inventory/ledger.js';
import { closeDataStore } from '../api/mongo.js';
import ExcelJS from 'exceljs';
import { previewWorkbook, commitWorkbook } from '../inventory/workbook.js';
import legacySkuHandler from '../api/skus.js';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';

validateTestStores(process.env);
const db = inventoryPool();
const tenantId = `sku-service-${randomUUID()}`;
const matching = brand => ({ status: 'ready', row: { brand, category: 'JEANS', style: 'SLIM', color: 'BLACK', size: '32' } });
const put = (sku, extra = {}) => transaction(tx => upsertMaster(tx, {
  tenantId, sku, productName: 'Shared jeans', source: 'manual',
  mongoLookup: async () => matching(sku.split('-')[0]), ...extra,
}));
try {
  await migrateInventory();
  for (const [kind, code] of [['brand', 'ACME'], ['brand', 'ZED'], ['brand', 'NOVA'], ['brand', 'LUMA'], ['category', 'JEANS'], ['type', 'SLIM'], ['color', 'BLACK'], ['size', '32']]) {
    await db.query('INSERT INTO ci_attribute_value(tenant_id,kind,code) VALUES($1,$2,$3)', [tenantId, kind, code]);
  }
  const [acme, zed] = await Promise.all([put('ACME-JEANS-SLIM-BLACK-32'), put('ZED-JEANS-SLIM-BLACK-32')]);
  assert.equal(acme.id, zed.id, 'Two brand SKUs must share one physical variant');
  assert.equal(acme.variant_key, 'JEANS|SLIM|BLACK|32');
  assert.equal(acme.attr_status, 'verified');
  assert.equal((await db.query('SELECT count(*)::int n FROM ci_master_sku WHERE tenant_id=$1', [tenantId])).rows[0].n, 1);
  assert.equal((await db.query("SELECT count(*)::int n FROM ci_sku_projection_outbox WHERE tenant_id=$1 AND status='pending'", [tenantId])).rows[0].n, 2);
  const sharedLocation = randomUUID();
  await db.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'SHARED-WH','warehouse')", [sharedLocation, tenantId]);
  await applyInventoryEvent({ tenantId, masterSkuId: acme.id, locationId: sharedLocation, source: 'sku-service-fixture', eventKey: 'shared-opening', eventType: 'receipt', delta_on_hand: 5 });
  const countsWorkbook = async rows => {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Physical counts');
    sheet.addRow(['SKU', 'Stock']);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await book.xlsx.writeBuffer());
  };
  const duplicateCounts = await previewWorkbook({ tenantId, fileName: 'counts.xlsx', bytes: await countsWorkbook([['ACME-JEANS-SLIM-BLACK-32', 4], ['ZED-JEANS-SLIM-BLACK-32', 4]]), mode: 'counts', locationId: sharedLocation });
  assert.equal(duplicateCounts.id, null, 'Two brand aliases must not count the same physical pool twice');
  assert.ok(duplicateCounts.errors.some(error => error.message.includes('Duplicate SKU/location')));
  const countPreview = await previewWorkbook({ tenantId, fileName: 'counts.xlsx', bytes: await countsWorkbook([['ZED-JEANS-SLIM-BLACK-32', 4]]), mode: 'counts', locationId: sharedLocation });
  assert.ok(countPreview.id, 'A brand alias must resolve to the canonical physical pool');
  assert.equal((await commitWorkbook(tenantId, countPreview.id)).stockEvents, 1);
  assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3', [tenantId, acme.id, sharedLocation])).rows[0].on_hand, '4');
  assert.equal((await put('ACME-JEANS-SLIM-BLACK-32')).duplicate, true);
  assert.equal((await db.query('SELECT count(*)::int n FROM ci_sku_projection_outbox WHERE tenant_id=$1', [tenantId])).rows[0].n, 2);
  await assert.rejects(put('ACME-JEANS-SLIM-BLACK-32', { createOnly: true }), error => error.status === 409);
  const mismatch = await put('NOVA-JEANS-SLIM-BLACK-32', { mongoLookup: async () => ({ status: 'ready', row: { ...matching('NOVA').row, color: 'NAVY-BLUE' } }) });
  assert.equal(mismatch.attr_status, 'review');
  assert.equal(mismatch.variant_key, null);
  assert.ok(mismatch.reviewIssues.some(issue => issue.code === 'SOURCE_CONFLICT'));
  const unavailable = await put('ZED-JEANS-SLIM-BLACK-33', { mongoLookup: async () => ({ status: 'unavailable', row: null }) });
  assert.equal(unavailable.attr_status, 'review');
  assert.equal(unavailable.variant_key, null);
  assert.ok(unavailable.reviewIssues.some(issue => issue.code === 'MONGO_VERIFICATION_UNAVAILABLE'));
  const legacyId = (await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'LUMA-JEANS-SLIM-BLACK-32','Existing legacy') RETURNING id", [tenantId])).rows[0].id;
  // An already-stocked legacy identity must not be silently pooled by parsing.
  const location = randomUUID();
  await db.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'WH','warehouse')", [location, tenantId]);
  await applyInventoryEvent({ tenantId, masterSkuId: legacyId, locationId: location, source: 'sku-service-fixture', eventKey: 'legacy-opening', eventType: 'receipt', delta_on_hand: 5 });
  const existing = await put('LUMA-JEANS-SLIM-BLACK-32');
  assert.equal(existing.attr_status, 'review');
  assert.equal(existing.id, legacyId);
  assert.equal((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2', [tenantId, legacyId])).rows[0].on_hand, '5');
  assert.equal((await db.query('SELECT count(*)::int n FROM ci_inventory_event WHERE tenant_id=$1 AND master_sku_id=$2', [tenantId, legacyId])).rows[0].n, 1);
  const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  for (const method of ['POST', 'PUT']) {
    const res = response();
    await legacySkuHandler({ method, body: { sku_code: 'BYPASS', name: 'Blocked' }, headers: {} }, res);
    assert.equal(res.statusCode, 501, `Direct Mongo SKU ${method} must stay blocked`);
    assert.equal(res.body.code, 'SKU_MASTER_POSTGRES_REQUIRED');
  }
  console.log('PASS SKU service: cross-brand canonical master, alias replay, outbox intent, source disagreement and unavailable review, no stock mutation');
} finally {
  await closeDataStore();
  await db.end();
}
