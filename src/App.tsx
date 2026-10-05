import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { AuthProvider } from "./context/AuthContext";
import { DownloadProvider } from "./context/DownloadContext";
import { GlobalScreenOverlayHost, ScreenFrameProvider, ScreenProvider, useScreens } from "./eretail/ScreenContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Shell from "./eretail/Shell";
import Login from "./pages/Login";
const PurchaseOrders = lazy(() => import("./pages/PurchaseOrders"));
const GRN = lazy(() => import("./pages/GRN"));
const Inventory = lazy(() => import("./pages/Inventory"));
const InventoryOperations = lazy(() => import("./pages/InventoryOperations"));
const Transfers = lazy(() => import("./pages/Transfers"));
const StoEditor = lazy(() => import("./eretail/transfers/StoEditor"));
const Skus = lazy(() => import("./pages/Skus"));
const Partners = lazy(() => import("./pages/Partners"));
const RtvEnquiry = lazy(() => import("./eretail/returns/RtvEnquiry"));
const VendorReturnEditor = lazy(() => import("./eretail/returns/VendorReturnEditor"));
const CustomerReturnEnquiry = lazy(() => import("./eretail/returns/CustomerReturnEnquiry"));
const CustomerReturnEditor = lazy(() => import("./eretail/returns/CustomerReturnEditor"));
const ReturnOtc = lazy(() => import("./eretail/returns/ReturnOtc"));
const GlobalReturnsSearch = lazy(() => import("./eretail/returns/GlobalReturnsSearch"));
const ReturnWithoutOrder = lazy(() => import("./eretail/returns/ReturnWithoutOrder"));
const Reports = lazy(() => import("./pages/Reports"));

