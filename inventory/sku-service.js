import { createHash } from 'node:crypto';
import { mongoDomainTransaction } from '../api/mongo.js';
import { buildDictionary, normalizeSkuCode, parseSku } from './sku-parser.mjs';

const conflict = message => Object.assign(new Error(message), { status: 409, code: 'SKU_IDENTITY_CONFLICT' });
const validSource = new Set(['parsed', 'import', 'legacy_master', 'manual']);
const hashPayload = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function lookupLegacyMongoSku(aliasSku) {
  if (!process.env.MONGODB_URI) return { status: 'unconfigured', row: null };
  try {
    const row = await mongoDomainTransaction((db, session) => db.collection('skus').findOne(
      { sku_code: aliasSku },
      { session, collation: { locale: 'en', strength: 2 }, projection: { brand: 1, category: 1, style: 1, product_type: 1, color: 1, colour: 1, size: 1 } },
    ));
    return { status: 'ready', row };
  } catch (error) {
    if (['DATABASE_UNAVAILABLE', 'DATABASE_TIMEOUT', 'DATABASE_COMMIT_UNCERTAIN'].includes(error?.code)) return { status: 'unavailable', row: null };
    throw error;
  }
}

function projectionPayload({ aliasSku, master, brand }) {
  const payload = {
    sku_code: aliasSku,
    master_sku_code: master.variant_key ? master.sku : null,
    variant_key: master.variant_key,
    attr_status: master.attr_status,
  };
  if (master.variant_key) Object.assign(payload, {
    brand,
    category: master.category,
    product_type: master.product_type,
    style: master.product_type,
    color: master.color,
    colour: master.color,
    size: master.size,
  });
  return payload;
}

export async function queueProjection(db, tenantId, aliasSku, master, brand, legacyClaim = null) {
  const payload = projectionPayload({ aliasSku, master, brand });
  const digest = hashPayload(payload);
  const revision = (await db.query(
    'UPDATE ci_sku_alias SET projection_revision=projection_revision+1 WHERE tenant_id=$1 AND alias_sku=$2 RETURNING projection_revision',
    [tenantId, aliasSku],
  )).rows[0].projection_revision;
  await db.query(
    'INSERT INTO ci_sku_projection_outbox(tenant_id,alias_sku,master_sku_id,revision,payload,payload_digest,legacy_claim) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [tenantId, aliasSku, master.id, revision, payload, digest, legacyClaim],
  );
}

