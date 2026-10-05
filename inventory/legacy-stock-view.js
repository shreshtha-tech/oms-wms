const clean = value => String(value ?? '').trim();
const includes = (value, query) => !clean(query) || String(value ?? '').toLowerCase().includes(clean(query).toLowerCase());

export function toLegacyInventoryRows(rows) {
  return rows.map(row => ({
    id: row.id,
    master_sku_id: row.master_sku_id,
    location_id: row.location_id,
    sku_code: row.sku_code,
    master_sku_code: row.sku_code,
    name: row.name,
    warehouse: row.warehouse,
    on_hand: Number(row.on_hand),
    available: Number(row.available),
    reserved: Number(row.reserved),
    wac: null,
    stock_source: 'Central Inventory',
  }));
}

export function summarizeCentralInventory(rows, policies) {
  const policyBySku = new Map(policies.map(policy => [clean(policy.master_sku_code || policy.sku_code).toLowerCase(), policy]));
  const grouped = new Map();
  for (const row of rows) {
    const key = clean(row.sku_code).toLowerCase();
    if (!key) continue;
    const aggregate = grouped.get(key) || {
      master_sku_code: row.sku_code,
      name: row.name || row.sku_code,
      on_hand: 0,
      available: 0,
      reserved: 0,
      locations: new Set(),
    };
    aggregate.on_hand += Number(row.on_hand || 0);
    aggregate.available += Number(row.available || 0);
    aggregate.reserved += Number(row.reserved || 0);
    aggregate.locations.add(clean(row.warehouse));
    grouped.set(key, aggregate);
  }
  return [...grouped.values()].map(row => {
    const policy = policyBySku.get(row.master_sku_code.toLowerCase()) || {};
    const configured = Number.isFinite(Number(policy.reorder_point));
    const reorderPoint = configured ? Math.max(0, Number(policy.reorder_point)) : null;
    return {
      ...row,
      locations: [...row.locations].filter(Boolean).length,
      reorder_point: reorderPoint,
      low_stock: configured && row.available <= reorderPoint,
    };
  }).sort((a, b) => a.available - b.available);
}

export function searchCentralInventoryRows(rows, filters = {}) {
  return rows.filter(row => includes(row.sku_code, filters.skuCode) && includes(row.name, filters.skuDesc));
}
