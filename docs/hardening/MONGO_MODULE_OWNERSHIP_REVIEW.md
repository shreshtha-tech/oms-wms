# Mongo module ownership review — source inventory

Generated from `api/mongo-collections.js` and PostgreSQL migration table declarations. This is a code-reference inventory, not configured-data evidence or an approved storage decision. A dynamic flag means the registry identified dynamic collection logic; it does not prove that a client can choose a database or collection.

Observed route/module entries: 133; referenced Mongo collections: 61; registry-only collections: 4; declared PostgreSQL ci_ tables: 57.

| Module | Referenced Mongo collections | Dynamic collection logic | Ownership classification |
|---|---|---|---|
| `api/admin-parity.js` | `admin_records`, `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/admin.js` | `admin_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/ajio.js` | `ajio_backorders`, `ajio_config`, `ajio_deliveries`, `ajio_invoices`, `ajio_manifests`, `ajio_orders`, `ajio_sku_mappings`, `channels`, `skus` | REVIEW | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/allocation-strategies.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/amazon-mfn.js` | `amazon_mfn_config`, `amazon_mfn_inventory_logs`, `amazon_mfn_mappings`, `amazon_mfn_orders`, `amazon_mfn_returns`, `amazon_mfn_shipments`, `channels`, `skus` | REVIEW | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/ars.js` | `ars_execution_logs`, `ars_rules`, `ars_settings`, `ars_sku_links`, `generic_records`, `skus` | REVIEW | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/asn-enquiry.js` | `grn` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/attribute-sets.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/back-orders.js` | `back_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/bin-audit.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/bin-editor.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/bin-enquiry.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/bulk-order-update.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/bulk-upload.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/catalogs.js` | `channels`, `generic_records`, `partners` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/category-buyers.js` | `procurement_buyers` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/channels.js` | `channels` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/clients.js` | `partners` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/cod-reconciliation.js` | `sale_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/consolidate-ewb.js` | `fulfillment_orders`, `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/coupons.js` | `coupons_master` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/customer-groups.js` | `generic_records`, `partners` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/customer-return-editor.js` | `fulfillment_orders`, `partners`, `returns`, `sale_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/customer-return-enquiry.js` | `returns` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/customers.js` | `generic_records`, `partners` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/cycle-count-waves.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/cycle-count.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/dashboard.js` | `inventory_policies`, `sale_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/delivery-shipping.js` | `fulfillment_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/delivery-split.js` | `fulfillment_orders`, `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/discrepancy-enquiry.js` | `generic_records`, `grn` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/dispatch-checkpoint.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/downloads.js` | `downloads` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/exports.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/external-app-definitions.js` | `external_app_definitions` | REVIEW | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/external-apps.js` | `channels`, `external_apps`, `generic_records`, `partners` | REVIEW | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/fulfillment.js` | `fulfillment_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/generic.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/global-header-search.js` | `purchase_orders`, `returns`, `sale_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/global-order-search.js` | `generic_records`, `sale_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/global-returns-search.js` | `generic_records`, `partners`, `returns` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/grn.js` | `grn` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inbound-create-edit.js` | `grn`, `purchase_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inbound-enquiry.js` | `grn`, `partners`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inbound-gate-pass.js` | `generic_records`, `purchase_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inbound-qc.js` | `grn` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inbound-realtime.js` | `generic_records`, `grn`, `purchase_orders`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inbound-receipt-guard.js` | `grn` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inventory-move-history.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inventory-move-scan.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inventory-move.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inventory-ops.js` | `inventory_lottables`, `inventory_moves`, `outbound_gate_passes`, `outbound_memos`, `sku_lot_transfers`, `sku_transactions`, `stock_adjustments` | REVIEW | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/inventory.js` | `inventory_policies`, `partners`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/kitting-orders.js` | `generic_records`, `sale_orders`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/locations.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/lottable-validations.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/lpn-enquiry.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/manage-asn.js` | `generic_records`, `grn` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/manage-attributes.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/manage-awb.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/manage-manifests.js` | `fulfillment_orders`, `partners`, `shipments` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/manage-picking.js` | `fulfillment_orders`, `generic_records`, `picklists` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/manage-picklists.js` | `fulfillment_orders`, `generic_records`, `picklists` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/master-orders.js` | `sale_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/merch-hierarchy.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/mp-inventory-log.js` | `channels`, `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/oms-rules.js` | `channels`, `generic_records`, `oms_rules` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/order-acknowledgement.js` | `fulfillment_orders`, `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/order-allocation.js` | `fulfillment_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/order-enquiry.js` | `channels`, `generic_records`, `sale_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/order-maintenance.js` | `generic_records`, `sale_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/order-refunds.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/org-hierarchy.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/partners.js` | `partners` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/picker-zone-preferences.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/picklists.js` | `picklists` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/platforms.js` | `channels` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/po-revision.js` | `purchase_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/price-zones.js` | `generic_records`, `locations` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/pricing-events.js` | `generic_records`, `skus`, `vendors` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/procurement.js` | `otb_budgets`, `procurement_buyers`, `vendor_invoices` | REVIEW | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/purchase-charge-masters.js` | `purchase_charge_masters` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/purchase-order-asn.js` | `grn`, `purchase_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/purchase-order-comments.js` | `purchase_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/purchase-order-inbound.js` | `grn`, `purchase_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/purchase-order-tags.js` | `purchase_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/purchase-orders.js` | `otb_budgets`, `purchase_orders`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/putaway-enquiry.js` | `generic_records`, `grn` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/putaway-rules.js` | `generic_records`, `skus`, `vendors` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/qc-params-mapping.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/receipt-validations.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/reports.js` | `fulfillment_orders`, `grn`, `picklists`, `purchase_orders`, `returns`, `sale_orders`, `shipments`, `skus`, `stock_transfers` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/return-otc.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/return-without-order.js` | `generic_records`, `partners`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/returns.js` | `partners`, `purchase_orders`, `returns`, `sale_orders`, `skus`, `vendors` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/role-editor.js` | `admin_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/rtv-enquiry.js` | `generic_records`, `returns` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/sale-orders.js` | `sale_orders` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/service-pin-codes.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/settings.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/shipment-handover.js` | `fulfillment_orders`, `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/shipments.js` | `shipments` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/sku-channel-links.js` | `channels`, `partners`, `sku_channel_links`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/sku-company-links.js` | `generic_records`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/sku-grading.js` | `generic_records`, `grn` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/sku-groups.js` | `generic_records`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/sku-imports.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/sku-moderation.js` | `generic_records`, `sku_channel_links`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/skubarcode.js` | `sku_barcode`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/skus.js` | `generic_records`, `skus` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/sto-editor.js` | `generic_records`, `partners`, `skus`, `stock_transfers` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/sto-enquiry.js` | `stock_transfers` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/store-groups.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/tally-config.js` | `channels`, `generic_records`, `partners`, `vendors` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/tax-categories.js` | `generic_records`, `skus`, `tax_application` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/tax-groups.js` | `tax_codes`, `tax_group_codes` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/tax-zones.js` | `generic_records`, `locations`, `tax_application`, `tax_zone_states` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/taxapp.js` | `generic_records`, `tax_application` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/taxcodes.js` | `tax_codes` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/transfers.js` | `stock_transfers` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/transhipment-old.js` | `generic_records`, `partners` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/transhipment.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/transporter-preferences.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/transporters.js` | `partners` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/user-editor.js` | `admin_records`, `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/user-enquiry.js` | `admin_records`, `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/vendor-promotions.js` | `vendor_promotions` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/vendor-return-editor.js` | `grn`, `purchase_orders`, `returns`, `skus`, `vendors` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/vendor-sku-catalog.js` | `generic_records`, `skus`, `vendors` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/vendor-sku-loc-catalog.js` | `generic_records`, `skus`, `vendors` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/vendors.js` | `vendors` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/vin-lister.js` | `vin_lister_exports`, `vin_lister_imports`, `vin_lister_products`, `vin_lister_transmit_logs` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |
| `api/wms-zones.js` | `generic_records` | No | BLOCKED_PENDING_ARCHITECTURAL_DECISION |

Registry-only collection names: `amazon_mfn_label_calls`, `delivery_shipping_audit`, `fulfillment_audit`, `inventory`.

Each row needs a field-level authority decision, tenant and role model, configured-data diagnosis, index/constraint plan, migration and rollback evidence before classification can become KEEP_IN_MONGO, MOVE_TO_POSTGRES, or HYBRID_WITH_EXPLICIT_BOUNDARY. See `docs/DATABASE_AUTHORITY_MATRIX.md` for current major-entity decisions. No database was connected or modified.
