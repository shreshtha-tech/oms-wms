import { inventoryPool } from './db.js';

export async function readInventorySummary(tenant, db = inventoryPool()) {
  const { rows } = await db.query(`SELECT
    (SELECT COUNT(*) FROM ci_master_sku WHERE tenant_id=$1 AND merged_into_id IS NULL) AS catalog_skus,
    (SELECT COUNT(DISTINCT b.master_sku_id) FROM ci_inventory_balance b
      JOIN ci_master_sku s ON s.tenant_id=b.tenant_id AND s.id=b.master_sku_id
      JOIN ci_location l ON l.tenant_id=b.tenant_id AND l.id=b.location_id
      WHERE b.tenant_id=$1 AND s.merged_into_id IS NULL AND l.location_type IN ('warehouse','store')) AS counted_skus,
    (SELECT COALESCE(SUM(GREATEST(0,b.on_hand-b.reserved_order-b.reserved_cart-b.damaged-b.quarantined-b.safety_stock)),0)
      FROM ci_inventory_balance b
      JOIN ci_master_sku s ON s.tenant_id=b.tenant_id AND s.id=b.master_sku_id
      JOIN ci_location l ON l.tenant_id=b.tenant_id AND l.id=b.location_id
      WHERE b.tenant_id=$1 AND s.merged_into_id IS NULL AND l.location_type IN ('warehouse','store')) AS sellable,
    (SELECT COUNT(*) FROM ci_stock_alert a JOIN ci_master_sku s ON s.tenant_id=a.tenant_id AND s.id=a.master_sku_id WHERE a.tenant_id=$1 AND s.merged_into_id IS NULL AND a.status='open') AS low_stock,
    (SELECT COUNT(*) FROM ci_channel_account a WHERE a.tenant_id=$1 AND a.status='active'
      AND EXISTS (SELECT 1 FROM ci_channel_mapping m WHERE m.tenant_id=a.tenant_id AND m.account_id=a.id AND m.active)) AS active_accounts`, [tenant]);
  const row = rows[0];
  if (!row) throw new Error('Inventory summary unavailable');
  const number = key => {
    const value = Number(row[key]);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Inventory summary exceeds the supported numeric range');
    return value;
  };
  return { catalogSkus: number('catalog_skus'), countedSkus: number('counted_skus'), sellable: number('sellable'), lowStock: number('low_stock'), activeAccounts: number('active_accounts'), generatedAt: new Date().toISOString() };
}

export async function readInventoryOverview(tenant,db=inventoryPool()){
  let pending=Promise.resolve();
  const query=(...args)=>{
    if(db===inventoryPool())return db.query(...args);
    // A checked-out transaction client executes one query at a time.
    pending=pending.then(()=>db.query(...args));return pending;
  };
  const [products,locations,accounts,alerts,mappings]=await Promise.all([
    query(`SELECT s.id,s.sku,s.product_name,s.uom,
      COALESCE(b.on_hand,0)::bigint AS on_hand,COALESCE(b.reserved,0)::bigint AS reserved,
      COALESCE(b.sellable,0)::bigint AS sellable,COALESCE(b.counted_locations,0)::int AS counted_locations,
      r.threshold,r.enabled AS alert_enabled,x.sku IS NOT NULL AS in_base_workbook,x.listed_stock AS workbook_listed_stock,x.pack_size
      FROM ci_master_sku s
      LEFT JOIN LATERAL (SELECT SUM(b.on_hand) AS on_hand,SUM(b.reserved_order+b.reserved_cart) AS reserved,
        SUM(GREATEST(0,b.on_hand-b.reserved_order-b.reserved_cart-b.damaged-b.quarantined-b.safety_stock)) AS sellable,COUNT(*) AS counted_locations
        FROM ci_inventory_balance b JOIN ci_location l ON l.tenant_id=b.tenant_id AND l.id=b.location_id
        WHERE b.tenant_id=s.tenant_id AND b.master_sku_id=s.id AND l.location_type IN ('warehouse','store')) b ON true
      LEFT JOIN ci_alert_rule r ON r.tenant_id=s.tenant_id AND r.master_sku_id=s.id
      LEFT JOIN LATERAL (SELECT x.sku,x.listed_stock,x.pack_size FROM ci_catalog_source_row x WHERE x.tenant_id=s.tenant_id AND x.master_sku_id=s.id ORDER BY x.imported_at DESC,x.file_sha256 LIMIT 1) x ON true
      WHERE s.tenant_id=$1 AND s.merged_into_id IS NULL ORDER BY s.sku`,[tenant]),
    query("SELECT l.id,l.code,l.location_type,l.external_id,COUNT(b.master_sku_id) FILTER (WHERE s.merged_into_id IS NULL)::int AS stocked_skus FROM ci_location l LEFT JOIN ci_inventory_balance b ON b.tenant_id=l.tenant_id AND b.location_id=l.id LEFT JOIN ci_master_sku s ON s.tenant_id=b.tenant_id AND s.id=b.master_sku_id WHERE l.tenant_id=$1 GROUP BY l.id ORDER BY l.code",[tenant]),
    query("SELECT a.id,a.platform,a.external_account_id,a.status,a.scopes,COUNT(m.id)::int AS mapping_count,COUNT(m.id) FILTER (WHERE m.active)::int AS active_mapping_count FROM ci_channel_account a LEFT JOIN ci_channel_mapping m ON m.tenant_id=a.tenant_id AND m.account_id=a.id WHERE a.tenant_id=$1 GROUP BY a.id ORDER BY a.platform,a.external_account_id",[tenant]),
    query("SELECT a.id,a.master_sku_id,s.sku,a.threshold,a.sellable,a.opened_at FROM ci_stock_alert a JOIN ci_master_sku s ON s.tenant_id=a.tenant_id AND s.id=a.master_sku_id WHERE a.tenant_id=$1 AND s.merged_into_id IS NULL AND a.status='open' ORDER BY a.opened_at DESC",[tenant]),
    query("SELECT m.id,m.account_id,a.platform,m.master_sku_id,s.sku,m.external_sku,m.external_location_id,m.internal_location_id,m.pack_size,m.active,cs.target_quantity,cs.observed_quantity,cs.publish_state,cs.observed_at FROM ci_channel_mapping m JOIN ci_master_sku s ON s.tenant_id=m.tenant_id AND s.id=m.master_sku_id JOIN ci_channel_account a ON a.tenant_id=m.tenant_id AND a.id=m.account_id LEFT JOIN ci_channel_stock cs ON cs.tenant_id=m.tenant_id AND cs.mapping_id=m.id WHERE m.tenant_id=$1 ORDER BY s.sku,a.platform",[tenant]),
  ]);
  return {products:products.rows,locations:locations.rows,accounts:accounts.rows,alerts:alerts.rows,mappings:mappings.rows,generatedAt:new Date().toISOString()};
}
