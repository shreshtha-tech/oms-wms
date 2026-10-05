import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.MONGODB_URI = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { find, insert } = await import('../api/mongo.js');
const managePicklists = (await import('../api/manage-picklists.js')).default;
const picklists = (await import('../api/picklists.js')).default;
const managePicking = (await import('../api/manage-picking.js')).default;
const sortToBox = (await import('../api/sort-to-box.js')).default;
const deliveryShipping = (await import('../api/delivery-shipping.js')).default;
const bulkOrderUpdate = (await import('../api/bulk-order-update.js')).default;
const shipmentHandover = (await import('../api/shipment-handover.js')).default;
const manageManifests = (await import('../api/manage-manifests.js')).default;
const deliverySplit = (await import('../api/delivery-split.js')).default;
const fulfillmentApi = (await import('../api/fulfillment.js')).default;
const orderAcknowledgement = (await import('../api/order-acknowledgement.js')).default;
const consolidateEwb = (await import('../api/consolidate-ewb.js')).default;
const shipments = (await import('../api/shipments.js')).default;
const dispatchCheckpoint = (await import('../api/dispatch-checkpoint.js')).default;
const orderAllocation = (await import('../api/order-allocation.js')).default;
const reports = (await import('../api/reports.js')).default;

async function invoke(handler, method, body = {}, query = {}) {
  const res = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    setHeader() {},
  };
  await handler({ method, body, query, headers: {} }, res);
  return res;
}

await insert('generic_records', { module: 'location', code: 'SAFE-WH', name: 'Safe Warehouse', status: 'Active' });
await insert('partners', { type: 'Transporter', code: 'SAFE-TR', name: 'Safe Carrier' });
const order = await insert('fulfillment_orders', {
  order_no: 'SAFE-FULFILLMENT-ORDER', delivery_no: 'SAFE-DELIVERY', awb: 'SAFE-AWB',
  sku_code: 'SAFE-FULFILLMENT-SKU', warehouse: 'SAFE-WH', qty: 3, status: 'Allocated',
  box_no: 'SAFE-FROM-LPN', picklist_no: 'SAFE-PICKLIST', picked_qty: 0, sorted_qty: 0,
  ewb_no: 'SAFE-EWB', invoice_no: 'SAFE-INVOICE', ack_status: 'Pending Acknowledgement',
});
const splitOrder = await insert('fulfillment_orders', {
  order_no: 'SAFE-SPLIT-ORDER', delivery_no: 'SAFE-SPLIT-DELIVERY',
  sku_code: 'SAFE-SPLIT-SKU', warehouse: 'SAFE-WH', qty: 5, amount: 500,
  status: 'Allocated',
});
const picklist = await insert('picklists', { picklist_no: 'SAFE-PICKLIST', status: 'Open', total_qty: 3, is_locked: true, picker: 'SAFE-PICKER' });
const shipment = await insert('shipments', { manifest_no: 'SAFE-MANIFEST', status: 'Pending Handover', order_ids: [order.id] });
const dispatchLoad = await insert('generic_records', {
  module: 'dispatch-checkpoint', code: 'UWH-SAFE', loadId: 'UWH905001', vehicleNo: 'SAFE-VEHICLE',
  status: 'In Process', statusCode: '5', shipments: [{ id: 1, scanTrackingNo: 'SAFE-TRACKING' }], invoices: [],
});
const manifestDraft = await invoke(manageManifests, 'POST', {
  action: 'draft-save',
  siteLocCode: 'SAFE-WH', transporter: 'SAFE-TR', deliveries: [order.delivery_no],
});
assert.equal(manifestDraft.statusCode, 201, 'manifest draft metadata can be saved');
assert.equal(manifestDraft.payload.row.status, 'Pending');
assert.equal(manifestDraft.payload.row.recordTrust, 'local-draft-metadata');
assert.equal((await invoke(manageManifests, 'GET')).payload.dataTrust, 'legacy-unverified');
assert.equal((await invoke(manageManifests, 'POST', { siteLocCode: 'SAFE-WH', transporter: 'SAFE-TR', deliveries: [order.delivery_no] })).statusCode, 501, 'unrecognized manifest POST must not create a draft');
const manifest = manifestDraft.payload.row;
const shipmentRows = await invoke(shipments, 'GET');
assert.equal(shipmentRows.payload.find(row => row.manifest_no === manifest.delManifestNo).trust, 'local-draft-metadata');
const manifestReport = await invoke(reports, 'GET', {}, { type: 'manifest-report' });
assert.equal(manifestReport.payload.rows.some(row => row[0] === manifest.delManifestNo), false, 'local manifest drafts must not appear as dispatched manifests in operations reports');