export async function upsertMaster(db, {
  tenantId, sku, productName, source = 'manual', platform = null,
  poolLabel = null, dictionary = null, mongoLookup = lookupLegacyMongoSku, createOnly = false,
}) {
  if (!tenantId || typeof sku !== 'string' || typeof productName !== 'string' || !validSource.has(source)) throw new TypeError('Valid tenant, SKU, product name and source are required');
  const rawSku = sku.trim(), name = productName.trim(), aliasSku = normalizeSkuCode(rawSku);
  if (!rawSku || !aliasSku || rawSku.length > 120 || aliasSku.length > 120 || !name || name.length > 250) throw new TypeError('SKU or product name exceeds the supported bounds');
  const labels = poolLabel == null || poolLabel === '' ? null : normalizeSkuCode(poolLabel);
  if (labels && (labels.length > 120 || labels.includes('|'))) throw new TypeError('Invalid pool label');
  const loaded = dictionary ?? await buildDictionary(db, tenantId);
  const mongo = await mongoLookup(aliasSku);
  if (!mongo || !['unconfigured', 'ready', 'unavailable'].includes(mongo.status)) throw new TypeError('Invalid Mongo SKU lookup state');
  let parsed = parseSku(rawSku, loaded, { platform, mongo: mongo.row });
  if (mongo.status === 'unavailable') parsed = { ...parsed, attrStatus: 'review', variantKey: null, canonicalSku: null, issues: [...parsed.issues, { code: 'MONGO_VERIFICATION_UNAVAILABLE' }] };
  else if (parsed.variantKey && labels) parsed = { ...parsed, variantKey: `${parsed.variantKey}|${labels}`, canonicalSku: `${parsed.canonicalSku}-${labels}` };
  if (parsed.canonicalSku?.length > 120) parsed = { ...parsed, attrStatus: 'review', variantKey: null, canonicalSku: null, issues: [...parsed.issues, { code: 'CANONICAL_SKU_TOO_LONG' }] };

  // One lock order for all writers: variant identity, then external alias.
  if (parsed.variantKey) await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([tenantId, 'variant', parsed.variantKey])]);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([tenantId, 'sku-alias', aliasSku])]);
  const priorAlias = (await db.query('SELECT master_sku_id FROM ci_sku_alias WHERE tenant_id=$1 AND alias_sku=$2 FOR UPDATE', [tenantId, aliasSku])).rows[0];
  if (priorAlias) {
    if (createOnly) throw conflict('SKU already exists');
    const master = (await db.query('SELECT * FROM ci_master_sku WHERE tenant_id=$1 AND id=$2', [tenantId, priorAlias.master_sku_id])).rows[0];
    if (parsed.variantKey && master.variant_key && master.variant_key !== parsed.variantKey) throw conflict('Existing SKU alias points to a different physical variant');
    return { ...master, aliasSku, created: false, duplicate: true, reviewIssues: parsed.issues };
  }
  const legacy = (await db.query('SELECT * FROM ci_master_sku WHERE tenant_id=$1 AND (sku=$2 OR upper(sku)=$3) ORDER BY created_at,id FOR UPDATE', [tenantId, rawSku, aliasSku])).rows;
  if (legacy.length > 1) throw conflict('Multiple existing SKU masters match this alias');
  if (legacy.length && createOnly) throw conflict('SKU already exists');
  let master = legacy[0], created = false;
  if (master) {
    if (master.variant_key && parsed.variantKey && master.variant_key !== parsed.variantKey) throw conflict('Existing SKU master has a different variant identity');
    if (!master.variant_key) {
      parsed = { ...parsed, attrStatus: 'review', variantKey: null, canonicalSku: null, issues: [...parsed.issues, { code: 'LEGACY_MASTER_REQUIRES_BACKFILL' }] };
      master = (await db.query("UPDATE ci_master_sku SET attr_status='review' WHERE tenant_id=$1 AND id=$2 RETURNING *", [tenantId, master.id])).rows[0];
    }
  } else if (parsed.variantKey) {
    master = (await db.query('SELECT * FROM ci_master_sku WHERE tenant_id=$1 AND variant_key=$2 AND merged_into_id IS NULL FOR UPDATE', [tenantId, parsed.variantKey])).rows[0];
    if (!master) {
      const inserted = await db.query(
        'INSERT INTO ci_master_sku(tenant_id,sku,product_name,category,product_type,color,size,pool_label,attr_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING *',
        [tenantId, parsed.canonicalSku, name, parsed.category, parsed.productType, parsed.color, parsed.size, labels, parsed.attrStatus],
      );
      master = inserted.rows[0] ?? (await db.query('SELECT * FROM ci_master_sku WHERE tenant_id=$1 AND variant_key=$2 AND merged_into_id IS NULL FOR UPDATE', [tenantId, parsed.variantKey])).rows[0];
      if (!master) throw conflict('Canonical SKU code conflicts with another identity; review before mapping');
      created = inserted.rowCount === 1;
    }
  } else {
    const inserted = await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name,attr_status) VALUES($1,$2,$3,'review') ON CONFLICT DO NOTHING RETURNING *", [tenantId, rawSku, name]);
    master = inserted.rows[0] ?? (await db.query('SELECT * FROM ci_master_sku WHERE tenant_id=$1 AND sku=$2 FOR UPDATE', [tenantId, rawSku])).rows[0];
    if (!master) throw conflict('SKU identity could not be established');
    created = inserted.rowCount === 1;
  }
  const alias = await db.query(
    'INSERT INTO ci_sku_alias(tenant_id,alias_sku,master_sku_id,brand,source,parse_result) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING master_sku_id',
    [tenantId, aliasSku, master.id, parsed.brand, source, parsed],
  );
  if (alias.rowCount !== 1) {
    const existing = (await db.query('SELECT master_sku_id FROM ci_sku_alias WHERE tenant_id=$1 AND alias_sku=$2', [tenantId, aliasSku])).rows[0];
    if (existing?.master_sku_id !== master.id) throw conflict('SKU alias was linked to another master');
  } else await queueProjection(db, tenantId, aliasSku, master, parsed.brand);
  return { ...master, aliasSku, created, duplicate: false, reviewIssues: parsed.issues };
}
