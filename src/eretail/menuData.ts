import {
  Gauge, ListTree, ShoppingCart, ShoppingBag, Boxes, ArrowLeftRight,
  UserPlus, BookOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type MItem = { label: string; to?: string };
export type MCol = { groups: { title: string; items: MItem[] }[] };
export type RailEntry = {
  key: string;
  icon: LucideIcon;
  title: string;
  single?: string;
  columns?: MCol[];
};

// Routes below are only used for dedicated, evidence-backed implementations.
const g = (slug: string) => `/app/m/${slug}`;

// ============================================================================
//  Menu labels are captured from the authorized demo. Every menu item is
//  Evidence-backed screens route to their dedicated module. A captured label
//  without an observed LOCAL workflow remains visible and disabled with an
//  unavailable hint until its LIVE contract has been audited.
// ============================================================================
export const RAIL: RailEntry[] = [
  {
    key: 'dashboard', icon: Gauge, title: 'Dashboard', single: '/app/dashboard',
    columns: [{ groups: [{ title: '', items: [
      { label: 'D-Mills Dashboard', to: '/app/dashboard' },
      { label: 'Seller Panel Dashboard', to: '/app/seller-panel-dashboard' },
    ] }] }],
  },

  {
    key: 'master', icon: ListTree, title: 'Master',
    columns: [
      { groups: [
        { title: 'Trading Partners', items: [
          { label: 'Vendor Master', to: '/app/vendors' },
          { label: 'Customer Master', to: '/app/customers' },
          { label: 'Transporter Master', to: '/app/transporters' },
          { label: 'Client Master', to: '/app/clients' },
          { label: 'Customer Group', to: '/app/customer-groups' },
        ]},
        { title: 'POS Setup', items: [
          { label: 'Manage Coupons', to: '/app/coupons' },
          { label: 'Manage Voucher Condition' },
          { label: 'Generate Vouchers', to: g('vouchers') },
        ]},
        { title: 'Custom', items: [
          { label: 'ConsolidateVendorReturn' },
        ]},
      ]},
      { groups: [
        { title: 'Tax Management', items: [
          { label: 'Tax Category (HSN/SAC)', to: '/app/tax-categories' },
          { label: 'Tax Code', to: '/app/tax-code' },
          { label: 'Tax Group', to: '/app/tax-groups' },
          { label: 'Tax Zone', to: '/app/tax-zones' },
          { label: 'Tax Application', to: '/app/tax-application' },
        ]},
        { title: 'Organization Management', items: [
          { label: 'Organization Hierarchy', to: g('org-hierarchy') },
          { label: 'Location Enquiry', to: g('location') },
          { label: 'Location Create/Edit', to: '/app/m/location-create' },
          { label: 'Manage Store Group', to: g('store-group') },
        ]},
      ]},
      { groups: [
        { title: 'SKU Management', items: [
          { label: 'SKU Master', to: '/app/skus' },
          { label: 'SKU Import', to: '/app/sku-import' },
          { label: 'SKU Company Link', to: '/app/sku-company-link' },
          { label: 'SKU Barcode', to: '/app/sku-barcode' },
          { label: 'Manage SKU Group', to: g('sku-group') },
          { label: 'Merchandising Hierarchy', to: g('merch-hierarchy') },
          { label: 'Manage Attribute', to: g('manage-attribute') },
          { label: 'Attribute Set', to: g('attribute-set') },
          { label: 'Vendor SKU Catalog', to: g('vendor-sku-catalog') },
          { label: 'Vendor SKU Loc Catalog', to: g('vendor-sku-loc-catalog') },
          { label: 'ARS SKU-Location Link', to: '/app/procurement/ars/sku-location' },
        ]},
        { title: 'Miscellaneous', items: [
          { label: 'Other Masters', to: g('other-masters') },
          { label: 'Pricing Event', to: '/app/pricing-events' },
          { label: 'Tally Configuration', to: '/app/tally-configuration' },
          { label: 'Price Zone Master', to: g('price-zone') },
          { label: 'External Apps', to: g('external-apps') },
          { label: 'Order Refund', to: g('order-refund') },
          { label: 'Sales Representative' },
        ]},
      ]},
    ],
  },

  {
    key: 'procurement', icon: ShoppingCart, title: 'Procurement',
    columns: [
      { groups: [
        { title: 'PO Create/Edit', items: [
          { label: 'Single Location', to: '/app/procurement/po/single' },
          { label: 'Multiple Location', to: '/app/procurement/po/multiple' },
          { label: 'From Back Orders', to: '/app/procurement/po/back-orders' },
        ]},
      ]},
      { groups: [
        { title: '', items: [
          { label: 'PO Enquiry', to: '/app/procurement/po-enquiry' },
          { label: 'PO Revision', to: '/app/purchase-orders' },
          { label: 'Manage ASN', to: '/app/grn' },
          { label: 'Vendor Promotions', to: g('vendor-promotions') },
        ]},
      ]},
      { groups: [
        { title: 'Setup', items: [
          { label: 'Purchase Charge Masters', to: g('purchase-charge') },
          { label: 'Category Buyers', to: '/app/procurement/category-buyers' },
        ]},
        { title: 'ARS', items: [
          { label: 'ARS SKU-Location Link', to: '/app/procurement/ars/sku-location' },
          { label: 'ARS Rules', to: '/app/procurement/ars/rules' },
          { label: 'ARS Execution Log', to: '/app/procurement/ars/logs' },
        ]},
      ]},
    ],
  },

  {
    key: 'sales', icon: ShoppingBag, title: 'Sales',
    columns: [
      { groups: [
        { title: '', items: [
          { label: 'Manage Channels', to: '/app/channels' },
          { label: 'SKU Channel Listing', to: '/app/sku-channel-listing' },
          { label: 'OMS Rules', to: g('oms-rules') },
        ]},
      ]},
      { groups: [
        { title: '', items: [
          { label: 'Master Order Enquiry', to: '/app/master-order-enquiry' },
          { label: 'Order Enquiry', to: '/app/order-enquiry' },
          { label: 'Manage Kitting Order', to: g('kitting-order') },
          { label: 'Global Order Search', to: '/app/global-order-search' },
        ]},
      ]},
      { groups: [
        { title: 'Payment Recon', items: [
          { label: 'COD Reconciliation', to: '/app/cod-reconciliation' },
          { label: 'SKU Moderation', to: '/app/sku-moderation' },
        ]},
      ]},
    ],
  },

  {
    key: 'wms', icon: Boxes, title: 'WMS',
    columns: [
      { groups: [
        { title: 'Setup', items: [
          { label: 'Zone', to: '/app/wms/zone' },
          { label: 'Picker Zone Preference', to: '/app/wms/picker-zone-preference' },
          { label: 'Bin Enquiry', to: '/app/wms/bin-enquiry' },
          { label: 'Bin Create/Edit', to: '/app/wms/bin-editor' },
          { label: 'Lottable Validation', to: '/app/wms/lottable-validation' },
          { label: 'Receipt Validation', to: '/app/wms/receipt-validation' },
          { label: 'SKU Label Print', to: '/app/wms/sku-label-print' },
          { label: 'Manage PutAway Rule', to: '/app/wms/putaway-rules' },
          { label: 'Manage Allocation Strategies', to: '/app/wms/allocation-strategies' },
          { label: 'Manage Cycle Count Wave', to: '/app/wms/cycle-count-waves' },
        ]},
        { title: 'Logistics', items: [
          { label: 'Manage AWB', to: '/app/wms/manage-awb' },
          { label: 'Transporter Preference', to: '/app/wms/transporter-preference' },
          { label: 'Manage Service Pin Code', to: '/app/wms/service-pin-codes' },
        ]},
      ]},
      { groups: [
        { title: 'Order Processing', items: [
          { label: 'Order Allocate/Unallocate', to: '/app/fulfillment/allocate' },
          { label: 'Manage Manifest', to: '/app/fulfillment/shipment-handover' },
          { label: 'Delivery Shipping', to: '/app/fulfillment/delivery-shipping' },
          { label: 'Bulk Order Update', to: '/app/fulfillment/bulk-update' },
          { label: 'Manage Picklist', to: '/app/fulfillment/manage-picklist' },
          { label: 'Manage Picking', to: '/app/fulfillment/manage-picking' },
          { label: 'Delivery Split', to: '/app/fulfillment/delivery-split' },
          { label: 'Shipment Handover', to: '/app/fulfillment/shipment-receiving' },
          { label: 'Order Acknowledgement', to: '/app/fulfillment/order-acknowledgement' },
          { label: 'Consolidate EWB', to: '/app/fulfillment/consolidate-ewb' },
          { label: 'Sort To Box', to: '/app/fulfillment/sort-to-box' },
        ]},
        { title: 'Inbound', items: [
          { label: 'Manage Inbound Gate Pass', to: '/app/r/inbound-gate-pass' },
          { label: 'Inbound Enquiry', to: '/app/r/inbound-enquiry' },
          { label: 'Inbound Create/Edit', to: '/app/r/inbound-create-edit' },
          { label: 'Inbound RealTime', to: '/app/r/inbound-realtime' },
          { label: 'Inbound QC', to: '/app/r/inbound-qc' },
          { label: 'Direct Inbound' },
          { label: 'STO Inbound' },
          { label: 'Link USN IMEI' },
          { label: 'Return Inbound Create/Edit' },
          { label: 'FnV QC Enquiry' },
          { label: 'FNV Inbound' },
        ]},
      ]},
      { groups: [
        { title: 'Inventory', items: [
          { label: 'Central Inventory', to: '/app/central-inventory' },
          { label: 'Inventory View', to: '/app/inventory' },
          { label: 'Inventory Move History', to: '/app/r/inv-move-history' },
          { label: 'Inventory Move', to: '/app/r/inv-move' },
          { label: 'Inventory Move By Scan', to: '/app/r/inv-move-scan' },
          { label: 'Cycle Count', to: '/app/r/cycle-count' },
          { label: 'BIN Audit', to: '/app/r/bin-audit' },
          { label: 'Bulk update Lottables', to: '/app/r/bulk-lottables' },
          { label: 'Inventory Hold' },
          { label: 'Manage Stock Adjustment', to: '/app/m/stock-adjustment' },
          { label: 'OutBound GatePass' },
          { label: 'Manage Outbound Memo' },
          { label: 'SKU Transaction History' },
          { label: 'Manage SKU Lot Transfer' },
          { label: 'Manage RePack' },
          { label: 'SKU Lot Transfer Create/Edit' },
          { label: 'Manage Inventory Reservation' },
          { label: 'Inventory Move By Task' },
          { label: 'Manage Let Down' },
          { label: 'FnV Repack' },
        ]},
        { title: 'Miscellaneous', items: [
          { label: 'PutAway Enquiry', to: '/app/r/putaway-enquiry' },
          { label: 'Dispatch Checkpoint Enquiry', to: '/app/r/dispatch-checkpoint' },
          { label: 'Sku Grading', to: '/app/r/sku-grading' },
          { label: 'Discrepancy Enquiry', to: '/app/r/discrepancy-enquiry' },
          { label: 'Bulk Upload', to: '/app/r/bulk-upload' },
          { label: 'MP Inventory Log', to: '/app/r/mr-inventory-log' },
          { label: 'LPN Enquiry', to: '/app/r/lpn-enquiry' },
          { label: 'Transhipment Old', to: '/app/r/transhipment-old' },
          { label: 'Transhipment', to: '/app/r/transhipment' },
          { label: 'QC Params Mapping', to: '/app/r/qc-params-mapping' },
        ]},
      ]},
    ],
  },

  {
    key: 'returns', icon: ArrowLeftRight, title: 'Returns & Transfers',
    columns: [
      { groups: [
        { title: 'Returns', items: [
          { label: 'RTV Enquiry', to: '/app/returns/rtv-enquiry' },
          { label: 'Vendor Return Create/Edit', to: '/app/returns/vendor-return' },
          { label: 'Return Enquiry', to: '/app/returns/customer-enquiry' },
          { label: 'Return Create/Edit', to: '/app/returns/customer-return' },
          { label: 'Return OTC(Flipkart)', to: g('return-otc') },
          { label: 'Return OTC(Flipkart) New', to: g('return-otc-new') },
          { label: 'Global Returns Search', to: '/app/returns/global-search' },
          { label: 'Return W/o Order', to: g('return-wo-order') },
        ]},
      ]},
      { groups: [
        { title: 'Transfers', items: [
          { label: 'STO Order Enquiry', to: '/app/transfers' },
          { label: 'STO Order Create/Edit', to: '/app/transfers/create' },
        ]},
      ]},
    ],
  },

  {
    key: 'admin', icon: UserPlus, title: 'Admin',
    columns: [
      { groups: [
        { title: 'User Management', items: [
          { label: 'User Enquiry', to: '/app/admin/user-enquiry' },
          { label: 'User Create/Edit', to: '/app/admin/user-create-edit' },
          { label: 'Role Create/Edit', to: '/app/admin/role-create-edit' },
        ]},
        { title: 'Logs', items: [
          { label: 'User Audit Logs', to: '/app/admin/user-audit-logs' },
          { label: 'Accounting Log', to: '/app/admin/accounting-log' },
          { label: 'Tax Integration Log', to: '/app/admin/tax-integration-log' },
          { label: 'Device Tracking Log', to: '/app/admin/device-tracking-log' },
          { label: 'External Apps Logs', to: '/app/admin/external-apps-logs' },
          { label: 'POS Integration Log', to: '/app/admin/pos-integration-log' },
          { label: 'Repush Log', to: '/app/admin/repush-log' },
        ]},
      ]},
      { groups: [
        { title: 'Imports', items: [
          { label: 'Order Import', to: '/app/admin/order-import' },
          { label: 'Common Import', to: '/app/admin/common-import' },
        ]},
      ]},
      { groups: [
        { title: 'Miscellaneous', items: [
          { label: 'Exports', to: '/app/admin/exports' },
          { label: 'Force Order Pull', to: '/app/admin/force-order-pull' },
          { label: 'Settings', to: '/app/admin/settings' },
          { label: 'Manage Api', to: '/app/admin/manage-api' },
          { label: 'API Dashboard', to: '/app/admin/api-dashboard' },
          { label: 'Language Setting', to: '/app/admin/language-setting' },
        ]},
      ]},
    ],
  },

  {
    key: 'reports', icon: BookOpen, title: 'Reports',
    columns: [
      { groups: [
        { title: 'Inbound', items: [
          { label: 'GR Register', to: '/app/r/gr-register' },
          { label: 'PO Report', to: '/app/r/po-report' },
          { label: 'Inbound QC Report', to: '/app/r/inbound-qc-report' },
        ]},
        { title: 'Inventory', items: [
          { label: 'Fin Inv Report - By SKU', to: '/app/r/fin-inv-sku' },
          { label: 'Fin Inv Report - By SKU BIN', to: '/app/r/fin-inv-sku-bin' },
          { label: 'Inventory Ageing', to: '/app/r/inventory-ageing' },
          { label: 'Inventory Ledger', to: '/app/r/inventory-ledger' },
        ]},
      ]},
      { groups: [
        { title: 'Finance', items: [
          { label: 'Sales Register', to: '/app/r/sales-register' },
          { label: 'Purchase Register', to: '/app/r/purchase-register' },
          { label: 'Sales Return Register', to: '/app/r/sales-return-register' },
        ]},
        { title: 'Sales & Return', items: [
          { label: 'Sales Report', to: '/app/r/sales-report' },
          { label: 'SKU Wise Sales Report', to: '/app/r/sku-wise-sales' },
          { label: 'Order Life Cycle', to: '/app/r/order-life-cycle' },
        ]},
      ]},
      { groups: [
        { title: 'Outbound', items: [
          { label: 'Ship Label/Delivery Challan', to: '/app/r/shipping-label' },
          { label: 'Invoice', to: '/app/r/invoice-report' },
          { label: 'Manifest Report', to: '/app/r/manifest-report' },
          { label: 'Dispatch Report', to: '/app/r/dispatch-report' },
        ]},
        { title: 'Miscellaneous', items: [
          { label: 'MIS reports', to: '/app/r/mis-report' },
          { label: 'Pick Pack Report', to: '/app/r/pick-pack-report' },
          { label: 'Order Unallocation Log', to: '/app/r/order-unallocation' },
          { label: 'MIS Report 2.0', to: '/app/r/mis-report-2' },
        ]},
      ]},
    ],
  },
];

// Titles + which rail each generic slug belongs to (breadcrumb + active icon)
export const GENERIC_META: Record<string, { title: string; active: string; crumb: string; codeLabel?: string; nameLabel?: string }> = {
  // --- Master ---
  'customer-group': { title: 'Customer Group', active: 'master', crumb: 'MASTER > Customer Group' },
  'coupons': { title: 'Manage Coupons', active: 'master', crumb: 'MASTER > Manage Coupons', codeLabel: 'Coupon Code', nameLabel: 'Coupon Name' },
  'voucher-condition': { title: 'Manage Voucher Condition', active: 'master', crumb: 'MASTER > Voucher Condition' },
  'vouchers': { title: 'Generate Vouchers', active: 'master', crumb: 'MASTER > Generate Vouchers', codeLabel: 'Voucher Code' },
  'tax-category': { title: 'Tax Category (HSN/SAC)', active: 'master', crumb: 'MASTER > Tax Category (HSN/SAC)', codeLabel: 'HSN/SAC' },
  'tax-code': { title: 'Tax Code', active: 'master', crumb: 'MASTER > Tax Code', codeLabel: 'Tax Code' },
  'tax-group': { title: 'Tax Group', active: 'master', crumb: 'MASTER > Tax Group' },
  'tax-zone': { title: 'Tax Zone', active: 'master', crumb: 'MASTER > Tax Zone' },
  'tax-application': { title: 'Tax Application', active: 'master', crumb: 'MASTER > Tax Application' },
  'org-hierarchy': { title: 'Organization Hierarchy', active: 'master', crumb: 'MASTER > Organization Hierarchy' },
  'location': { title: 'Location Master', active: 'master', crumb: 'MASTER > Location', codeLabel: 'Location Code' },
  'store-group': { title: 'Manage Store Group', active: 'master', crumb: 'MASTER > Store Group' },
  'sku-company-link': { title: 'SKU Company Link', active: 'master', crumb: 'MASTER > SKU Company Link', codeLabel: 'SKU Code' },
  'sku-barcode': { title: 'SKU Barcode', active: 'master', crumb: 'MASTER > SKU Barcode', codeLabel: 'Barcode' },
  'sku-group': { title: 'Manage SKU Group', active: 'master', crumb: 'MASTER > SKU Group' },
  'merch-hierarchy': { title: 'Merchandising Hierarchy', active: 'master', crumb: 'MASTER > Merchandising Hierarchy' },
  'manage-attribute': { title: 'Manage Attribute', active: 'master', crumb: 'MASTER > Manage Attribute', codeLabel: 'Attribute Code', nameLabel: 'Attribute Name' },
  'other-masters': { title: 'Other Masters', active: 'master', crumb: 'MASTER > Other Masters' },
  'pricing-event': { title: 'Pricing Event', active: 'master', crumb: 'MASTER > Pricing Event' },
  'price-zone': { title: 'Price Zone Master', active: 'master', crumb: 'MASTER > Price Zone' },
  'order-refund': { title: 'Order Refund', active: 'master', crumb: 'MASTER > Order Refund' },
  'sales-rep': { title: 'Sales Representative', active: 'master', crumb: 'MASTER > Sales Representative' },
  // --- Procurement ---
  'vendor-promotions': { title: 'Vendor Promotions', active: 'procurement', crumb: 'PROCUREMENT > Vendor Promotions' },
  'purchase-charge': { title: 'Purchase Charge Masters', active: 'procurement', crumb: 'PROCUREMENT > Purchase Charge Masters' },
  'category-buyers': { title: 'Category Buyers', active: 'procurement', crumb: 'PROCUREMENT > Category Buyers' },
  'ars-sku-location': { title: 'ARS SKU-Location Link', active: 'procurement', crumb: 'PROCUREMENT > ARS SKU-Location Link' },
  'ars-rules': { title: 'ARS Rules', active: 'procurement', crumb: 'PROCUREMENT > ARS Rules' },
  'ars-log': { title: 'ARS Execution Log', active: 'procurement', crumb: 'PROCUREMENT > ARS Execution Log' },
  // --- Sales ---
  'oms-rules': { title: 'OMS Rules', active: 'sales', crumb: 'SALES > OMS Rules' },
  'kitting-order': { title: 'Manage Kitting Order', active: 'sales', crumb: 'SALES > Manage Kitting Order' },
  'cod-recon': { title: 'COD Reconciliation', active: 'sales', crumb: 'SALES > COD Reconciliation' },
  // --- WMS: Setup ---
  'wms-zone': { title: 'Zone', active: 'wms', crumb: 'WMS > Zone', codeLabel: 'Zone Code', nameLabel: 'Zone Name' },
  'picker-zone-pref': { title: 'Picker Zone Preference', active: 'wms', crumb: 'WMS > Picker Zone Preference' },
  'bin-enquiry': { title: 'Bin Enquiry', active: 'wms', crumb: 'WMS > Bin Enquiry', codeLabel: 'Bin Code' },
  'bin-create-edit': { title: 'Bin Create/Edit', active: 'wms', crumb: 'WMS > Bin Create/Edit', codeLabel: 'Bin Code' },
  'lottable-validation': { title: 'Lottable Validation', active: 'wms', crumb: 'WMS > Lottable Validation' },
  'receipt-validation': { title: 'Receipt Validation', active: 'wms', crumb: 'WMS > Receipt Validation' },
  'sku-label-print': { title: 'SKU Label Print', active: 'wms', crumb: 'WMS > SKU Label Print', codeLabel: 'SKU Code' },
  // --- WMS: Logistics ---
  'manage-awb': { title: 'Manage AWB', active: 'wms', crumb: 'WMS > Manage AWB', codeLabel: 'AWB No' },
  'transporter-pref': { title: 'Transporter Preference', active: 'wms', crumb: 'WMS > Transporter Preference' },
  'service-pin-code': { title: 'Manage Service Pin Code', active: 'wms', crumb: 'WMS > Manage Service Pin Code', codeLabel: 'Pin Code' },
  // --- WMS: Inbound ---
  'inbound-gate-pass': { title: 'Manage Inbound Gate Pass', active: 'wms', crumb: 'WMS > Inbound Gate Pass', codeLabel: 'Gate Pass No' },
  'inbound-enquiry': { title: 'Inbound Enquiry', active: 'wms', crumb: 'WMS > Inbound Enquiry' },
  'inbound-realtime': { title: 'Inbound RealTime', active: 'wms', crumb: 'WMS > Inbound RealTime' },
  'inbound-qc': { title: 'Inbound QC', active: 'wms', crumb: 'WMS > Inbound QC' },
  // --- WMS: Inventory ---
  'inv-move-history': { title: 'Inventory Move History', active: 'wms', crumb: 'WMS > Inventory Move History' },
  'inv-move': { title: 'Inventory Move', active: 'wms', crumb: 'WMS > Inventory Move' },
  'inv-move-scan': { title: 'Inventory Move By Scan', active: 'wms', crumb: 'WMS > Inventory Move By Scan' },
  'cycle-count': { title: 'Cycle Count', active: 'wms', crumb: 'WMS > Cycle Count' },
  'bin-audit': { title: 'BIN Audit', active: 'wms', crumb: 'WMS > BIN Audit' },
  'bulk-lottables': { title: 'Bulk update Lottables', active: 'wms', crumb: 'WMS > Bulk update Lottables' },
  // --- WMS: Miscellaneous ---
  'putaway-enquiry': { title: 'PutAway Enquiry', active: 'wms', crumb: 'WMS > PutAway Enquiry' },
  'dispatch-checkpoint': { title: 'Dispatch Checkpoint Enquiry', active: 'wms', crumb: 'WMS > Dispatch Checkpoint Enquiry' },
  'sku-grading': { title: 'Sku Grading', active: 'wms', crumb: 'WMS > Sku Grading' },
  'discrepancy-enquiry': { title: 'Discrepancy Enquiry', active: 'wms', crumb: 'WMS > Discrepancy Enquiry' },
  'bulk-upload': { title: 'Bulk Upload', active: 'wms', crumb: 'WMS > Bulk Upload' },
  'mr-inventory-log': { title: 'MR Inventory Log', active: 'wms', crumb: 'WMS > MR Inventory Log' },
  // --- Returns & Transfers ---
  'rtv-enquiry': { title: 'RTV Enquiry', active: 'returns', crumb: 'RETURNS & TRANSFERS > RTV Enquiry' },
  'vendor-return': { title: 'Vendor Return Create/Edit', active: 'returns', crumb: 'RETURNS & TRANSFERS > Vendor Return Create/Edit' },
  'return-otc': { title: 'Return OTC (Flipkart)', active: 'returns', crumb: 'RETURNS & TRANSFERS > Return OTC (Flipkart)' },
  'return-otc-new': { title: 'Return OTC (Flipkart) New', active: 'returns', crumb: 'RETURNS & TRANSFERS > Return OTC (Flipkart) New' },
  'return-wo-order': { title: 'Return W/o Order', active: 'returns', crumb: 'RETURNS & TRANSFERS > Return W/o Order' },
  // --- Admin: User Management ---
  'user-enquiry': { title: 'User Enquiry', active: 'admin', crumb: 'ADMIN > User Enquiry', codeLabel: 'User ID', nameLabel: 'User Name' },
  'user-create-edit': { title: 'User Create/Edit', active: 'admin', crumb: 'ADMIN > User Create/Edit', codeLabel: 'User ID', nameLabel: 'User Name' },
  'role-create-edit': { title: 'Role Create/Edit', active: 'admin', crumb: 'ADMIN > Role Create/Edit', codeLabel: 'Role Code', nameLabel: 'Role Name' },
  // --- Admin: Imports ---
  'order-import': { title: 'Order Import', active: 'admin', crumb: 'ADMIN > Order Import' },
  'common-import': { title: 'Common Import', active: 'admin', crumb: 'ADMIN > Common Import' },
  // --- Admin: Miscellaneous ---
  'exports': { title: 'Exports', active: 'admin', crumb: 'ADMIN > Exports' },
  'force-order-pull': { title: 'Force Order Pull', active: 'admin', crumb: 'ADMIN > Force Order Pull' },
  'settings': { title: 'Settings', active: 'admin', crumb: 'ADMIN > Settings' },
  'manage-api': { title: 'Manage Api', active: 'admin', crumb: 'ADMIN > Manage Api' },
  'api-dashboard': { title: 'API Dashboard', active: 'admin', crumb: 'ADMIN > API Dashboard' },
  // --- Admin: Logs ---
  'user-audit-logs': { title: 'User Audit Logs', active: 'admin', crumb: 'ADMIN > User Audit Logs' },
  'accounting-log': { title: 'Accounting Log', active: 'admin', crumb: 'ADMIN > Accounting Log' },
  'tax-integration-log': { title: 'Tax Integration Log', active: 'admin', crumb: 'ADMIN > Tax Integration Log' },
  'device-tracking-log': { title: 'Device Tracking Log', active: 'admin', crumb: 'ADMIN > Device Tracking Log' },
  'external-apps-logs': { title: 'External Apps Logs', active: 'admin', crumb: 'ADMIN > External Apps Logs' },
  'pos-integration-log': { title: 'POS Integration Log', active: 'admin', crumb: 'ADMIN > POS Integration Log' },
  'repush-log': { title: 'Repush Log', active: 'admin', crumb: 'ADMIN > Repush Log' },
};