assert.equal((await invoke(managePicklists, 'GET')).payload.picklistGenerationAvailable, false);
assert.equal((await invoke(managePicking, 'GET')).payload.available, false);
assert.equal((await invoke(sortToBox, 'GET')).payload.available, false);
assert.equal((await invoke(deliveryShipping, 'GET')).payload.workflowActionsAvailable, false);
assert.equal((await invoke(bulkOrderUpdate, 'GET')).payload.available, false);
assert.equal((await invoke(shipmentHandover, 'GET')).payload.available, false);
assert.equal((await invoke(manageManifests, 'GET')).payload.providerDispatchAvailable, false);
assert.equal((await invoke(deliverySplit, 'GET')).payload.available, false);
assert.equal((await invoke(deliverySplit, 'GET')).payload.dataTrust, 'legacy-unverified');
assert.equal((await invoke(orderAcknowledgement, 'GET')).payload.available, false);
assert.equal((await invoke(consolidateEwb, 'GET')).payload.available, false);
assert.equal((await invoke(dispatchCheckpoint, 'GET')).payload.available, false);
assert.equal((await invoke(orderAllocation, 'GET')).payload.allocationAvailable, false);

const generated = await invoke(managePicklists, 'POST', { action: 'generate', ids: [order.id], siteLoc: 'SAFE-WH' });
assert.equal(generated.statusCode, 501);
const picklistSearch = await invoke(managePicklists, 'POST', { action: 'search', pickNO: picklist.picklist_no, rows: 20, page: 1 });
assert.equal(picklistSearch.payload.rows[0].recordTrust, 'legacy-unverified');
assert.equal((await invoke(managePicklists, 'PUT', { action: 'unlock', id: picklist.id })).statusCode, 501);
assert.equal((await invoke(managePicklists, 'PUT', { action: 'assign-picker', id: picklist.id, picker: 'OTHER' })).statusCode, 501);
assert.equal((await find('picklists', { id: picklist.id }))[0].is_locked, true);
assert.equal((await find('picklists', { id: picklist.id }))[0].picker, 'SAFE-PICKER');
assert.equal((await invoke(managePicklists, 'POST', { action: 'template-save', templateName: 'Safe Template', location: 'SAFE-WH' })).statusCode, 201, 'picklist configuration metadata remains saveable');
for (const [method, body] of [
  ['POST', { orderIds: [order.id] }], ['PUT', { id: picklist.id, status: 'Completed' }], ['DELETE', { id: picklist.id }],
]) assert.equal((await invoke(picklists, method, body)).statusCode, 501);

