import '../env.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inventoryPool } from '../inventory/db.js';
import { buildDictionary } from '../inventory/sku-parser.mjs';
import { buildVariantBackfillPlan } from '../inventory/variant-backfill-plan.mjs';
import { mongoDomainTransaction, closeDataStore } from '../api/mongo.js';
import { safeCsvCell } from '../api/csv-safe.js';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dry-run')) throw new Error('Only --dry-run is available until the reviewed apply path is verified');
const tenantId = process.env.INVENTORY_ALLOWED_TENANT_ID;
if (!tenantId || !process.env.INVENTORY_DATABASE_URL || !process.env.MONGODB_URI) throw new Error('Configured tenant, PostgreSQL and MongoDB are required for two-source backfill planning');
const db = inventoryPool();
try {
  const dictionary = await buildDictionary(db, tenantId);
  const masters = (await db.query(`SELECT s.id,s.sku,s.merged_into_id,s.variant_key,s.category,s.product_type,s.color,s.size,s.pool_label,s.opening_stock_active,
    s.opening_stock_verified_at,s.opening_stock_verified_by,
    coalesce((SELECT sum(b.on_hand) FROM ci_inventory_balance b WHERE b.tenant_id=s.tenant_id AND b.master_sku_id=s.id),0) AS on_hand,
    (SELECT count(*) FROM ci_reservation r WHERE r.tenant_id=s.tenant_id AND r.master_sku_id=s.id AND r.status='active') AS active_reservations
    FROM ci_master_sku s WHERE s.tenant_id=$1 ORDER BY s.id`, [tenantId])).rows;
  const codes = masters.map(row => row.sku);
  const mongoSkus = codes.length ? await mongoDomainTransaction((mongo, session) => mongo.collection('skus').find(
    { sku_code: { $in: codes } },
    { session, collation: { locale: 'en', strength: 2 }, projection: { sku_code: 1, brand: 1, category: 1, style: 1, product_type: 1, color: 1, colour: 1, size: 1, tenant_id: 1 } },
  ).toArray()) : [];
  const plan = buildVariantBackfillPlan({ tenantId, masters, mongoSkus, dictionary });
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const directory = resolve(process.env.VARIANT_BACKFILL_OUTPUT_ROOT || 'artifacts/variant-backfill', `${timestamp}-${plan.summary.sha256.slice(0, 8)}`);
  await mkdir(directory, { recursive: false });
  const csv = (rows, keys) => [keys.map(safeCsvCell).join(','), ...rows.map(row => keys.map(key => safeCsvCell(row[key])).join(','))].join('\r\n');
  const variantRows = plan.variants.map(group => ({ variant_key: group.variant_key, canonical_sku: group.canonical_sku, member_skus: group.members.map(member => member.sku).join(' | '), brands: [...new Set(group.members.map(member => member.brand))].sort().join(' | '), total_on_hand: group.total_on_hand, blocked: group.blocked }));
  await Promise.all([
    writeFile(resolve(directory, 'variants.csv'), csv(variantRows, ['variant_key', 'canonical_sku', 'member_skus', 'brands', 'total_on_hand', 'blocked'])),
    writeFile(resolve(directory, 'review.csv'), csv(plan.review.map(row => ({ ...row, issues: JSON.stringify(row.issues) })), ['master_id', 'sku', 'issues'])),
    writeFile(resolve(directory, 'conflicts.csv'), csv(plan.conflicts.map(row => ({ ...row, issues: JSON.stringify(row.issues ?? []) })), ['master_id', 'sku', 'code', 'existing', 'parsed', 'count', 'issues'])),
    writeFile(resolve(directory, 'mergeable.json'), `${JSON.stringify(plan.mergeable, null, 2)}\n`),
    writeFile(resolve(directory, 'summary.json'), `${JSON.stringify(plan.summary, null, 2)}\n`),
  ]);
  console.log(JSON.stringify({ kind: 'variant_backfill_dry_run', directory, summary: plan.summary }));
} finally {
  await closeDataStore();
  await db.end();
}
