import { sendDatabaseUnavailable, cors, find } from './mongo.js';
import { channelNames, clientPairs, locationPairs, transporterPairs } from './catalogs.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const days = (start, end) => Math.abs(new Date(end) - new Date(start)) / 86400000;

function normalize(row) {
  return {
    id: row.id,
    clientId: row.client_id ?? '', deliveryInfo: row.delivery_no || row.ob_del_no || '',
    orderNo: row.order_no || '', extOrderNo: row.ext_order_no || row.external_order_no || '',
    obDelNo: row.delivery_no || row.ob_del_no || '', deliveryQTY: row.qty ?? '',
    siteLoc: row.site_location || row.warehouse || '', channelType: row.channel_type || row.channel_name || '',
    orderTypeText: row.order_type || '', paymentMode: row.payment_mode || '', picklistFor: row.picklist_for || '',
    pickPackFlag: row.pick_pack_flag || '', orderStatusText: row.order_status || row.status || '',
    status: row.status || '', transporter: row.courier || '', extTransporterName: row.ext_transporter_name || '',
    reassigned: row.reassigned === true ? 'Yes' : row.reassigned === false ? 'No' : '',
    oldAwbNo: row.old_awb_no || '', awpNo: row.awb || '', pigeonHoleId: row.pigeon_hole_id || '',
    lpnNo: row.lpn_no || '', weight: row.weight ?? '', length: row.length ?? '', breadth: row.breadth ?? '',
    height: row.height ?? '', boxes: row.boxes ?? '', manifestNo: row.manifest_no || '', shipDate: row.ship_date || '',
    invoiceNo: row.invoice_no || '', picklistNo: row.picklist_no || '', packDate: row.pack_date || '',
    orderDate: row.order_date || '', pickDate: row.pick_date || '', pickupSlot: row.pickup_slot || '',
    reqShipDates: row.ship_by_date || '', slaStatus: row.sla_status || '', orderTagVal: row.order_tag || '',
    deliveryDate: row.delivery_date || '', orderSWLoc: row.fulfillment_location || row.warehouse || '',
    custName: row.customer_name || row.customer || '', transporterInfo: row.transporter_info || '',
    vehicleNo: row.vehicle_no || '', extManifestNo: row.ext_manifest_no || '',
    shipErrorRemarks: row.logs || '', sortationDate: row.sortation_date || '',
    fullFilledBy: row.fulfilled_by || '', trust: 'legacy-unverified',
  };
}

function page(rows, body) {
  const allowed = [5, 10, 15, 20, 30, 40, 50, 100, 200, 500];
  const size = allowed.includes(Number(body.rows)) ? Number(body.rows) : 50;
  const current = Math.max(1, Number(body.page) || 1);
  const records = rows.length;
  const slice = rows.slice((current - 1) * size, current * size);
  return { gridModel: slice, rows: slice, page: current, total: Math.ceil(records / size), records, trust: 'legacy-unverified' };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const [locations, clients, channels, transporters] = await Promise.all([
        locationPairs(), clientPairs(), channelNames(), transporterPairs(),
      ]);
      return res.json({
        locations, clients, channels, transporters,
        statuses: ['Delivered', 'Intransit', 'LostInTransit', 'Open', 'Out Of Delivery', 'Pack in process', 'Packed', 'Partially Packed', 'Partially Picked', 'Picked', 'RTO Delivered'],
        orderTypes: ['B2BGC-COD', 'B2BGC-Prepaid', 'B2CGC-COD', 'B2CGC-Prepaid', 'COD', 'Prepaid', 'Normal'],
        workflowActionsAvailable: false,
        dataTrust: 'legacy-unverified',
        notice: 'Picklist, pack, manifest request, and refetch require Central Inventory fulfillment and a verified carrier/provider connector.',
      });
    }
    if (req.method !== 'POST') {
      if (req.method === 'PUT' || req.method === 'DELETE') {
        return res.status(501).json({ error: 'Picklist, pack, manifest, and refetch actions are paused until Central Inventory fulfillment and a real carrier/provider connector are connected.' });
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = req.body || {};
    if (body.REQ_SEARCH_FLAG || body.action === 'search') {
      const identifiers = [body.outBoundDeliveryNo, body.externOrderNo, body.manifestNo, body.orderNo, body.trackingNo, body.orderListExportFull].some(value => text(value));
      if (!identifiers && !text(body.fromOrderDate) && !text(body.fromShipDate)) {
        return res.status(400).json({ error: 'Enter an order date or ship date, or search by order, delivery, tracking, or manifest number.' });
      }
      if ((body.fromOrderDate && body.toOrderDate && days(body.fromOrderDate, body.toOrderDate) > 90) ||
        (body.fromShipDate && body.toShipDate && days(body.fromShipDate, body.toShipDate) > 90)) {
        return res.status(400).json({ error: 'Date range cannot be greater than 90 days.' });
      }

      const all = (await find('fulfillment_orders')).map(normalize);
      const orderList = text(body.orderListExportFull).split(/[\n,]/).map(text).filter(Boolean);
      const filtered = all.filter(row =>
        has(row.orderNo, body.orderNo) && has(row.extOrderNo, body.externOrderNo) &&
        has(row.status, body.status) && has(row.deliveryInfo, body.outBoundDeliveryNo) &&
        has(row.awpNo, body.trackingNo) && has(row.siteLoc, body.orderSiteLoc) &&
        has(row.orderSWLoc, body.siteLocation) && has(row.custName, body.customerCode) &&
        has(row.clientId, body.clientId) && has(row.channelType, body.channelType) &&
        has(row.orderTypeText, body.orderTypeCode) && has(row.manifestNo, body.manifestNo) &&
        has(row.transporter, body.orderTransporter) && has(row.picklistNo, body.pickListNo) &&
        has(row.orderStatusText, body.orderStatus) && has(row.pigeonHoleId, body.pigeonHoleId) &&
        has(row.lpnNo, body.lpnNo) && has(row.fullFilledBy, body.fullFilledBy) &&
        (!text(body.fromOrderDate) || row.orderDate >= body.fromOrderDate) &&
        (!text(body.toOrderDate) || row.orderDate <= body.toOrderDate) &&
        (!text(body.fromShipDate) || row.shipDate >= body.fromShipDate) &&
        (!text(body.toShipDate) || row.shipDate <= body.toShipDate) &&
        (!orderList.length || orderList.includes(row.orderNo) || orderList.includes(row.extOrderNo)));
      filtered.sort((left, right) => text(left.orderDate).localeCompare(text(right.orderDate)));
      return res.json(page(filtered, body));
    }

    return res.status(501).json({ error: 'Delivery Shipping actions are paused until Central Inventory fulfillment and a verified carrier/provider connector are connected.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Delivery Shipping error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
