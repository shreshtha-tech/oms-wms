// Collection registry for a clean installation. Business records are created
// through the application; no reference-site data or credentials are seeded.
export const SEED = Object.fromEntries([
  'external_apps', 'external_app_definitions', 'fulfillment_audit',
  'delivery_shipping_audit', 'inventory_moves', 'inventory_lottables',
  'stock_adjustments', 'outbound_gate_passes', 'outbound_memos',
  'sku_transactions', 'sku_lot_transfers', 'vin_lister_products',
  'vin_lister_imports', 'vin_lister_exports', 'vin_lister_transmit_logs',
  'ars_sku_links', 'ars_rules', 'ars_execution_logs', 'ars_settings',
  'ajio_config', 'ajio_sku_mappings', 'ajio_backorders', 'ajio_orders',
  'ajio_deliveries', 'ajio_invoices', 'ajio_manifests',
  'amazon_mfn_config', 'amazon_mfn_mappings', 'amazon_mfn_orders',
  'amazon_mfn_inventory_logs', 'amazon_mfn_returns', 'amazon_mfn_shipments',
  'amazon_mfn_label_calls', 'procurement_buyers', 'vendor_invoices',
  'otb_budgets', 'skus', 'partners', 'sale_orders', 'purchase_orders',
  'grn', 'inventory', 'stock_transfers', 'returns', 'fulfillment_orders',
  'picklists', 'shipments', 'vendor_promotions', 'generic_records',
  'downloads', 'admin_records', 'tax_application', 'sku_barcode',
  'vendors', 'tax_group_codes', 'tax_zone_states', 'tax_codes',
  'coupons_master', 'channels', 'sku_channel_links', 'oms_rules',
  'back_orders', 'purchase_charge_masters', 'inventory_policies',
].map((name) => [name, []]));
