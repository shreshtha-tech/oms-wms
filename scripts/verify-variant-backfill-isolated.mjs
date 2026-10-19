import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { applyInventoryEvent } from '../inventory/ledger.js';
import { readVariantBackfillPlan } from '../inventory/variant-backfill-source.js';
import { applyVariantBackfill } from '../inventory/variant-backfill-apply.js';
import { closeDataStore } from '../api/mongo.js';
import { runSkuProjectionBatch } from '../inventory/sku-projection.js';
import { readInventoryOverview, readInventorySummary } from '../inventory/read-model.js';
import { approveReturnReceipt } from '../inventory/return-service.js';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';

validateTestStores(process.env);
const tenantId = `variant-backfill-${randomUUID()}`;
const root = await mkdtemp(join(tmpdir(), 'variant-backfill-test-'));
const pg = inventoryPool(), mongo = new MongoClient(process.env.MONGODB_URI);
try {
  await migrateInventory();
  await mongo.connect();
  for (const [kind, code] of [['brand', 'ACME'], ['brand', 'ZED'], ['category', 'JEANS'], ['type', 'SLIM'], ['color', 'BLACK'], ['size', '32']]) {
    await pg.query('INSERT INTO ci_attribute_value(tenant_id,kind,code) VALUES($1,$2,$3)', [tenantId, kind, code]);
  }
  const locationId = randomUUID();
  await pg.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'BACKFILL-WH','warehouse')", [locationId, tenantId]);
  const sourceIds = [];
  for (const [sku, onHand] of [['ACME-JEANS-SLIM-BLACK-32', 5], ['ZED-JEANS-SLIM-BLACK-32', 7]]) {
    const id = (await pg.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,$2,$3) RETURNING id', [tenantId, sku, 'Dry-run source'])).rows[0].id;
    sourceIds.push(id);
    await applyInventoryEvent({ tenantId, masterSkuId: id, locationId, source: 'backfill-test', eventKey: `source:${sku}`, eventType: 'receipt', delta_on_hand: onHand });
  }
  const secondLocationId = randomUUID();
  await pg.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'BACKFILL-WH-2','warehouse')", [secondLocationId, tenantId]);
  await applyInventoryEvent({ tenantId, masterSkuId: sourceIds[1], locationId: secondLocationId, source: 'backfill-test', eventKey: 'source:zed:second', eventType: 'receipt', delta_on_hand: 3 });
  await applyInventoryEvent({ tenantId, masterSkuId: sourceIds[1], locationId, source: 'backfill-test', eventKey: 'source:zed:encumbered', eventType: 'qc-mark', delta_damaged: 1, delta_quarantined: 1, delta_safety_stock: 1 });
  const accountId = randomUUID(), openOrderId = randomUUID(), historicalOrderId = randomUUID();
  await pg.query("INSERT INTO ci_channel_account(id,tenant_id,platform,external_account_id,status) VALUES($1,$2,'shopify','backfill-fixture','active')", [accountId, tenantId]);
  await pg.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,internal_location_id,active,approved_at) VALUES($1,$2,$3,'ACME-EXT',$4,true,now())", [tenantId, accountId, sourceIds[0], locationId]);
  for (const [orderId, workStatus] of [[openOrderId, 'new'], [historicalOrderId, 'dispatched']]) {
    await pg.query('INSERT INTO ci_unified_order(id,tenant_id,account_id,platform,external_order_id,provider_status,work_status) VALUES($1,$2,$3,$4,$5,$6,$7)', [orderId, tenantId, accountId, 'shopify', `order-${orderId}`, workStatus, workStatus]);
    await pg.query("INSERT INTO ci_unified_order_line(tenant_id,order_id,external_line_id,seller_sku,master_sku_id,quantity) VALUES($1,$2,'line','ZED-JEANS-SLIM-BLACK-32',$3,1)", [tenantId, orderId, sourceIds[1]]);
  }
  await pg.query("INSERT INTO ci_catalog_source_row(tenant_id,file_sha256,file_name,sheet_name,row_number,sku,master_sku_id) VALUES($1,$2,'fixture.xlsx','Catalog',2,'ACME-JEANS-SLIM-BLACK-32',$3)", [tenantId, 'a'.repeat(64), sourceIds[0]]);
  await mongo.db(process.env.MONGODB_DB).collection('skus').insertOne({ sku_code: 'ACME-JEANS-SLIM-BLACK-32', brand: 'ACME', category: 'JEANS', style: 'SLIM', color: 'BLACK', size: '32', name: 'Original legacy display' });
  const run = (args, overrides = {}) => {
    let stdout, exitCode = 0;
    try { stdout = execFileSync(process.execPath, ['scripts/variant-backfill.mjs', ...args], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, INVENTORY_ALLOWED_TENANT_ID: tenantId, VARIANT_BACKFILL_OUTPUT_ROOT: root, ...overrides },
      encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
    }); } catch (error) {
      if (error.status !== 2) throw error;
      exitCode = error.status;
      stdout = error.stdout;
    }
    const record = stdout.trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).find(line => line?.kind?.startsWith('variant_backfill_'));
    assert.ok(record, 'Backfill process must report its result');
    assert.equal(exitCode, record.state === 'HELD' ? 2 : 0, 'CLI exit code must reflect held work');
    return record;
  };
  const first = run(['--dry-run']), second = run([]);
  assert.equal(first.summary.sha256, second.summary.sha256);
  assert.equal(first.summary.variants, 1);
  assert.equal(first.summary.mergeable, 1);
  for (const directory of [first.directory, second.directory]) {
    assert.deepEqual((await readdir(directory)).sort(), ['conflicts.csv', 'mergeable.json', 'review.csv', 'summary.json', 'variants.csv']);
    assert.match(await readFile(join(directory, 'variants.csv'), 'utf8'), /JEANS\|SLIM\|BLACK\|32/);
    assert.equal(JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8')).sha256, first.summary.sha256);
  }
  const variantArtifact = join(first.directory, 'variants.csv'), originalVariantArtifact = await readFile(variantArtifact, 'utf8');
  await writeFile(variantArtifact, `${originalVariantArtifact}\nchanged after review`);
  assert.throws(() => run(['--apply', '--plan', first.directory, '--expect-hash', first.summary.sha256]));
  await writeFile(variantArtifact, originalVariantArtifact);
  assert.throws(() => run(['--apply', '--plan', first.directory, '--expect-hash', '0'.repeat(64)]));
  assert.equal((await pg.query('SELECT sum(on_hand)::int AS n FROM ci_inventory_balance WHERE tenant_id=$1', [tenantId])).rows[0].n, 15, 'Hash mismatch must not change stock');
  const applied = run(['--apply', '--plan', first.directory, '--expect-hash', first.summary.sha256]);
  assert.equal(applied.results.filter(row => row.merged).length, 2);
  const canonical = (await pg.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND sku=$2', [tenantId, 'JEANS-SLIM-BLACK-32'])).rows[0];
  assert.ok(canonical);
  assert.equal((await pg.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3', [tenantId, canonical.id, locationId])).rows[0].on_hand, '12');
  assert.equal((await pg.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3', [tenantId, canonical.id, secondLocationId])).rows[0].on_hand, '3');
  const condition = (await pg.query('SELECT damaged,quarantined,safety_stock FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3', [tenantId, canonical.id, locationId])).rows[0];
  assert.deepEqual(condition, { damaged: '1', quarantined: '1', safety_stock: '1' });
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM ci_inventory_event WHERE tenant_id=$1', [tenantId])).rows[0].n, 10);
  const repeated = run(['--apply', '--plan', first.directory, '--expect-hash', first.summary.sha256], { MONGODB_URI: `mongodb://127.0.0.1:1/${process.env.MONGODB_DB}` });
  assert.equal(repeated.results.filter(row => row.duplicate).length, 2);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM ci_inventory_event WHERE tenant_id=$1', [tenantId])).rows[0].n, 10, 'Replay must not create new stock events');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM ci_master_sku WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND merged_into_id=$3', [tenantId, sourceIds, canonical.id])).rows[0].n, 2);
  assert.deepEqual((await readInventoryOverview(tenantId)).products.map(row => row.sku), ['JEANS-SLIM-BLACK-32']);
  assert.equal((await readInventorySummary(tenantId)).catalogSkus, 1);
  process.env.INVENTORY_ALLOWED_TENANT_ID = tenantId;
  assert.equal((await runSkuProjectionBatch()).projected, 2);
  const projectedLegacy = await mongo.db(process.env.MONGODB_DB).collection('skus').findOne({ sku_code: 'ACME-JEANS-SLIM-BLACK-32' });
  assert.equal(projectedLegacy.tenant_id, tenantId);
  assert.equal(projectedLegacy.ci_projection.master_sku_id, canonical.id);
  assert.equal(projectedLegacy.name, 'Original legacy display');
  assert.equal((await pg.query('SELECT master_sku_id FROM ci_channel_mapping WHERE tenant_id=$1 AND external_sku=$2', [tenantId, 'ACME-EXT'])).rows[0].master_sku_id, canonical.id);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM ci_outbox o JOIN ci_channel_mapping m ON m.id=o.mapping_id WHERE o.tenant_id=$1 AND m.external_sku='ACME-EXT' AND o.payload->>'source'='variant_merge'", [tenantId])).rows[0].n, 1, 'Repointed active listing needs a final pooled-stock publication intent');
  assert.equal((await pg.query('SELECT master_sku_id FROM ci_unified_order_line WHERE tenant_id=$1 AND order_id=$2', [tenantId, openOrderId])).rows[0].master_sku_id, canonical.id);
  assert.equal((await pg.query('SELECT master_sku_id FROM ci_unified_order_line WHERE tenant_id=$1 AND order_id=$2', [tenantId, historicalOrderId])).rows[0].master_sku_id, sourceIds[1]);
  assert.equal((await pg.query('SELECT master_sku_id FROM ci_catalog_source_row WHERE tenant_id=$1 AND sku=$2', [tenantId, 'ACME-JEANS-SLIM-BLACK-32'])).rows[0].master_sku_id, canonical.id);
  await pg.query("INSERT INTO ci_attribute_value(tenant_id,kind,code) VALUES($1,'size','33')", [tenantId]);
  const heldId = (await pg.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'ACME-JEANS-SLIM-BLACK-33','Reserved source') RETURNING id", [tenantId])).rows[0].id;
  await applyInventoryEvent({ tenantId, masterSkuId: heldId, locationId, source: 'backfill-test', eventKey: 'held-receipt', eventType: 'receipt', delta_on_hand: 5 });
  await applyInventoryEvent({ tenantId, masterSkuId: heldId, locationId, source: 'backfill-test-order', eventKey: 'held-reserve', eventType: 'reserve', delta_reserved_order: 2, reservation: { action: 'reserve', orderId: 'held-order', lineId: 'held-line', quantity: 2 } });
  const heldPlan = run(['--dry-run']);
  const heldResult = run(['--apply', '--plan', heldPlan.directory, '--expect-hash', heldPlan.summary.sha256]);
  assert.deepEqual(heldResult.results.filter(row => row.held).map(row => row.reason), ['ACTIVE_RESERVATIONS']);
  assert.equal(heldResult.results.find(row => row.sourceId === heldId).details.reservations[0].external_order_id, 'held-order');
  assert.equal((await pg.query('SELECT merge_in_progress FROM ci_master_sku WHERE tenant_id=$1 AND id=$2', [tenantId, heldId])).rows[0].merge_in_progress, false);
  await pg.query('UPDATE ci_master_sku SET merge_in_progress=true WHERE tenant_id=$1 AND id=$2', [tenantId, heldId]);
  await assert.rejects(applyInventoryEvent({ tenantId, masterSkuId: heldId, locationId, source: 'backfill-test-order', eventKey: 'concurrent-reserve', eventType: 'reserve', delta_reserved_order: 1, reservation: { action: 'reserve', orderId: 'concurrent-order', lineId: 'line', quantity: 1 } }), /being merged/);
  await pg.query('UPDATE ci_master_sku SET merge_in_progress=false WHERE tenant_id=$1 AND id=$2', [tenantId, heldId]);
  assert.equal((await pg.query('SELECT on_hand,reserved_order FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3', [tenantId, heldId, locationId])).rows[0].on_hand, '5');
  await pg.query("INSERT INTO ci_attribute_value(tenant_id,kind,code) VALUES($1,'size','34')", [tenantId]);
  const recoveryId = (await pg.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'ZED-JEANS-SLIM-BLACK-34','Recovery source') RETURNING id", [tenantId])).rows[0].id;
  await applyInventoryEvent({ tenantId, masterSkuId: recoveryId, locationId, source: 'backfill-test', eventKey: 'recovery:first', eventType: 'receipt', delta_on_hand: 3 });
  await applyInventoryEvent({ tenantId, masterSkuId: recoveryId, locationId: secondLocationId, source: 'backfill-test', eventKey: 'recovery:second', eventType: 'receipt', delta_on_hand: 4 });
  const recoveryPlan = await readVariantBackfillPlan(pg, tenantId);
  let committedLocations = 0;
  await assert.rejects(applyVariantBackfill({ tenantId, expectHash: recoveryPlan.summary.sha256, currentPlan: recoveryPlan, reviewedMergeable: recoveryPlan.mergeable, onLocationCommitted: () => { if (++committedLocations === 1) throw new Error('synthetic interruption'); } }), /synthetic interruption/);
  assert.equal(committedLocations, 1);
  assert.equal((await pg.query('SELECT merge_in_progress FROM ci_master_sku WHERE tenant_id=$1 AND id=$2', [tenantId, recoveryId])).rows[0].merge_in_progress, true);
  const resumed = await applyVariantBackfill({ tenantId, expectHash: recoveryPlan.summary.sha256, currentPlan: await readVariantBackfillPlan(pg, tenantId), reviewedMergeable: recoveryPlan.mergeable });
  assert.ok(resumed.results.some(row => row.sourceId === recoveryId && row.merged));
  const recoveryTarget = (await pg.query("SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND sku='JEANS-SLIM-BLACK-34'", [tenantId])).rows[0].id;
  assert.equal((await pg.query('SELECT sum(on_hand)::int AS n FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2', [tenantId, recoveryTarget])).rows[0].n, 7);
  assert.equal((await pg.query('SELECT sum(on_hand)::int AS n FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2', [tenantId, recoveryId])).rows[0].n, 0);
  await pg.query("INSERT INTO ci_attribute_value(tenant_id,kind,code) VALUES($1,'size','35')", [tenantId]);
  const verifiedId = (await pg.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name,opening_stock_active,opening_stock_verified_at,opening_stock_verified_by) VALUES($1,'ACME-JEANS-SLIM-BLACK-35','Verified source',true,now(),'fixture-approver') RETURNING id", [tenantId])).rows[0].id;
  await applyInventoryEvent({ tenantId, masterSkuId: verifiedId, locationId, source: 'backfill-test', eventKey: 'verified-receipt', eventType: 'receipt', delta_on_hand: 2 });
  const verifiedPlan = run(['--dry-run']);
  const verifiedLive = await readVariantBackfillPlan(pg, tenantId);
  assert.equal(verifiedLive.summary.sha256, verifiedPlan.summary.sha256, 'The live source must remain stable before apply');
  const verifiedResult = run(['--apply', '--plan', verifiedPlan.directory, '--expect-hash', verifiedPlan.summary.sha256]);
  assert.equal(verifiedResult.results.find(row => row.sourceId === verifiedId)?.reason, 'OPENING_STOCK_TARGET_UNVERIFIED');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM ci_variant_merge_audit WHERE tenant_id=$1 AND source_id=$2', [tenantId, verifiedId])).rows[0].n, 0);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM ci_master_sku WHERE tenant_id=$1 AND sku='JEANS-SLIM-BLACK-35'", [tenantId])).rows[0].n, 0);
  const returnTenant = `variant-return-${randomUUID()}`, returnLocation = randomUUID(), returnAccount = randomUUID(), returnOrder = randomUUID(), returnCase = randomUUID();
  for (const [kind, code] of [['brand', 'ACME'], ['category', 'JEANS'], ['type', 'SLIM'], ['color', 'BLACK'], ['size', '36']]) await pg.query('INSERT INTO ci_attribute_value(tenant_id,kind,code) VALUES($1,$2,$3)', [returnTenant, kind, code]);
  const returnSource = (await pg.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'ACME-JEANS-SLIM-BLACK-36','Historical return source') RETURNING id", [returnTenant])).rows[0].id;
  await pg.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'RETURN-WH','warehouse')", [returnLocation, returnTenant]);
  await pg.query("INSERT INTO ci_channel_account(id,tenant_id,platform,external_account_id) VALUES($1,$2,'shopify','return-fixture')", [returnAccount, returnTenant]);
  await pg.query("INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,internal_location_id) VALUES($1,$2,$3,'ACME-JEANS-SLIM-BLACK-36',$4)", [returnTenant, returnAccount, returnSource, returnLocation]);
  await pg.query("INSERT INTO ci_unified_order(id,tenant_id,account_id,platform,external_order_id,provider_status,work_status) VALUES($1,$2,$3,'shopify','return-order','fulfilled','dispatched')", [returnOrder, returnTenant, returnAccount]);
  await pg.query("INSERT INTO ci_unified_order_line(tenant_id,order_id,external_line_id,seller_sku,master_sku_id,quantity) VALUES($1,$2,'line','ACME-JEANS-SLIM-BLACK-36',$3,1)", [returnTenant, returnOrder, returnSource]);
  await applyInventoryEvent({ tenantId: returnTenant, masterSkuId: returnSource, locationId: returnLocation, source: 'return-fixture', eventKey: 'return-source-receipt', eventType: 'receipt', delta_on_hand: 5 });
  const reservationSource = `shopify:${returnAccount}`;
  await applyInventoryEvent({ tenantId: returnTenant, masterSkuId: returnSource, locationId: returnLocation, source: reservationSource, eventKey: 'return-source-reserve', eventType: 'reserve', delta_reserved_order: 1, reservation: { action: 'reserve', orderId: 'return-order', lineId: 'line', quantity: 1 } });
  await applyInventoryEvent({ tenantId: returnTenant, masterSkuId: returnSource, locationId: returnLocation, source: reservationSource, eventKey: 'return-source-dispatch', eventType: 'dispatch', delta_on_hand: -1, delta_reserved_order: -1, reservation: { action: 'consume', orderId: 'return-order', lineId: 'line', quantity: 1 } });
  await pg.query("INSERT INTO ci_return_case(id,tenant_id,account_id,platform,external_return_id,external_order_id,provider_status,qc_status) VALUES($1,$2,$3,'shopify','return-1','return-order','received','received')", [returnCase, returnTenant, returnAccount]);
  const returnPlan = await readVariantBackfillPlan(pg, returnTenant);
  const returnMerge = await applyVariantBackfill({ tenantId: returnTenant, expectHash: returnPlan.summary.sha256, currentPlan: returnPlan, reviewedMergeable: returnPlan.mergeable });
  assert.equal(returnMerge.results.filter(row => row.merged).length, 1);
  const returnCanonical = (await pg.query("SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND sku='JEANS-SLIM-BLACK-36'", [returnTenant])).rows[0].id;
  const receipt = await approveReturnReceipt({ tenantId: returnTenant, returnId: returnCase, requestId: randomUUID(), masterSkuId: returnCanonical, locationId: returnLocation, quantity: 1 });
  assert.equal(receipt.duplicate, false);
  assert.equal((await pg.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3', [returnTenant, returnCanonical, returnLocation])).rows[0].on_hand, '5');
  const mixedTenant = `variant-mixed-${randomUUID()}`, mixedLocation = randomUUID();
  for (const [kind, code] of [['brand', 'ACME'], ['brand', 'ZED'], ['brand', 'NOVA'], ['category', 'JEANS'], ['type', 'SLIM'], ['color', 'BLACK'], ['size', '37']]) {
    await pg.query('INSERT INTO ci_attribute_value(tenant_id,kind,code) VALUES($1,$2,$3)', [mixedTenant, kind, code]);
  }
  await pg.query("INSERT INTO ci_location(id,tenant_id,code,location_type) VALUES($1,$2,'MIXED-WH','warehouse')", [mixedLocation, mixedTenant]);
  const mixedSources = [];
  for (const [brand, units] of [['ACME', 2], ['ZED', 3], ['NOVA', 4]]) {
    const id = (await pg.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,$2,$3) RETURNING id', [mixedTenant, `${brand}-JEANS-SLIM-BLACK-37`, `${brand} fixture`])).rows[0].id;
    mixedSources.push(id);
    await applyInventoryEvent({ tenantId: mixedTenant, masterSkuId: id, locationId: mixedLocation, source: 'mixed-backfill', eventKey: `mixed:${brand}`, eventType: 'receipt', delta_on_hand: units });
  }
  await applyInventoryEvent({ tenantId: mixedTenant, masterSkuId: mixedSources[2], locationId: mixedLocation, source: 'mixed-backfill', eventKey: 'mixed:reserve', eventType: 'reserve', delta_reserved_order: 1, reservation: { action: 'reserve', orderId: 'mixed-order', lineId: 'mixed-line', quantity: 1 } });
  const mixedPlan = await readVariantBackfillPlan(pg, mixedTenant);
  assert.equal(mixedPlan.mergeable.length, 1, 'All three brand SKUs must resolve to one physical variant');
  const mixedApply = await applyVariantBackfill({ tenantId: mixedTenant, expectHash: mixedPlan.summary.sha256, currentPlan: mixedPlan, reviewedMergeable: mixedPlan.mergeable });
  assert.equal(mixedApply.results.filter(row => row.merged).length, 2, 'Unreserved sources must merge');
  assert.deepEqual(mixedApply.results.filter(row => row.held).map(row => [row.sourceId, row.reason]), [[mixedSources[2], 'ACTIVE_RESERVATIONS']]);
  const mixedCanonical = (await pg.query("SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND sku='JEANS-SLIM-BLACK-37'", [mixedTenant])).rows[0].id;
  assert.equal((await pg.query('SELECT sum(on_hand)::int AS total FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2', [mixedTenant, mixedCanonical])).rows[0].total, 5);
  assert.equal((await pg.query('SELECT sum(on_hand)::int AS total FROM ci_inventory_balance WHERE tenant_id=$1', [mixedTenant])).rows[0].total, 9, 'Partial plan apply must conserve all physical stock');
  console.log('PASS variant backfill: reviewed artifact/hash gates, paired multi-location stock conservation, mapping and order repoint, legacy Mongo claim, replay and interrupted recovery, reservation/merge write refusal, mixed three-brand variant with one reserved source held, opening-stock gate, historical return into canonical pool');
} finally {
  await closeDataStore();
  await mongo.close();
  await pg.end();
  await rm(root, { recursive: true, force: true });
}
