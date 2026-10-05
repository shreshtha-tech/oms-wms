export async function evaluateStockAlert(db,tenantId,masterSkuId){
  const rule=await db.query('SELECT threshold,enabled FROM ci_alert_rule WHERE tenant_id=$1 AND master_sku_id=$2 FOR UPDATE',[tenantId,masterSkuId]);
  const balance=await db.query("SELECT COUNT(*)::int AS counted_locations,COALESCE(SUM(GREATEST(0,b.on_hand-b.reserved_order-b.reserved_cart-b.damaged-b.quarantined-b.safety_stock)),0)::bigint AS sellable FROM ci_inventory_balance b JOIN ci_location l ON l.tenant_id=b.tenant_id AND l.id=b.location_id WHERE b.tenant_id=$1 AND b.master_sku_id=$2 AND l.location_type IN ('warehouse','store')",[tenantId,masterSkuId]);
  const sellable=Number(balance.rows[0].sellable);
  if(!balance.rows[0].counted_locations||!rule.rowCount||!rule.rows[0].enabled||sellable>=Number(rule.rows[0].threshold)){
    await db.query("UPDATE ci_stock_alert SET status='resolved',resolved_at=now(),sellable=$3 WHERE tenant_id=$1 AND master_sku_id=$2 AND status='open'",[tenantId,masterSkuId,sellable]);
    return {sellable,alert:false};
  }
  const threshold=Number(rule.rows[0].threshold);
  await db.query("INSERT INTO ci_stock_alert(tenant_id,master_sku_id,threshold,sellable,status) VALUES($1,$2,$3,$4,'open') ON CONFLICT (tenant_id,master_sku_id) WHERE status='open' DO UPDATE SET threshold=EXCLUDED.threshold,sellable=EXCLUDED.sellable",[tenantId,masterSkuId,threshold,sellable]);
  return {sellable,alert:true,threshold};
}
