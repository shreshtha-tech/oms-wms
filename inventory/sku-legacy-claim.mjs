import { createHash } from 'node:crypto';

const fields = ['sku_code', 'brand', 'category', 'style', 'product_type', 'color', 'colour', 'size', 'tenant_id'];
export function legacySkuIdentityDigest(row) {
  const identity = Object.fromEntries(fields.map(field => [field, row?.[field] ?? null]));
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
export function legacySkuClaim(row) {
  if (!row?._id || row.tenant_id) return null;
  return { id: String(row._id), digest: legacySkuIdentityDigest(row) };
}
