import { buildDictionary, normalizeSkuCode } from './sku-parser.mjs';
import { buildVariantBackfillPlan } from './variant-backfill-plan.mjs';
import { mongoDomainTransaction } from '../api/mongo.js';

export async function readVariantBackfillPlan(db, tenantId) {
  const dictionary = await buildDictionary(db, tenantId);
  const masters = (await db.query(`SELECT s.id,s.sku,s.merged_into_id,s.variant_key,s.category,s.product_type,s.color,s.size,s.pool_label,s.opening_stock_active,
    s.opening_stock_verified_at,s.opening_stock_verified_by,
    coalesce((SELECT sum(b.on_hand) FROM ci_inventory_balance b WHERE b.tenant_id=s.tenant_id AND b.master_sku_id=s.id),0) AS on_hand,
    coalesce((SELECT jsonb_agg(jsonb_build_object('location_id',b.location_id,'on_hand',b.on_hand,'reserved_order',b.reserved_order,'reserved_cart',b.reserved_cart,'damaged',b.damaged,'quarantined',b.quarantined,'safety_stock',b.safety_stock,'version',b.version) ORDER BY b.location_id) FROM ci_inventory_balance b WHERE b.tenant_id=s.tenant_id AND b.master_sku_id=s.id),'[]'::jsonb) AS balance_rows,
    (SELECT count(*) FROM ci_reservation r WHERE r.tenant_id=s.tenant_id AND r.master_sku_id=s.id AND r.status='active') AS active_reservations
    FROM ci_master_sku s WHERE s.tenant_id=$1 ORDER BY s.id`, [tenantId])).rows;
  const codes = new Set(masters.map(row => normalizeSkuCode(row.sku)));
  const mongoSkus = codes.size ? await mongoDomainTransaction(async (mongo, session) => {
    const matches = [];
    const cursor = mongo.collection('skus').find(
      { sku_code: { $type: 'string' } },
      { session, projection: { sku_code: 1, brand: 1, category: 1, style: 1, product_type: 1, color: 1, colour: 1, size: 1, tenant_id: 1 } },
    );
    for await (const row of cursor) if (codes.has(normalizeSkuCode(row.sku_code))) matches.push(row);
    return matches;
  }) : [];
  return buildVariantBackfillPlan({ tenantId, masters, mongoSkus, dictionary });
}