// eRetail shell
const EDashboard = lazy(() => import("./eretail/EDashboard"));
const VendorPromotions = lazy(() => import("./eretail/procurement/VendorPromotions"));
const PurchaseChargeMasters = lazy(() => import("./eretail/procurement/PurchaseChargeMasters"));
const CategoryBuyers = lazy(() => import("./eretail/procurement/CategoryBuyers"));
const ReportRoute = lazy(() => import("./eretail/ReportRoute"));
const ControlTower = lazy(() => import("./eretail/ControlTower"));
const Downloads = lazy(() => import("./eretail/Downloads"));
const ManageChannels = lazy(() => import("./eretail/ManageChannels"));
const SkuChannelListing = lazy(() => import("./eretail/SkuChannelListing"));
const VendorMaster = lazy(() => import("./eretail/masters/VendorMaster"));
const CustomerMaster = lazy(() => import("./eretail/masters/CustomerMaster"));
const TransporterMaster = lazy(() => import("./eretail/masters/TransporterMaster"));
const ClientMaster = lazy(() => import("./eretail/masters/ClientMaster"));
const CustomerGroupMaster = lazy(() => import("./eretail/masters/CustomerGroupMaster"));
const TaxCode = lazy(() => import("./eretail/masters/TaxCode"));
const ManageCoupons = lazy(() => import("./eretail/masters/ManageCoupons"));
const TaxApplication = lazy(() => import("./eretail/masters/TaxApplication"));
const SkuBarcode = lazy(() => import("./eretail/masters/SkuBarcode"));
const SkuCompanyLink = lazy(() => import("./eretail/masters/SkuCompanyLink"));
const MerchandisingHierarchy = lazy(() => import("./eretail/masters/MerchandisingHierarchy"));
const ManageAttribute = lazy(() => import("./eretail/masters/ManageAttribute"));
const AttributeSet = lazy(() => import("./eretail/masters/AttributeSet"));
const GenerateVouchers = lazy(() => import("./eretail/masters/GenerateVouchers"));
const VendorSkuCatalog = lazy(() => import("./eretail/masters/VendorSkuCatalog"));
const VendorSkuLocCatalog = lazy(() => import("./eretail/masters/VendorSkuLocCatalog"));
const OrganizationHierarchy = lazy(() => import("./eretail/masters/OrganizationHierarchy"));
const LocationEnquiry = lazy(() => import("./eretail/masters/LocationEnquiry"));
const LocationEditor = lazy(() => import("./eretail/masters/LocationEditor"));
const StoreGroup = lazy(() => import("./eretail/masters/StoreGroup"));
const SkuImport = lazy(() => import("./eretail/masters/SkuImport"));
const SkuGroup = lazy(() => import("./eretail/masters/SkuGroup"));
const OtherMasters = lazy(() => import("./eretail/masters/OtherMasters"));
const RecordedSkuEnquiry = lazy(() => import("./eretail/masters/RecordedSkuWorkflows").then((loaded) => ({ default: loaded.RecordedSkuEnquiry })));
const PromotionManagement = lazy(() => import("./eretail/masters/PromotionManagement"));
const PricingEvents = lazy(() => import("./eretail/masters/PricingEvents"));
const PriceZoneMaster = lazy(() => import("./eretail/masters/PriceZone"));
const ExternalApps = lazy(() => import("./eretail/masters/ExternalApps"));
const OrderRefund = lazy(() => import("./eretail/masters/OrderRefund"));
const OmsRules = lazy(() => import("./eretail/sales/OmsRules"));
const OrderMaintenance = lazy(() => import("./eretail/sales/OrderMaintenance"));
const MarketOrderView = lazy(() => import("./eretail/sales/MarketOrderView"));
const KittingOrder = lazy(() => import("./eretail/sales/KittingOrder"));
const CodReconciliation = lazy(() => import("./eretail/sales/CodReconciliation"));
const SkuModeration = lazy(() => import("./eretail/sales/SkuModeration"));
const WmsZone = lazy(() => import("./eretail/wms/WmsZone"));
const PickerZonePreference = lazy(() => import("./eretail/wms/PickerZonePreference"));
const BinEnquiry = lazy(() => import("./eretail/wms/BinEnquiry"));
const BinEditor = lazy(() => import("./eretail/wms/BinEditor"));
const LottableValidation = lazy(() => import("./eretail/wms/LottableValidation"));
const ReceiptValidation = lazy(() => import("./eretail/wms/ReceiptValidation"));
const SkuLabelPrint = lazy(() => import("./eretail/wms/SkuLabelPrint"));
const PutawayRules = lazy(() => import("./eretail/wms/PutawayRules"));
const PutawayEnquiry = lazy(() => import("./eretail/wms/PutawayEnquiry"));
const DispatchCheckpoint = lazy(() => import("./eretail/wms/DispatchCheckpoint"));
const SkuGrading = lazy(() => import("./eretail/wms/SkuGrading"));
const DiscrepancyEnquiry = lazy(() => import("./eretail/wms/DiscrepancyEnquiry"));
const BulkUpload = lazy(() => import("./eretail/wms/BulkUpload"));
const MpInventoryLog = lazy(() => import("./eretail/wms/MpInventoryLog"));
const LpnEnquiry = lazy(() => import("./eretail/wms/LpnEnquiry"));
const Transhipment = lazy(() => import("./eretail/wms/Transhipment"));
const TranshipmentOld = lazy(() => import("./eretail/wms/TranshipmentOld"));
const QcParamsMapping = lazy(() => import("./eretail/wms/QcParamsMapping"));
const AllocationStrategies = lazy(() => import("./eretail/wms/AllocationStrategies"));
const CycleCountWave = lazy(() => import("./eretail/wms/CycleCountWave"));
const ManageAwb = lazy(() => import("./eretail/wms/ManageAwb"));
const TransporterPreference = lazy(() => import("./eretail/wms/TransporterPreference"));
const ServicePinCodes = lazy(() => import("./eretail/wms/ServicePinCodes"));
const TaxCategory = lazy(() => import("./eretail/masters/TaxCategory"));
const TaxGroup = lazy(() => import("./eretail/masters/TaxGroup"));
const TaxZone = lazy(() => import("./eretail/masters/TaxZone"));
const TallyConfiguration = lazy(() => import("./eretail/masters/TallyConfiguration"));
const AdminModule = lazy(() => import("./eretail/admin/AdminModule"));
const BackOrderPO = lazy(() => import("./eretail/procurement/ProcurementWorkflows").then((loaded) => ({ default: loaded.BackOrderPO })));
const OTBManagement = lazy(() => import("./eretail/procurement/ProcurementWorkflows").then((loaded) => ({ default: loaded.OTBManagement })));
const POEnquiry = lazy(() => import("./eretail/procurement/ProcurementWorkflows").then((loaded) => ({ default: loaded.POEnquiry })));
const PurchaseOrderEditor = lazy(() => import("./eretail/procurement/ProcurementWorkflows").then((loaded) => ({ default: loaded.PurchaseOrderEditor })));
const VendorInvoices = lazy(() => import("./eretail/procurement/ProcurementWorkflows").then((loaded) => ({ default: loaded.VendorInvoices })));
const ARSExecutionLog = lazy(() => import("./eretail/procurement/ARSWorkflows").then((loaded) => ({ default: loaded.ARSExecutionLog })));
const ARSRules = lazy(() => import("./eretail/procurement/ARSWorkflows").then((loaded) => ({ default: loaded.ARSRules })));
const ARSSettings = lazy(() => import("./eretail/procurement/ARSWorkflows").then((loaded) => ({ default: loaded.ARSSettings })));
const ARSSkuLocation = lazy(() => import("./eretail/procurement/ARSWorkflows").then((loaded) => ({ default: loaded.ARSSkuLocation })));