const loaded = await invoke(managePicking, 'POST', { action: 'load', picklistNo: picklist.picklist_no });
assert.equal(loaded.statusCode, 200);
assert.equal(loaded.payload.dto.picklistStatus, 'Open', 'read-only loading must preserve the recorded picklist status');
assert.equal((await find('picklists', { id: picklist.id }))[0].status, 'Open', 'loading a picklist must be read-only');
for (const action of ['scan', 'pick-all', 'short-pick', 'print', 'delivery-split', 'short-pack']) {
  assert.equal((await invoke(managePicking, 'POST', { action, picklistNo: picklist.picklist_no, scannedCode: order.sku_code, qty: 1 })).statusCode, 501);
}
assert.equal((await invoke(sortToBox, 'GET')).payload.available, false);
for (const action of ['validate', 'scan', 'close', 'short-pack']) {
  assert.equal((await invoke(sortToBox, 'POST', { action, fromIdCode: order.box_no, scannedSkuCode: order.sku_code, toIdCode: 'SAFE-TO-LPN', qty: 1 })).statusCode, 501);
}
const deliverySearch = await invoke(deliveryShipping, 'POST', { action: 'search', orderNo: order.order_no, rows: 20, page: 1 });
assert.equal(deliverySearch.payload.records, 1, 'delivery enquiry remains read-only');
for (const action of ['picklist', 'pack', 'manifest', 'refetch']) {
  assert.equal((await invoke(deliveryShipping, 'PUT', { action, ids: [order.id] })).statusCode, 501);
}
assert.equal((await invoke(bulkOrderUpdate, 'GET')).payload.available, false);
assert.equal((await invoke(bulkOrderUpdate, 'POST', { action: 'import', importType: '2', importRows: [{ 'Order No': order.order_no }] })).statusCode, 501);
assert.equal((await invoke(bulkOrderUpdate, 'POST', { action: 'results' })).payload.trust, 'legacy-unverified');
const shipmentSearch = await invoke(shipmentHandover, 'POST', { action: 'search', deliveryNo: order.delivery_no, rows: 50, page: 1 });
assert.equal(shipmentSearch.payload.records, 1, 'shipment handover enquiry remains read-only');
for (const action of ['receive', 'return', 'deliver']) {
  assert.equal((await invoke(shipmentHandover, 'POST', { action, id: order.id, deliveryNo: order.delivery_no, status: '201' })).statusCode, 501);
}
for (const action of ['confirm', 'manifested', 'rfs', 'cancel', 'reopen']) {
  assert.equal((await invoke(manageManifests, 'PUT', { action, id: manifest.id })).statusCode, 501);
}
const splitSearch = await invoke(deliverySplit, 'POST', { action: 'search', outDelNo: splitOrder.delivery_no, rows: 20, page: 1 });
assert.equal(splitSearch.statusCode, 200, 'delivery search remains read-only');
assert.equal(splitSearch.payload.rows[0].qty, 5);
for (const body of [
  { action: 'sku-lookup', outDelNo: splitOrder.delivery_no, skuCode: splitOrder.sku_code },
  { action: 'add-sku', outDelNo: splitOrder.delivery_no, skuCode: splitOrder.sku_code, uQty: 2 },
  { action: 'confirm', outDelNo: splitOrder.delivery_no, lines: [{ statusCode: '7', qty: 2 }] },
]) assert.equal((await invoke(deliverySplit, 'POST', body)).statusCode, 501);
assert.equal((await invoke(deliverySplit, 'POST', { action: 'audit', outDelNo: splitOrder.delivery_no })).payload.rows.length, 0);
const priority = await invoke(fulfillmentApi, 'PUT', { ids: [order.id], priority: 'High' });
assert.equal(priority.statusCode, 200, 'priority-only metadata can still be updated');
for (const body of [
  { ids: [order.id], status: 'Allocated' },
  { ids: [order.id], status: 'Pending', picklist_no: null },
  { ids: [order.id], qty: 99 },
  { ids: [order.id], action: 'generate-shipping-label', courier: 'SAFE-TR' },
  { ids: [order.id], action: 'allocate' },
]) assert.equal((await invoke(fulfillmentApi, 'PUT', body)).statusCode, 501);
assert.equal((await invoke(fulfillmentApi, 'POST', { order_no: 'SAFE-NEW-ORDER', qty: 1 })).statusCode, 501);
const ackSearch = await invoke(orderAcknowledgement, 'POST', { action: 'search', tab: 'pending', rows: 20, page: 1 });
assert.equal(ackSearch.statusCode, 200);
assert.equal(ackSearch.payload.rows.find(row => row.orderNo === order.order_no).trust, 'legacy-unverified');
for (const body of [
  { action: 'accept', ids: [order.id] },
  { action: 'reject', ids: [order.id], rejectionReason: 'Out of Stock', rejectionRemarks: 'Safe test' },
]) assert.equal((await invoke(orderAcknowledgement, 'POST', body)).statusCode, 501);
const cewbSearch = await invoke(consolidateEwb, 'POST', { action: 'search', tab: 'generate', rows: 20, page: 1 });
assert.equal(cewbSearch.statusCode, 200);
assert.equal(cewbSearch.payload.rows.find(row => row.ewbNo === 'SAFE-EWB').documentNo, 'SAFE-INVOICE');
for (const body of [
  { action: 'generate', ids: [order.id], transMode: '1', vehicleNo: 'SAFE-VEHICLE' },
  { action: 'regenerate', id: 1, transMode: '1', vehicleNo: 'SAFE-VEHICLE', reason: '4', remarks: 'Safe test' },
]) assert.equal((await invoke(consolidateEwb, 'POST', body)).statusCode, 501);
assert.equal((await invoke(shipments, 'POST', { courier: 'SAFE-TR', warehouse: 'SAFE-WH', orderIds: [order.id] })).statusCode, 501);
assert.equal((await invoke(shipments, 'PUT', { id: shipment.id, status: 'Handed Over' })).statusCode, 501);
const dispatchSearch = await invoke(dispatchCheckpoint, 'POST', { REQ_SEARCH_FLAG: true, loadId: dispatchLoad.loadId, rows: 20, page: 1 });
assert.equal(dispatchSearch.statusCode, 200);
assert.equal(dispatchSearch.payload.gridModel[0].trust, 'legacy-unverified');
assert.equal((await invoke(dispatchCheckpoint, 'GET', {}, { loadId: dispatchLoad.loadId })).payload.row.loadId, dispatchLoad.loadId);
for (const action of ['export', 'vehicle-scan', 'tracking-scan', 'remove-shipment', 'invoice-scan', 'lpn-scan', 'close-invoice', 'approve', 'complete']) {
  assert.equal((await invoke(dispatchCheckpoint, 'POST', { action, loadId: dispatchLoad.loadId, gridDataLen: 1 })).statusCode, 501);
}
const allocationSearch = await invoke(orderAllocation, 'POST', { REQ_SEARCH_FLAG: true, rows: 50, page: 1, fromOrderNo: order.order_no });
assert.equal(allocationSearch.statusCode, 200);
assert.equal(allocationSearch.payload.gridModel[0].trust, 'legacy-unverified');
for (const action of ['allocate', 'unAllocate', 'close']) {
  assert.equal((await invoke(orderAllocation, 'PUT', { action, ids: [order.id], reason: '10', remarks: 'Safe test' })).statusCode, 501);
}

