export async function inventoryDriftCount(db, tenantId) {
  const result = await db.query(`SELECT count(*)::text AS drift_count
    FROM ci_channel_stock s JOIN ci_channel_mapping m ON m.tenant_id=s.tenant_id AND m.id=s.mapping_id
    WHERE s.tenant_id=$1 AND s.observed_quantity IS DISTINCT FROM s.target_quantity`, [tenantId]);
  const value = result.rows[0]?.drift_count;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Inventory drift count exceeds the supported integer range.');
  return Number(value);
}