// Fulfillment modules
const OrderProcessing = lazy(() => import("./eretail/modules/OrderProcessing"));
const Allocate = lazy(() => import("./eretail/modules/Allocate"));
const DeliveryShipping = lazy(() => import("./eretail/modules/DeliveryShipping"));
const BulkUpdate = lazy(() => import("./eretail/modules/BulkUpdate"));
const ManagePicklist = lazy(() => import("./eretail/modules/ManagePicklist"));
const ManagePicking = lazy(() => import("./eretail/modules/ManagePicking"));
const DeliverySplit = lazy(() => import("./eretail/modules/DeliverySplit"));
const ShipmentReceiving = lazy(() => import("./eretail/modules/ShipmentReceiving"));
const ShipmentHandover = lazy(() => import("./eretail/modules/ShipmentHandover"));
const OrderAcknowledgement = lazy(() => import("./eretail/modules/OrderAcknowledgement"));
const ConsolidateEwb = lazy(() => import("./eretail/modules/ConsolidateEwb"));
const InboundGatePass = lazy(() => import("./eretail/modules/InboundGatePass"));
const InboundEnquiry = lazy(() => import("./eretail/modules/InboundEnquiry"));
const InboundCreateEdit = lazy(() => import("./eretail/modules/InboundCreateEdit"));
const InboundRealtime = lazy(() => import("./eretail/modules/InboundRealtime"));
const InboundQC = lazy(() => import("./eretail/modules/InboundQC"));
const InventoryMoveHistory = lazy(() => import("./eretail/modules/InventoryMoveHistory"));
const InventoryMove = lazy(() => import("./eretail/modules/InventoryMove"));
const InventoryMoveScan = lazy(() => import("./eretail/modules/InventoryMoveScan"));
const CycleCount = lazy(() => import("./eretail/modules/CycleCount"));
const BinAudit = lazy(() => import("./eretail/modules/BinAudit"));
const BulkLottables = lazy(() => import("./eretail/modules/BulkLottables"));
const SortToBox = lazy(() => import("./eretail/modules/SortToBox"));
const AJIOWorkflow = lazy(() => import("./eretail/modules/AJIOWorkflow"));
const AmazonMFNWorkflow = lazy(() => import("./eretail/modules/AmazonMFNWorkflow"));
const VinLister = lazy(() => import("./eretail/VinLister"));
const Profile = lazy(() => import("./eretail/Profile"));
const SellerPanelDashboard = lazy(() => import("./eretail/SellerPanelDashboard"));
const CentralInventory = lazy(() => import("./pages/CentralInventory"));
const LiveOrderWorkspace = lazy(() => import("./pages/LiveOrderWorkspace"));
const DemoOrderViews = lazy(() => import('./pages/DemoOrderViews'));
import { LiveConnection } from "./hooks/useInventoryLiveUpdates";

