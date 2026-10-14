export const balanceReadBudget = Object.freeze({ rows: 10000, bytes: 8 * 1024 * 1024 });
const oversized = () => Object.assign(new Error('Balance result exceeds the supported read size. Use a narrower inventory workflow.'), { code: 'BALANCE_RESULT_LIMIT', status: 413 });
export async function readTenantBalances(db, tenantId) {
  const result = await db.query('SELECT *,greatest(0,on_hand-reserved_order-reserved_cart-damaged-quarantined-safety_stock) AS sellable FROM ci_inventory_balance WHERE tenant_id=$1 ORDER BY master_sku_id,location_id LIMIT $2', [tenantId, balanceReadBudget.rows + 1]);
  if (result.rows.length > balanceReadBudget.rows) throw oversized();
  let bytes = 2;
  for (const row of result.rows) {
    bytes += Buffer.byteLength(JSON.stringify(row), 'utf8') + 1;
    if (bytes > balanceReadBudget.bytes) throw oversized();
  }
  return result.rows;
}