const unchanged = (await find('fulfillment_orders', { id: order.id }))[0];
assert.equal(unchanged.status, 'Allocated');
assert.equal(unchanged.picked_qty, 0);
assert.equal(unchanged.sorted_qty, 0);
assert.equal(unchanged.handover_status, undefined);
assert.equal(unchanged.qty, 3);
assert.equal(unchanged.priority, 'High');
assert.equal(unchanged.awb, order.awb, 'blocked label generation cannot replace the recorded AWB');
assert.equal(unchanged.ack_status, 'Pending Acknowledgement', 'blocked provider acknowledgement does not change the order');
assert.equal(unchanged.consolidate_ewb_no, undefined, 'blocked CEWB action does not create a document number');
assert.equal(unchanged.status, 'Allocated', 'blocked allocation close must not cancel the order');
assert.equal(unchanged.open_qty, undefined, 'blocked allocation close must not consume the open quantity');
assert.equal((await find('picklists', { id: picklist.id }))[0].status, 'Open');
assert.equal((await find('shipments', { id: manifest.id }))[0].status, 'Pending');
assert.equal((await find('shipments', { id: shipment.id }))[0].status, 'Pending Handover');
assert.equal((await find('shipments')).length, 2, 'blocked shipment actions do not create a manifest');
assert.equal((await find('generic_records', { module: 'order-acknowledgement-audit' })).length, 0);
assert.equal((await find('generic_records', { module: 'consolidate-ewb' })).length, 0);
assert.deepEqual(await find('generic_records', { module: 'dispatch-checkpoint' }), [dispatchLoad]);
assert.equal((await find('generic_records', { module: 'pending-report' })).length, 0, 'blocked dispatch export must not create a fake report job');
assert.equal((await find('fulfillment_audit')).length, 0, 'blocked order cancellation must not fabricate an audit record');
assert.equal((await find('delivery_shipping_audit')).length, 0, 'blocked local label generation does not create a fake carrier audit');
assert.equal((await find('fulfillment_orders', { id: splitOrder.id }))[0].qty, 5, 'blocked split does not decrement the source order');
assert.equal((await find('fulfillment_orders', { order_no: 'SAFE-SPLIT-ORDER-S' })).length, 0, 'blocked split does not create a replacement order');
assert.equal((await find('generic_records', { module: 'delivery-split-audit' })).length, 0, 'blocked split does not fabricate an audit event');
for (const module of ['manage-picking-history', 'sort-to-box-audit', 'sort-to-box-lpn', 'shipment-handover-audit', 'bulk-order-update-result']) {
  assert.equal((await find('generic_records', { module })).length, 0, `${module} must not contain fabricated workflow records`);
}
const uiChecks = [
  { path: '../src/eretail/modules/ManagePicklist.tsx', notice: 'Unlocking and picker assignment are unavailable', absent: "label:'Generate Picklist'" },
  { path: '../src/eretail/modules/ManagePicking.tsx', notice: 'Physical pick, short pick, pack', present: 'disabled title=\"Picking workflow is not connected\"' },
  { path: '../src/eretail/modules/SortToBox.tsx', notice: 'LPN lookup, sort scans', present: '<Btn variant=\"ghost\" disabled>Short Pack</Btn>' },
  { path: '../src/eretail/modules/DeliveryShipping.tsx', notice: 'verified carrier/provider connector', absent: "label: 'Pack Order'" },
  { path: '../src/eretail/modules/BulkUpdate.tsx', notice: 'Previously stored result rows are legacy and unverified', present: '<Btn onClick={()=>void run()} disabled>' },
  { path: '../src/eretail/modules/ShipmentReceiving.tsx', notice: 'verified carrier events and Central Inventory receipt/dispatch', present: 'disabled title=\"Verified carrier delivery and Central Inventory receipt are not connected\">Mark Received' },
  { path: '../src/eretail/modules/ShipmentHandover.tsx', notice: 'Saving a manifest draft records local metadata only', present: 'disabled title=\"Central Inventory custody is not connected\">Confirm Manifest' },
];
uiChecks.push({ path: '../src/eretail/modules/DeliverySplit.tsx', notice: 'Delivery splitting is unavailable until Central Inventory supports an atomic order-line split and fulfillment reservation.', absent: 'Confirm Splitting' });
uiChecks.push({ path: '../src/eretail/modules/DeliverySplit.tsx', notice: 'Legacy split audit rows are unverified and do not prove a Central Inventory transaction or physical stock movement.' });
uiChecks.push({ path: '../src/eretail/modules/OrderProcessing.tsx', notice: 'These rows are legacy fulfillment records. Allocation and reset are disabled until Central Inventory reservation transactions are connected;', present: 'disabled title="Central Inventory reservations are not connected"' });
uiChecks.push({ path: '../src/eretail/ControlTower.tsx', notice: 'Metrics are calculated from legacy fulfillment records and do not prove Central Inventory reservations or carrier events.', present: 'disabled title="Central Inventory reservations are not connected"' });
uiChecks.push({ path: '../src/eretail/modules/OrderAcknowledgement.tsx', notice: 'Provider acknowledgement is unavailable until an authenticated channel connector can submit and verify responses.', absent: "action: 'accept'" });
uiChecks.push({ path: '../src/eretail/modules/ConsolidateEwb.tsx', notice: 'CEWB generation and regeneration are unavailable until a verified government e-way bill connector can create and read back the document.', absent: "action: 'generate'" });
uiChecks.push({ path: '../src/eretail/wms/DispatchCheckpoint.tsx', notice: 'Dispatch Checkpoint is read-only.', absent: 'Complete Loading' });
uiChecks.push({ path: '../src/eretail/modules/Allocate.tsx', notice: 'This screen reads legacy fulfillment rows only. Allocate, UnAllocate, and Close SO are disabled until Central Inventory can reserve and release order lines.', absent: "label: 'Close SO'" });
uiChecks.push({ path: '../src/eretail/modules/ManagePicklist.tsx', absent: "apiSend('/api/manage-picklists','PUT'" });
uiChecks.push({ path: '../src/eretail/modules/ManagePicklist.tsx', absent: "label:'Print Picklist'" });
uiChecks.push({ path: '../src/eretail/modules/ShipmentHandover.tsx', present: "action: 'draft-save'" });
uiChecks.push({ path: '../src/eretail/modules/ShipmentHandover.tsx', present: "['recordTrust', 'Record Trust']" });
for (const check of uiChecks) {
  const source = await readFile(new URL(check.path, import.meta.url), 'utf8');
  if (check.notice) assert.ok(source.includes(check.notice), `${check.path} must explain the unsupported workflow boundary`);
  if (check.present) assert.ok(source.includes(check.present), `${check.path} must visibly disable the unsupported action`);
  if (check.absent) assert.ok(!source.includes(check.absent), `${check.path} must not advertise a blocked success action`);
}
console.log('PASS legacy fulfillment safety: allocation/unallocation/cancellation, labels, provider acknowledgement, CEWB, dispatch checkpoint, shipment lifecycle, manifest dispatch transitions, pick, pack, sort, delivery split, and bulk status updates fail closed; local draft metadata stays labeled; priority-only metadata remains editable; screens disclose unavailable actions.');