function P({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

function RouteLoading() {
  return <div className="p-4 text-sm text-slate-500" role="status" aria-live="polite">Loading screen…</div>;
}

function RouteSet({ location }: { location?: string }) {
  return (
    <Suspense fallback={<RouteLoading />}>
          <Routes location={location}>
            <Route path="/" element={<Login />} />

            {/* eRetail shell — dashboard landing */}
            <Route
              path="/app/dashboard"
              element={
                <P>
                  <EDashboard />
                </P>
              }
            />
            <Route path="/app/profile" element={<P><Profile /></P>} />
            <Route path="/app/seller-panel-dashboard" element={<P><SellerPanelDashboard /></P>} />
            <Route path="/app/central-inventory" element={<P><Shell active="wms" breadcrumb="WMS > Central Inventory" openScreens={[{label:'Central Inventory',to:'#'}]}><CentralInventory /></Shell></P>} />
            <Route
              path="/app/control-tower"
              element={
                <P>
                  <ControlTower />
                </P>
              }
            />
            <Route
              path="/app/vin-lister"
              element={
                <P>
                  <VinLister />
                </P>
              }
            />
            <Route
              path="/app/fulfillment"
              element={<Navigate to="/app/dashboard" replace />}
            />

            {/* Generic master screens — every remaining menu item */}
            {[
              "inv-move",
              "inv-move-scan",
              "inv-move-history",
              "intercompany-move",
              "bulk-lottables",
              "stock-adjustment",
              "outbound-gate-pass",
              "outbound-memo",
              "sku-transaction-history",
              "sku-lot-transfer",
            ].map((key) => (
              <Route
                key={key}
                path={`/app/m/${key}`}
                element={
                  <P>
                    <InventoryOperations operation={key} />
                  </P>
                }
              />
            ))}
            <Route path="/app/r/inbound-gate-pass" element={<P><InboundGatePass /></P>} />
            <Route path="/app/r/inbound-enquiry" element={<P><InboundEnquiry /></P>} />
            <Route path="/app/r/inbound-create-edit" element={<P><InboundCreateEdit /></P>} />
            <Route path="/app/r/inbound-realtime" element={<P><InboundRealtime /></P>} />
            <Route path="/app/r/inbound-qc" element={<P><InboundQC /></P>} />
            <Route path="/app/r/inv-move-history" element={<P><InventoryMoveHistory /></P>} />
            <Route path="/app/r/inv-move" element={<P><InventoryMove /></P>} />
            <Route path="/app/r/inv-move-scan" element={<P><InventoryMoveScan /></P>} />
            <Route path="/app/r/cycle-count" element={<P><CycleCount /></P>} />
            <Route path="/app/r/bin-audit" element={<P><BinAudit /></P>} />
            <Route path="/app/r/bulk-lottables" element={<P><BulkLottables /></P>} />
            <Route path="/app/r/putaway-enquiry" element={<P><PutawayEnquiry /></P>} />
            <Route path="/app/r/dispatch-checkpoint" element={<P><DispatchCheckpoint /></P>} />
            <Route path="/app/r/sku-grading" element={<P><SkuGrading /></P>} />
            <Route path="/app/r/discrepancy-enquiry" element={<P><DiscrepancyEnquiry /></P>} />
            <Route path="/app/r/bulk-upload" element={<P><BulkUpload /></P>} />
            <Route path="/app/r/mr-inventory-log" element={<P><MpInventoryLog /></P>} />
            <Route path="/app/r/lpn-enquiry" element={<P><LpnEnquiry /></P>} />
            <Route path="/app/r/transhipment" element={<P><Transhipment /></P>} />
            <Route path="/app/r/transhipment-old" element={<P><TranshipmentOld /></P>} />
            <Route path="/app/r/qc-params-mapping" element={<P><QcParamsMapping /></P>} />
            <Route
              path="/app/r/:key"
              element={
                <P>
                  <ReportRoute />
                </P>
              }
            />

            {/* Fulfillment sub-modules */}
            <Route
              path="/app/fulfillment/order-processing"
              element={
                <P>
                  <OrderProcessing />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/allocate"
              element={
                <P>
                  <Allocate />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/delivery-shipping"
              element={
                <P>
                  <DeliveryShipping />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/bulk-update"
              element={
                <P>
                  <BulkUpdate />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/manage-picklist"
              element={
                <P>
                  <ManagePicklist />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/manage-picking"
              element={
                <P>
                  <ManagePicking />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/delivery-split"
              element={
                <P>
                  <DeliverySplit />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/shipment-handover"
              element={
                <P>
                  <ShipmentHandover />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/shipment-receiving"
              element={
                <P>
                  <ShipmentReceiving />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/order-acknowledgement"
              element={
                <P>
                  <OrderAcknowledgement />
                </P>
              }
            />
            <Route path="/app/fulfillment/consolidate-ewb" element={<P><ConsolidateEwb /></P>} />
            <Route
              path="/app/fulfillment/sort-to-box"
              element={
                <P>
                  <SortToBox />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/ajio"
              element={
                <P>
                  <AJIOWorkflow />
                </P>
              }
            />
            <Route
              path="/app/fulfillment/amazon-mfn"
              element={
                <P>
                  <AmazonMFNWorkflow />
                </P>
              }
            />

            {/* Management pages — now inside the eRetail Shell for a unified theme */}
            <Route
              path="/app"
              element={<Navigate to="/app/dashboard" replace />}
            />
            <Route
              path="/app/sale-orders"
              element={
                <P>
                  <Shell
                    active="sales"
                    breadcrumb="SALES > Order Enquiry"
                    openScreens={[{ label: "Order Enquiry", to: "#" }]}
                  >
                    <LiveOrderWorkspace title="Sale Orders" />
                  </Shell>
                </P>
              }
            />
            <Route
              path="/app/purchase-orders"
              element={
                <P>
                  <Shell
                    active="procurement"
                    breadcrumb="PROCUREMENT > PO Revision"
                    openScreens={[{ label: "PO Revision", to: "#" }]}
                  >
                    <PurchaseOrders />
                  </Shell>
                </P>
              }
            />
            <Route
              path="/app/grn"
              element={
                <P>
                  <Shell
                    active="wms"
                    breadcrumb="WMS > Inbound Create/Edit"
                    openScreens={[{ label: "Inbound Create/Edit", to: "#" }]}
                  >
                    <GRN />
                  </Shell>
                </P>
              }
            />
            <Route
              path="/app/inventory"
              element={
                <P>
                  {/* Inventory owns the shared Shell; wrapping it here rendered
                      a second header/sidebar above the persistent route frame. */}
                  <Inventory />
                </P>
              }
            />
            <Route
              path="/app/m/price-zone"
              element={
                <P>
                  <PriceZoneMaster />
                </P>
              }
            />
            <Route path="/app/m/external-apps" element={<P><ExternalApps /></P>} />
            <Route
              path="/app/m/vendor-promotions"
              element={
                <P>
                  <VendorPromotions />
                </P>
              }
            />
            <Route path="/app/m/purchase-charge" element={<P><PurchaseChargeMasters /></P>} />
            <Route
              path="/app/m/location"
              element={<P><LocationEnquiry /></P>}
            />
            <Route path="/app/m/location-create" element={<P><LocationEditor /></P>} />
            <Route path="/app/m/store-group" element={<P><StoreGroup /></P>} />
            <Route path="/app/m/sku-group" element={<P><SkuGroup /></P>} />
            <Route path="/app/m/order-refund" element={<P><OrderRefund /></P>} />
            <Route path="/app/m/return-otc" element={<P><ReturnOtc /></P>} />
            <Route path="/app/m/return-otc-new" element={<P><ReturnOtc modern /></P>} />
            <Route path="/app/returns/global-search" element={<P><GlobalReturnsSearch /></P>} />
            <Route path="/app/m/return-wo-order" element={<P><ReturnWithoutOrder /></P>} />
            <Route path="/app/m/oms-rules" element={<P><OmsRules /></P>} />
            <Route path="/app/master-order-enquiry" element={<P><Shell active="sales" breadcrumb="SALES > Master Order Enquiry" openScreens={[{label:'Master Order Enquiry',to:'#'}]}><LiveOrderWorkspace title="Master Order Enquiry" /></Shell></P>} />
            <Route path="/app/order-enquiry" element={<P><Shell active="sales" breadcrumb="SALES > Order Enquiry" openScreens={[{label:'Order Enquiry',to:'#'}]}><LiveOrderWorkspace title="Order Enquiry" /></Shell></P>} />
            <Route path="/app/order-maintenance" element={<P><OrderMaintenance /></P>} />
            <Route path="/app/market-order-view" element={<P><MarketOrderView /></P>} />
            <Route path="/app/m/kitting-order" element={<P><KittingOrder /></P>} />
            <Route path="/app/global-order-search" element={<P><Shell active="sales" breadcrumb="SALES > Global Order Search" openScreens={[{label:'Global Order Search',to:'#'}]}><LiveOrderWorkspace title="Global Order Search" /></Shell></P>} />
            <Route path="/app/demo/orders" element={<P><Suspense fallback={<p>Loading demo workspace…</p>}><DemoOrderViews /></Suspense></P>} />
            <Route path="/app/cod-reconciliation" element={<P><CodReconciliation /></P>} />
            <Route path="/app/sku-moderation" element={<P><SkuModeration /></P>} />
            <Route path="/app/wms/zone" element={<P><WmsZone /></P>} />
            <Route path="/app/wms/picker-zone-preference" element={<P><PickerZonePreference /></P>} />
            <Route path="/app/wms/bin-enquiry" element={<P><BinEnquiry /></P>} />
            <Route path="/app/wms/bin-editor" element={<P><BinEditor /></P>} />
            <Route path="/app/wms/lottable-validation" element={<P><LottableValidation /></P>} />
            <Route path="/app/wms/receipt-validation" element={<P><ReceiptValidation /></P>} />
            <Route path="/app/wms/sku-label-print" element={<P><SkuLabelPrint /></P>} />
            <Route path="/app/wms/putaway-rules" element={<P><PutawayRules /></P>} />
            <Route path="/app/wms/allocation-strategies" element={<P><AllocationStrategies /></P>} />
            <Route path="/app/wms/cycle-count-waves" element={<P><CycleCountWave /></P>} />
            <Route path="/app/wms/manage-awb" element={<P><ManageAwb /></P>} />
            <Route path="/app/wms/transporter-preference" element={<P><TransporterPreference /></P>} />
            <Route path="/app/wms/service-pin-codes" element={<P><ServicePinCodes /></P>} />
            <Route
              path="/app/transfers"
              element={
                <P>
                  <Shell
                    active="returns"
                    breadcrumb="RETURNS & TRANSFERS > STO Order Enquiry"
                    openScreens={[{ label: "STO Order Enquiry", to: "#" }]}
                  >
                    <Transfers />
                  </Shell>
                </P>
              }
            />
            <Route path="/app/transfers/create" element={<P><StoEditor /></P>} />
            <Route path="/app/transfers/edit" element={<P><StoEditor /></P>} />
            <Route
              path="/app/skus"
              element={
                <P>
                  <Shell
                    active="master"
                    breadcrumb="MASTER > SKU Master"
                    openScreens={[{ label: "SKU Master", to: "#" }]}
                  >
                    <Skus />
                  </Shell>
                </P>
              }
            />
            <Route
              path="/app/partners"
              element={
                <P>
                  <Shell
                    active="master"
                    breadcrumb="MASTER > Trading Partners"
                    openScreens={[{ label: "Trading Partners", to: "#" }]}
                  >
                    <Partners />
                  </Shell>
                </P>
              }
            />
            <Route
              path="/app/returns"
              element={
                <P>
                  <Navigate to="/app/returns/customer-enquiry" replace />
                </P>
              }
            />
            <Route
              path="/app/returns/rtv-enquiry"
              element={<P><RtvEnquiry /></P>}
            />
            <Route
              path="/app/returns/vendor-return"
              element={<P><VendorReturnEditor /></P>}
            />
            <Route
              path="/app/returns/customer-enquiry"
              element={<P><CustomerReturnEnquiry /></P>}
            />
            <Route
              path="/app/returns/customer-return"
              element={<P><CustomerReturnEditor /></P>}
            />
            <Route
              path="/app/returns/:screen"
              element={
                <P>
                  <Navigate to="/app/returns/customer-enquiry" replace />
                </P>
              }
            />
            <Route
              path="/app/reports"
              element={
                <P>
                  <Shell
                    active="reports"
                    breadcrumb="REPORTS > Reports & Analytics"
                    openScreens={[{ label: "Reports", to: "#" }]}
                  >
                    <Reports />
                  </Shell>
                </P>
              }
            />
            <Route
              path="/app/legacy-dashboard"
              element={
                <P>
                  <Shell
                    active="dashboard"
                    breadcrumb="DASHBOARD > Classic"
                    openScreens={[{ label: "Classic Dashboard", to: "#" }]}
                  >
                    <LiveOrderWorkspace title="Classic dashboard · live orders" dashboard />
                  </Shell>
                </P>
              }
            />
            <Route
              path="/app/downloads"
              element={
                <P>
                  <Downloads />
                </P>
              }
            />
            <Route
              path="/app/channels"
              element={
                <P>
                  <ManageChannels />
                </P>
              }
            />
            <Route path="/app/sku-channel-listing" element={<P><SkuChannelListing /></P>} />
            <Route
              path="/app/vendors"
              element={
                <P>
                  <VendorMaster />
                </P>
              }
            />
            <Route
              path="/app/customers"
              element={
                <P>
                  <CustomerMaster />
                </P>
              }
            />
            <Route
              path="/app/transporters"
              element={
                <P>
                  <TransporterMaster />
                </P>
              }
            />
            <Route
              path="/app/clients"
              element={
                <P>
                  <ClientMaster />
                </P>
              }
            />
            <Route
              path="/app/customer-groups"
              element={
                <P>
                  <CustomerGroupMaster />
                </P>
              }
            />
            <Route
              path="/app/tax-code"
              element={
                <P>
                  <TaxCode />
                </P>
              }
            />
            <Route
              path="/app/coupons"
              element={
                <P>
                  <ManageCoupons />
                </P>
              }
            />
            <Route
              path="/app/tax-application"
              element={
                <P>
                  <TaxApplication />
                </P>
              }
            />
            <Route
              path="/app/sku-barcode"
              element={
                <P>
                  <SkuBarcode />
                </P>
              }
            />
            <Route
              path="/app/sku-company-link"
              element={
                <P>
                  <SkuCompanyLink />
                </P>
              }
            />
            <Route
              path="/app/m/merch-hierarchy"
              element={
                <P>
                  <MerchandisingHierarchy />
                </P>
              }
            />
            <Route
              path="/app/m/manage-attribute"
              element={
                <P>
                  <ManageAttribute />
                </P>
              }
            />
            <Route
              path="/app/m/attribute-set"
              element={
                <P>
                  <AttributeSet />
                </P>
              }
            />
            <Route
              path="/app/m/vouchers"
              element={
                <P>
                  <GenerateVouchers />
                </P>
              }
            />
            <Route
              path="/app/m/vendor-sku-catalog"
              element={
                <P>
                  <VendorSkuCatalog />
                </P>
              }
            />
            <Route
              path="/app/m/vendor-sku-loc-catalog"
              element={
                <P>
                  <VendorSkuLocCatalog />
                </P>
              }
            />
            <Route
              path="/app/m/org-hierarchy"
              element={
                <P>
                  <OrganizationHierarchy />
                </P>
              }
            />
            <Route
              path="/app/m/other-masters"
              element={
                <P>
                  <OtherMasters />
                </P>
              }
            />
            <Route
              path="/app/sku-enquiry"
              element={
                <P>
                  <RecordedSkuEnquiry />
                </P>
              }
            />
            <Route
              path="/app/sku-import"
              element={
                <P>
                  <SkuImport />
                </P>
              }
            />
            <Route
              path="/app/promotions"
              element={
                <P>
                  <PromotionManagement />
                </P>
              }
            />
            <Route
              path="/app/pricing-events"
              element={
                <P>
                  <PricingEvents />
                </P>
              }
            />
            <Route
              path="/app/tax-categories"
              element={
                <P>
                  <TaxCategory />
                </P>
              }
            />
            <Route
              path="/app/tax-groups"
              element={
                <P>
                  <TaxGroup />
                </P>
              }
            />
            <Route
              path="/app/tax-zones"
              element={
                <P>
                  <TaxZone />
                </P>
              }
            />
            <Route
              path="/app/tally-configuration"
              element={
                <P>
                  <TallyConfiguration />
                </P>
              }
            />
            <Route
              path="/app/procurement/category-buyers"
              element={
                <P>
                  <CategoryBuyers />
                </P>
              }
            />
            <Route
              path="/app/procurement/po-enquiry"
              element={
                <P>
                  <POEnquiry />
                </P>
              }
            />
            <Route
              path="/app/procurement/po/single"
              element={
                <P>
                  <PurchaseOrderEditor mode="Single Location" />
                </P>
              }
            />
            <Route
              path="/app/procurement/po/multiple"
              element={
                <P>
                  <PurchaseOrderEditor mode="Multiple Location" />
                </P>
              }
            />
            <Route
              path="/app/procurement/po/back-orders"
              element={
                <P>
                  <BackOrderPO />
                </P>
              }
            />
            <Route
              path="/app/procurement/vendor-invoices"
              element={
                <P>
                  <VendorInvoices />
                </P>
              }
            />
            <Route
              path="/app/procurement/otb"
              element={
                <P>
                  <OTBManagement />
                </P>
              }
            />
            <Route
              path="/app/procurement/ars/sku-location"
              element={
                <P>
                  <ARSSkuLocation />
                </P>
              }
            />
            <Route
              path="/app/procurement/ars/rules"
              element={
                <P>
                  <ARSRules />
                </P>
              }
            />
            <Route
              path="/app/procurement/ars/logs"
              element={
                <P>
                  <ARSExecutionLog />
                </P>
              }
            />
            <Route
              path="/app/procurement/ars/settings"
              element={
                <P>
                  <ARSSettings />
                </P>
              }
            />
            <Route
              path="/app/admin/:screen"
              element={
                <P>
                  <AdminModule />
                </P>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
    </Suspense>
  );
}

function PersistentRouteHost() {
  const location = useLocation();
  const { screens, closingPaths, settleNavigation } = useScreens();
  const currentPath = `${location.pathname}${location.search}`;

  useEffect(() => {
    settleNavigation(currentPath);
  }, [currentPath, settleNavigation]);

  if (!location.pathname.startsWith('/app/')) return <RouteSet />;

  const registered = screens.map((screen) => ({ key: screen.label, path: screen.path }));
  const frames = registered.some((screen) => screen.path === currentPath) || closingPaths.includes(currentPath)
    ? registered
    : [...registered, { key: `pending:${currentPath}`, path: currentPath }];

  return <>{frames.map((screen) => (
    <div
      key={screen.key}
      data-screen-frame={screen.key}
      aria-hidden={screen.path !== currentPath}
      style={{ display: screen.path === currentPath ? 'contents' : 'none' }}
    >
      <ScreenFrameProvider frameKey={screen.key} path={screen.path}>
        <RouteSet location={screen.path} />
      </ScreenFrameProvider>
    </div>
  ))}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <DownloadProvider>
        <BrowserRouter>
          <ScreenProvider>
            <GlobalScreenOverlayHost />
            <LiveConnection><PersistentRouteHost /></LiveConnection>
          </ScreenProvider>
        </BrowserRouter>
      </DownloadProvider>
    </AuthProvider>
  );
}
