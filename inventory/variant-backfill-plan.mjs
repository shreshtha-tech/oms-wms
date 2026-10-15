import { createHash } from 'node:crypto';
import { parseSku, normalizeSkuCode } from './sku-parser.mjs';
import { legacySkuClaim } from './sku-legacy-claim.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byId = (a, b) => String(a.id).localeCompare(String(b.id));
const asNumber = value => {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid stock quantity in backfill source');
  return number;
};
const memberSnapshot = (master, brand, mongoRow = null) => {
  const balanceRows = (master.balance_rows ?? []).map(row => ({
    location_id: row.location_id, on_hand: asNumber(row.on_hand),
    reserved_order: asNumber(row.reserved_order), reserved_cart: asNumber(row.reserved_cart),
    damaged: asNumber(row.damaged), quarantined: asNumber(row.quarantined),
    safety_stock: asNumber(row.safety_stock), version: asNumber(row.version),
  })).sort((a, b) => a.location_id.localeCompare(b.location_id));
  if (master.balance_rows != null && balanceRows.reduce((total, row) => total + row.on_hand, 0) !== asNumber(master.on_hand)) throw new Error('Backfill balance snapshot does not match SKU total');
  return {
  id: master.id, sku: master.sku, brand, on_hand: asNumber(master.on_hand),
  active_reservations: asNumber(master.active_reservations),
  legacy_mongo_claim: legacySkuClaim(mongoRow),
  balance_rows: balanceRows,
  opening_stock_active: master.opening_stock_active ?? null,
  opening_stock_verified_at: master.opening_stock_verified_at ?? null,
  opening_stock_verified_by: master.opening_stock_verified_by ?? null,
  };
};

export function buildVariantBackfillPlan({ tenantId, masters, mongoSkus, dictionary }) {
  if (!tenantId || !Array.isArray(masters) || !Array.isArray(mongoSkus)) throw new TypeError('Backfill needs a tenant and both source snapshots');
  const mongoBySku = new Map();
  for (const row of mongoSkus) {
    if (typeof row.sku_code !== 'string') continue;
    const key = normalizeSkuCode(row.sku_code);
    if (!mongoBySku.has(key)) mongoBySku.set(key, []);
    mongoBySku.get(key).push(row);
  }
  const review = [], conflicts = [], grouped = new Map();
  for (const master of [...masters].sort(byId)) {
    if (master.merged_into_id) continue;
    if (master.variant_key && master.category && master.product_type && master.color && master.size && !master.pool_label) {
      const canonicalSku = [master.category, master.product_type, master.color, master.size].join('-');
      if (master.sku === canonicalSku && master.variant_key === [master.category, master.product_type, master.color, master.size].join('|')) {
        if (!grouped.has(master.variant_key)) grouped.set(master.variant_key, { variant_key: master.variant_key, canonical_sku: canonicalSku, category: master.category, product_type: master.product_type, color: master.color, size: master.size, members: [] });
        grouped.get(master.variant_key).members.push(memberSnapshot(master, null));
        continue;
      }
    }
    const matches = mongoBySku.get(normalizeSkuCode(master.sku)) ?? [];
    if (matches.length > 1) {
      conflicts.push({ master_id: master.id, sku: master.sku, code: 'MULTIPLE_MONGO_SKUS', count: matches.length });
      continue;
    }
    if (matches[0]?.tenant_id && matches[0].tenant_id !== tenantId) {
      conflicts.push({ master_id: master.id, sku: master.sku, code: 'MONGO_TENANT_MISMATCH' });
      continue;
    }
    if (matches[0] && matches[0].sku_code.trim().toUpperCase() !== master.sku.trim().toUpperCase()) {
      conflicts.push({ master_id: master.id, sku: master.sku, code: 'MONGO_SKU_CODE_FORMAT_CONFLICT', mongo_sku: matches[0].sku_code });
      continue;
    }
    const parsed = parseSku(master.sku, dictionary, { mongo: matches[0] ?? null });
    if (master.variant_key && parsed.variantKey && master.variant_key !== parsed.variantKey) {
      conflicts.push({ master_id: master.id, sku: master.sku, code: 'EXISTING_VARIANT_DISAGREES', existing: master.variant_key, parsed: parsed.variantKey });
      continue;
    }
    if (parsed.issues.length) {
      const entry = { master_id: master.id, sku: master.sku, issues: parsed.issues };
      if (parsed.issues.some(issue => issue.code === 'SOURCE_CONFLICT')) conflicts.push(entry);
      else review.push(entry);
      continue;
    }
    const key = parsed.variantKey;
    if (!grouped.has(key)) grouped.set(key, { variant_key: key, canonical_sku: parsed.canonicalSku, category: parsed.category, product_type: parsed.productType, color: parsed.color, size: parsed.size, members: [] });
    grouped.get(key).members.push(memberSnapshot(master, parsed.brand, matches[0]));
  }
  const variants = [...grouped.values()].sort((a, b) => a.variant_key.localeCompare(b.variant_key)).map(group => {
    group.members.sort(byId);
    const canonical = group.members.find(member => member.sku === group.canonical_sku);
    const total = group.members.reduce((value, member) => value + member.on_hand, 0);
    if (!Number.isSafeInteger(total)) throw new Error('Variant total exceeds the supported integer range');
    return { ...group, target_id: canonical?.id ?? null, total_on_hand: total, blocked: group.members.some(member => member.active_reservations > 0) };
  });
  const mergeable = variants.filter(group => group.members.length > 1 || !group.target_id).map(group => ({ variant_key: group.variant_key, canonical_sku: group.canonical_sku, target_id: group.target_id, total_on_hand: group.total_on_hand, members: group.members, source_ids: group.members.filter(member => member.id !== group.target_id).map(member => member.id), blocked: group.blocked, blockers: group.members.filter(member => member.active_reservations > 0).map(member => ({ master_id: member.id, active_reservations: member.active_reservations })) }));
  const byMaster = (a, b) => String(a.master_id).localeCompare(String(b.master_id));
  const state = { tenant_id: tenantId, variants, review: review.sort(byMaster), conflicts: conflicts.sort(byMaster), mergeable };
  return { ...state, summary: { tenant_id: tenantId, masters: masters.length, variants: variants.length, review: review.length, conflicts: conflicts.length, mergeable: mergeable.length, blocked: mergeable.filter(group => group.blocked).length, sha256: digest(state) } };
}
