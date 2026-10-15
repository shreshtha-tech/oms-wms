import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { buildDictionary, parseSku } from '../inventory/sku-parser.mjs';
import { validateTestStores } from './lib/isolated-stack-guard.mjs';

validateTestStores(process.env);
const db = inventoryPool();
const tenant = `variant-${randomUUID()}`;
const otherTenant = `variant-${randomUUID()}`;
try {
  await migrateInventory();
  const legacy = (await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'LEGACY-RAW','Legacy fixture') RETURNING id,attr_status,variant_key", [tenant])).rows[0];
  assert.equal(legacy.attr_status, 'legacy');
  assert.equal(legacy.variant_key, null);
  const attrs = ['JEANS', 'SLIM', 'BLACK', '32'];
  const canonical = (await db.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name,category,product_type,color,size,attr_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,variant_key', [tenant, 'JEANS-SLIM-BLACK-32', 'Shared variant', ...attrs, 'verified'])).rows[0];
  assert.equal(canonical.variant_key, 'JEANS|SLIM|BLACK|32');
  await assert.rejects(db.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name,category,product_type,color,size) VALUES($1,$2,$3,$4,$5,$6,$7)', [tenant, 'OTHER-CODE', 'Duplicate variant', ...attrs]), error => error.code === '23505');
  await db.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name,category,product_type,color,size) VALUES($1,$2,$3,$4,$5,$6,$7)', [otherTenant, 'OTHER-CODE', 'Other tenant variant', ...attrs]);
  const labelled = (await db.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name,category,product_type,color,size,pool_label) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING variant_key', [tenant, 'JEANS-SLIM-BLACK-32-LABEL-A', 'Labelled variant', ...attrs, 'LABEL-A'])).rows[0];
  assert.equal(labelled.variant_key, 'JEANS|SLIM|BLACK|32|LABEL-A');
  await db.query("INSERT INTO ci_sku_alias(tenant_id,alias_sku,master_sku_id,brand,source,parse_result) VALUES($1,'ACME-JEANS-SLIM-BLACK-32',$2,'ACME','parsed',$3)", [tenant, canonical.id, { attrStatus: 'verified' }]);
  await assert.rejects(db.query("INSERT INTO ci_sku_alias(tenant_id,alias_sku,master_sku_id,source) VALUES($1,'ACME-JEANS-SLIM-BLACK-32',$2,'manual')", [tenant, legacy.id]), error => error.code === '23505');
  await assert.rejects(db.query("INSERT INTO ci_sku_alias(tenant_id,alias_sku,master_sku_id,source) VALUES($1,'OTHER-JEANS-SLIM-BLACK-32',$2,'manual')", [otherTenant, canonical.id]), error => error.code === '23503');
  for (const [kind, code] of [['brand', 'ACME'], ['category', 'JEANS'], ['type', 'SLIM'], ['color', 'BLACK'], ['size', '32']]) await db.query('INSERT INTO ci_attribute_value(tenant_id,kind,code) VALUES($1,$2,$3)', [tenant, kind, code]);
  await db.query("INSERT INTO ci_attribute_alias(tenant_id,kind,alias_norm,code) VALUES($1,'category','DENIM','JEANS')", [tenant]);
  await db.query("INSERT INTO ci_sku_noise_rule(tenant_id,platform,kind,token_norm) VALUES($1,'amazon','prefix','FBA')", [tenant]);
  const dictionary = await buildDictionary(db, tenant);
  assert.equal(parseSku('FBA-ACME-DENIM-SLIM-BLACK-32', dictionary, { platform: 'amazon' }).variantKey, canonical.variant_key);
  await migrateInventory();
  assert.equal((await db.query('SELECT variant_key FROM ci_master_sku WHERE tenant_id=$1 AND id=$2', [tenant, canonical.id])).rows[0].variant_key, canonical.variant_key);
  console.log('PASS variant identity DB: nullable legacy rows, generated key, tenant uniqueness, optional label, alias fencing, dictionary loading, idempotent migration');
} finally {
  await db.end();
}
