import { createHash } from 'node:crypto';
import { parseSku, normalizeSkuCode } from './sku-parser.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byId = (a, b) => String(a.id).localeCompare(String(b.id));
const asNumber = value => {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid stock quantity in backfill source');
  return number;
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
        grouped.get(master.variant_key).members.push({ id: master.id, sku: master.sku, brand: null, on_hand: asNumber(master.on_hand), active_reservations: asNumber(master.active_reservations), opening_stock_active: master.opening_stock_active ?? null, opening_stock_verified_at: master.opening_stock_verified_at ?? null, opening_stock_verified_by: master.opening_stock_verified_by ?? null });
        continue;
      }
    }
    const matches = mongoBySku.get(normalizeSkuCode(master.sku)) ?? [];
    if (matches.length > 1) {
      conflicts.push({ master_id: master.id, sku: master.sku, code: 'MULTIPLE_MONGO_SKUS', count: matches.length });
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
    grouped.get(key).members.push({ id: master.id, sku: master.sku, brand: parsed.brand, on_hand: asNumber(master.on_hand), active_reservations: asNumber(master.active_reservations), opening_stock_active: master.opening_stock_active ?? null, opening_stock_verified_at: master.opening_stock_verified_at ?? null, opening_stock_verified_by: master.opening_stock_verified_by ?? null });
  }
  const variants = [...grouped.values()].sort((a, b) => a.variant_key.localeCompare(b.variant_key)).map(group => {
    group.members.sort(byId);
    const canonical = group.members.find(member => member.sku === group.canonical_sku);
    return { ...group, target_id: canonical?.id ?? null, total_on_hand: group.members.reduce((total, member) => total + member.on_hand, 0), blocked: group.members.some(member => member.active_reservations > 0) };
  });
  const mergeable = variants.filter(group => group.members.length > 1 || !group.target_id).map(group => ({ variant_key: group.variant_key, canonical_sku: group.canonical_sku, target_id: group.target_id, source_ids: group.members.filter(member => member.id !== group.target_id).map(member => member.id), blocked: group.blocked, blockers: group.members.filter(member => member.active_reservations > 0).map(member => ({ master_id: member.id, active_reservations: member.active_reservations })) }));
  const byMaster = (a, b) => String(a.master_id).localeCompare(String(b.master_id));
  const state = { tenant_id: tenantId, variants, review: review.sort(byMaster), conflicts: conflicts.sort(byMaster), mergeable };
  return { ...state, summary: { tenant_id: tenantId, masters: masters.length, variants: variants.length, review: review.length, conflicts: conflicts.length, mergeable: mergeable.length, blocked: mergeable.filter(group => group.blocked).length, sha256: digest(state) } };
}
