// Derived from application collection calls and entity maps; registry-only names are kept separate.
export const mongoModules = {
  "api/admin-parity.js": {
    "collections": [
      "admin_records",
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/admin.js": {
    "collections": [
      "admin_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/ajio.js": {
    "collections": [
      "ajio_backorders",
      "ajio_config",
      "ajio_deliveries",
      "ajio_invoices",
      "ajio_manifests",
      "ajio_orders",
      "ajio_sku_mappings",
      "channels",
      "skus"
    ],
    "dynamic": true,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/allocation-strategies.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/amazon-mfn.js": {
    "collections": [
      "amazon_mfn_config",
      "amazon_mfn_inventory_logs",
      "amazon_mfn_mappings",
      "amazon_mfn_orders",
      "amazon_mfn_returns",
      "amazon_mfn_shipments",
      "channels",
      "skus"
    ],
    "dynamic": true,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/ars.js": {
    "collections": [
      "ars_execution_logs",
      "ars_rules",
      "ars_settings",
      "ars_sku_links",
      "generic_records",
      "skus"
    ],
    "dynamic": true,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/asn-enquiry.js": {
    "collections": [
      "grn"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/attribute-sets.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/back-orders.js": {
    "collections": [
      "back_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/bin-audit.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/bin-editor.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/bin-enquiry.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/bulk-order-update.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/bulk-upload.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/catalogs.js": {
    "collections": [
      "channels",
      "generic_records",
      "partners"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": false,
    "hasDisabledBranch": false
  },
  "api/category-buyers.js": {
    "collections": [
      "procurement_buyers"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/channels.js": {
    "collections": [
      "channels"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/clients.js": {
    "collections": [
      "partners"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/cod-reconciliation.js": {
    "collections": [
      "sale_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/consolidate-ewb.js": {
    "collections": [
      "fulfillment_orders",
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/coupons.js": {
    "collections": [
      "coupons_master"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/customer-groups.js": {
    "collections": [
      "generic_records",
      "partners"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/customer-return-editor.js": {
    "collections": [
      "fulfillment_orders",
      "partners",
      "returns",
      "sale_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/customer-return-enquiry.js": {
    "collections": [
      "returns"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/customers.js": {
    "collections": [
      "generic_records",
      "partners"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/cycle-count-waves.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/cycle-count.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/dashboard.js": {
    "collections": [
      "inventory_policies",
      "sale_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/delivery-shipping.js": {
    "collections": [
      "fulfillment_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/delivery-split.js": {
    "collections": [
      "fulfillment_orders",
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/discrepancy-enquiry.js": {
    "collections": [
      "generic_records",
      "grn"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/dispatch-checkpoint.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/downloads.js": {
    "collections": [
      "downloads"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/exports.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/external-app-definitions.js": {
    "collections": [
      "external_app_definitions"
    ],
    "dynamic": true,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/external-apps.js": {
    "collections": [
      "channels",
      "external_apps",
      "generic_records",
      "partners"
    ],
    "dynamic": true,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/fulfillment.js": {
    "collections": [
      "fulfillment_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/generic.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/global-header-search.js": {
    "collections": [
      "purchase_orders",
      "returns",
      "sale_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/global-order-search.js": {
    "collections": [
      "generic_records",
      "sale_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/global-returns-search.js": {
    "collections": [
      "generic_records",
      "partners",
      "returns"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/grn.js": {
    "collections": [
      "grn"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/inbound-create-edit.js": {
    "collections": [
      "grn",
      "purchase_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/inbound-enquiry.js": {
    "collections": [
      "grn",
      "partners",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/inbound-gate-pass.js": {
    "collections": [
      "generic_records",
      "purchase_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/inbound-qc.js": {
    "collections": [
      "grn"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/inbound-realtime.js": {
    "collections": [
      "generic_records",
      "grn",
      "purchase_orders",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/inbound-receipt-guard.js": {
    "collections": [
      "grn"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": false,
    "hasDisabledBranch": false
  },
  "api/inventory-move-history.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/inventory-move-scan.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/inventory-move.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/inventory-ops.js": {
    "collections": [
      "inventory_lottables",
      "inventory_moves",
      "outbound_gate_passes",
      "outbound_memos",
      "sku_lot_transfers",
      "sku_transactions",
      "stock_adjustments"
    ],
    "dynamic": true,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/inventory.js": {
    "collections": [
      "inventory_policies",
      "partners",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/kitting-orders.js": {
    "collections": [
      "generic_records",
      "sale_orders",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/locations.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/lottable-validations.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/lpn-enquiry.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/manage-asn.js": {
    "collections": [
      "generic_records",
      "grn"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/manage-attributes.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/manage-awb.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/manage-manifests.js": {
    "collections": [
      "fulfillment_orders",
      "partners",
      "shipments"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/manage-picking.js": {
    "collections": [
      "fulfillment_orders",
      "generic_records",
      "picklists"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/manage-picklists.js": {
    "collections": [
      "fulfillment_orders",
      "generic_records",
      "picklists"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/master-orders.js": {
    "collections": [
      "sale_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/merch-hierarchy.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/mp-inventory-log.js": {
    "collections": [
      "channels",
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/oms-rules.js": {
    "collections": [
      "channels",
      "generic_records",
      "oms_rules"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/order-acknowledgement.js": {
    "collections": [
      "fulfillment_orders",
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/order-allocation.js": {
    "collections": [
      "fulfillment_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/order-enquiry.js": {
    "collections": [
      "channels",
      "generic_records",
      "sale_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/order-maintenance.js": {
    "collections": [
      "generic_records",
      "sale_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/order-refunds.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/org-hierarchy.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/partners.js": {
    "collections": [
      "partners"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/picker-zone-preferences.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/picklists.js": {
    "collections": [
      "picklists"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/platforms.js": {
    "collections": [
      "channels"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/po-revision.js": {
    "collections": [
      "purchase_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/price-zones.js": {
    "collections": [
      "generic_records",
      "locations"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/pricing-events.js": {
    "collections": [
      "generic_records",
      "skus",
      "vendors"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/procurement.js": {
    "collections": [
      "otb_budgets",
      "procurement_buyers",
      "vendor_invoices"
    ],
    "dynamic": true,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/purchase-charge-masters.js": {
    "collections": [
      "purchase_charge_masters"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/purchase-order-asn.js": {
    "collections": [
      "grn",
      "purchase_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/purchase-order-comments.js": {
    "collections": [
      "purchase_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/purchase-order-inbound.js": {
    "collections": [
      "grn",
      "purchase_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/purchase-order-tags.js": {
    "collections": [
      "purchase_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/purchase-orders.js": {
    "collections": [
      "otb_budgets",
      "purchase_orders",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/putaway-enquiry.js": {
    "collections": [
      "generic_records",
      "grn"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/putaway-rules.js": {
    "collections": [
      "generic_records",
      "skus",
      "vendors"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/qc-params-mapping.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/receipt-validations.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/reports.js": {
    "collections": [
      "fulfillment_orders",
      "grn",
      "picklists",
      "purchase_orders",
      "returns",
      "sale_orders",
      "shipments",
      "skus",
      "stock_transfers"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/return-otc.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/return-without-order.js": {
    "collections": [
      "generic_records",
      "partners",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/returns.js": {
    "collections": [
      "partners",
      "purchase_orders",
      "returns",
      "sale_orders",
      "skus",
      "vendors"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/role-editor.js": {
    "collections": [
      "admin_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/rtv-enquiry.js": {
    "collections": [
      "generic_records",
      "returns"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/sale-orders.js": {
    "collections": [
      "sale_orders"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/service-pin-codes.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/settings.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/shipment-handover.js": {
    "collections": [
      "fulfillment_orders",
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/shipments.js": {
    "collections": [
      "shipments"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/sku-channel-links.js": {
    "collections": [
      "channels",
      "partners",
      "sku_channel_links",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/sku-company-links.js": {
    "collections": [
      "generic_records",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/sku-grading.js": {
    "collections": [
      "generic_records",
      "grn"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/sku-groups.js": {
    "collections": [
      "generic_records",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/sku-imports.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/sku-moderation.js": {
    "collections": [
      "generic_records",
      "sku_channel_links",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/skubarcode.js": {
    "collections": [
      "sku_barcode",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/skus.js": {
    "collections": [
      "generic_records",
      "skus"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/sto-editor.js": {
    "collections": [
      "generic_records",
      "partners",
      "skus",
      "stock_transfers"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/sto-enquiry.js": {
    "collections": [
      "stock_transfers"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/store-groups.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/tally-config.js": {
    "collections": [
      "channels",
      "generic_records",
      "partners",
      "vendors"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/tax-categories.js": {
    "collections": [
      "generic_records",
      "skus",
      "tax_application"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/tax-groups.js": {
    "collections": [
      "tax_codes",
      "tax_group_codes"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/tax-zones.js": {
    "collections": [
      "generic_records",
      "locations",
      "tax_application",
      "tax_zone_states"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/taxapp.js": {
    "collections": [
      "generic_records",
      "tax_application"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/taxcodes.js": {
    "collections": [
      "tax_codes"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/transfers.js": {
    "collections": [
      "stock_transfers"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/transhipment-old.js": {
    "collections": [
      "generic_records",
      "partners"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/transhipment.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": true
  },
  "api/transporter-preferences.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/transporters.js": {
    "collections": [
      "partners"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/user-editor.js": {
    "collections": [
      "admin_records",
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/user-enquiry.js": {
    "collections": [
      "admin_records",
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/vendor-promotions.js": {
    "collections": [
      "vendor_promotions"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/vendor-return-editor.js": {
    "collections": [
      "grn",
      "purchase_orders",
      "returns",
      "skus",
      "vendors"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/vendor-sku-catalog.js": {
    "collections": [
      "generic_records",
      "skus",
      "vendors"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/vendor-sku-loc-catalog.js": {
    "collections": [
      "generic_records",
      "skus",
      "vendors"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/vendors.js": {
    "collections": [
      "vendors"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/vin-lister.js": {
    "collections": [
      "vin_lister_exports",
      "vin_lister_imports",
      "vin_lister_products",
      "vin_lister_transmit_logs"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  },
  "api/wms-zones.js": {
    "collections": [
      "generic_records"
    ],
    "dynamic": false,
    "hasDependencyFailureHandling": true,
    "hasDisabledBranch": false
  }
};
export const registryOnlyCollections = ["amazon_mfn_label_calls", "delivery_shipping_audit", "fulfillment_audit", "inventory"];
export const collectionAliases = { products: 'skus' };
export const expectedMongoCollections = [...new Set(Object.values(mongoModules).flatMap(module => module.collections))].sort();

export const mongoRoutes = new Set(["/api/skus", "/api/partners", "/api/sale-orders", "/api/back-orders", "/api/jsonOrderExits", "/api/purchase-orders", "/api/po-revision", "/api/purchase-order-comments", "/api/purchase-order-tags", "/api/purchase-order-inbound", "/api/purchase-order-asn", "/api/grn", "/api/asn-enquiry", "/api/manage-asn", "/api/vendor-promotions", "/api/purchase-charge-masters", "/api/chargeMasterSearch", "/api/jsonPOChargeDetailGrid", "/api/saveUpdatePOCharges", "/api/delUpdatePOCharges", "/api/category-buyers", "/api/categoryBuyerSearch", "/api/catBuyerSaveBS", "/api/inventory", "/api/inventory-ops", "/api/transfers", "/api/sto-enquiry", "/api/sto-editor", "/api/user-enquiry", "/api/user-editor", "/api/role-editor", "/api/exports", "/api/settings", "/api/returns", "/api/fulfillment", "/api/picklists", "/api/shipments", "/api/generic", "/api/reports", "/api/downloads", "/api/channels", "/api/sku-channel-links", "/api/dashboard", "/api/platforms", "/api/vendors", "/api/jsonVendorEnquirySearch", "/api/taxcodes", "/api/coupons", "/api/fetchCouponEnquiryData", "/api/taxapp", "/api/skubarcode", "/api/customers", "/api/jsonCustEnqSearch", "/api/transporters", "/api/jsonTransporterEnquirySearch", "/api/clients", "/api/jsonClientMasterEnquirySearch", "/api/customer-groups", "/api/jsonCustGroupSearch", "/api/tax-categories", "/api/tax-groups", "/api/tax-zones", "/api/org-hierarchy", "/api/locations", "/api/store-groups", "/api/sku-imports", "/api/sku-company-links", "/api/sku-groups", "/api/merch-hierarchy", "/api/attribute-sets", "/api/vendor-sku-catalog", "/api/vendor-sku-loc-catalog", "/api/manage-attributes", "/api/pricing-events", "/api/price-zones", "/api/external-apps", "/api/external-app-definitions", "/api/saveDefinition", "/api/jsonExternalAppsSearch", "/api/getRewardMasterDataForExtAppId", "/api/checkTaxIntConfigured", "/api/saveExternalAppsData", "/api/order-refunds", "/api/oms-rules", "/api/master-orders", "/api/order-enquiry", "/api/order-maintenance", "/api/kitting-orders", "/api/global-order-search", "/api/cod-reconciliation", "/api/sku-moderation", "/api/wms-zones", "/api/picker-zone-preferences", "/api/bin-enquiry", "/api/bin-editor", "/api/lottable-validations", "/api/receipt-validations", "/api/putaway-rules", "/api/putaway-enquiry", "/api/dispatch-checkpoint", "/api/sku-grading", "/api/discrepancy-enquiry", "/api/bulk-upload", "/api/mp-inventory-log", "/api/lpn-enquiry", "/api/transhipment", "/api/transhipment-old", "/api/qc-params-mapping", "/api/rtv-enquiry", "/api/vendor-return-editor", "/api/customer-return-enquiry", "/api/customer-return-editor", "/api/return-otc", "/api/global-returns-search", "/api/return-without-order", "/api/allocation-strategies", "/api/cycle-count-waves", "/api/manage-awb", "/api/transporter-preferences", "/api/service-pin-codes", "/api/order-allocation", "/api/manage-manifests", "/api/delivery-shipping", "/api/bulk-order-update", "/api/manage-picklists", "/api/manage-picking", "/api/delivery-split", "/api/shipment-handover", "/api/order-acknowledgement", "/api/consolidate-ewb", "/api/inbound-gate-pass", "/api/inbound-enquiry", "/api/inbound-create-edit", "/api/inbound-realtime", "/api/inbound-qc", "/api/inventory-move-history", "/api/inventory-move", "/api/inventory-move-scan", "/api/cycle-count", "/api/bin-audit", "/api/admin", "/api/admin-parity", "/api/tally-config", "/api/procurement", "/api/ars", "/api/fetchArsAttributes", "/api/addAndUpdateArsAttributes", "/api/bulkUpdateArsAttributes", "/api/downloadArsAttribute", "/api/ajio", "/api/amazon-mfn", "/api/vin-lister"]);
