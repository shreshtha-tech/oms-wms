import { createHash } from 'node:crypto';
import { safeCsvCell } from '../api/csv-safe.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const csv = (rows, keys) => [keys.map(safeCsvCell).join(','), ...rows.map(row => keys.map(key => safeCsvCell(row[key])).join(','))].join('\r\n');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const stableJson = (value, space) => JSON.stringify(canonical(value), null, space);

export function renderVariantBackfillArtifacts(plan) {
  const variants = plan.variants.map(group => ({ variant_key: group.variant_key, canonical_sku: group.canonical_sku, member_skus: group.members.map(member => member.sku).join(' | '), brands: [...new Set(group.members.map(member => member.brand).filter(Boolean))].sort().join(' | '), total_on_hand: group.total_on_hand, blocked: group.blocked }));
  const files = {
    'variants.csv': csv(variants, ['variant_key', 'canonical_sku', 'member_skus', 'brands', 'total_on_hand', 'blocked']),
    'review.csv': csv(plan.review.map(row => ({ ...row, issues: stableJson(row.issues) })), ['master_id', 'sku', 'issues']),
    'conflicts.csv': csv(plan.conflicts.map(row => ({ ...row, issues: stableJson(row.issues ?? []) })), ['master_id', 'sku', 'code', 'existing', 'parsed', 'mongo_sku', 'count', 'issues']),
    'mergeable.json': `${stableJson(plan.mergeable, 2)}\n`,
  };
  const summary = { ...plan.summary, artifact_sha256: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, sha256(content)])) };
  return { files: { ...files, 'summary.json': `${stableJson(summary, 2)}\n` }, summary };
}
