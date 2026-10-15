import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { inventoryPool, migrateInventory, transaction } from '../inventory/db.js';
import { upsertMaster } from '../inventory/sku-service.js';
import { runSkuProjectionBatch } from '../inventory/sku-projection.js';
import { closeDataStore } from '../api/mongo.js';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';

validateTestStores(process.env);
process.env.INVENTORY_ALLOWED_TENANT_ID = 'sku-projection-synthetic';
const tenantId = process.env.INVENTORY_ALLOWED_TENANT_ID;
const pg = inventoryPool();
const mongo = new MongoClient(process.env.MONGODB_URI);
const matching = brand => ({ status: 'ready', row: { brand, category: 'JEANS', style: 'SLIM', color: 'BLACK', size: '32' } });
const put = sku => transaction(db => upsertMaster(db, {
  tenantId, sku, productName: 'Shared jeans', source: 'manual',
  mongoLookup: async () => matching(sku.split('-')[0]),
}));
const status = async sku => (await pg.query('SELECT status,reason FROM ci_sku_projection_outbox WHERE tenant_id=$1 AND alias_sku=$2 ORDER BY revision DESC LIMIT 1', [tenantId, sku])).rows[0];
try {
  await mongo.connect();
  const skus = mongo.db(process.env.MONGODB_DB).collection('skus');
  await migrateInventory();
  for (const [kind, code] of [['brand', 'ACME'], ['brand', 'ZED'], ['brand', 'NOVA'], ['category', 'JEANS'], ['type', 'SLIM'], ['color', 'BLACK'], ['size', '32']]) {
    await pg.query('INSERT INTO ci_attribute_value(tenant_id,kind,code) VALUES($1,$2,$3)', [tenantId, kind, code]);
  }
  const acme = await put('ACME-JEANS-SLIM-BLACK-32');
  assert.equal((await status('ACME-JEANS-SLIM-BLACK-32')).status, 'pending');
  assert.deepEqual(await runSkuProjectionBatch(), { projected: 1, recovered: 0 });
  let doc = await skus.findOne({ sku_code: 'ACME-JEANS-SLIM-BLACK-32' });
  assert.equal(doc.master_sku_code, 'JEANS-SLIM-BLACK-32');
  assert.equal(doc.ci_projection.master_sku_id, acme.id);
  assert.ok(Number.isSafeInteger(doc.id) && doc.id > 0);
  assert.equal((await status('ACME-JEANS-SLIM-BLACK-32')).status, 'done');
  assert.deepEqual(await runSkuProjectionBatch(), { projected: 0, recovered: 0 });
  await pg.query("UPDATE ci_sku_projection_outbox SET status='processing',claim_token=$3,lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND alias_sku=$2", [tenantId, 'ACME-JEANS-SLIM-BLACK-32', randomUUID()]);
  assert.deepEqual(await runSkuProjectionBatch(), { projected: 0, recovered: 1 });
  assert.equal((await status('ACME-JEANS-SLIM-BLACK-32')).status, 'done');
  assert.equal(await skus.countDocuments({ sku_code: 'ACME-JEANS-SLIM-BLACK-32' }), 1);
  await put('ZED-JEANS-SLIM-BLACK-32');
  await pg.query("UPDATE ci_sku_projection_outbox SET status='processing',claim_token=$3,lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND alias_sku=$2", [tenantId, 'ZED-JEANS-SLIM-BLACK-32', randomUUID()]);
  assert.deepEqual(await runSkuProjectionBatch(), { projected: 0, recovered: 0 });
  assert.equal((await status('ZED-JEANS-SLIM-BLACK-32')).status, 'unknown_remote');
  assert.equal(await skus.countDocuments({ sku_code: 'ZED-JEANS-SLIM-BLACK-32' }), 0);
  await skus.insertOne({ id: 100, sku_code: 'NOVA-JEANS-SLIM-BLACK-32', name: 'Legacy unknown tenant' });
  await put('NOVA-JEANS-SLIM-BLACK-32');
  await runSkuProjectionBatch();
  assert.deepEqual(await status('NOVA-JEANS-SLIM-BLACK-32'), { status: 'held', reason: 'LEGACY_TENANT_UNVERIFIED' });
  doc = await skus.findOne({ sku_code: 'NOVA-JEANS-SLIM-BLACK-32' });
  assert.equal(doc.name, 'Legacy unknown tenant');
  assert.equal(doc.tenant_id, undefined);
  console.log('PASS SKU projection: committed intent, numeric identity, replay, expired-lease readback, no blind resend, legacy tenant hold');
} finally {
  await closeDataStore();
  await mongo.close();
  await pg.end();
}
