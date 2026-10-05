import { sendDatabaseUnavailable, cors, find } from './mongo.js';

const text = value => String(value ?? '').trim();
const delivery = row => text(row.delivery_no || row.ob_del_no || row.order_no);
const eligible = row => Boolean(text(row.awb || row.tracking_no)) || ['Ready to Ship', 'Manifested', 'Handed Over', 'Shipped', 'Delivered', 'Returned'].includes(row.status);

function normalize(row) {
  return {
    id: row.id,
    clientId: row.client_id || '',
    orderNo: row.order_no || '',
    externOrderNo: row.ext_order_no || row.order_no || '',
    orderDate: row.order_date || '',
    deliveryNo: delivery(row),
    delDate: row.ship_date || row.order_date || '',
    trackingNo: row.awb || row.tracking_no || '',
    custName: row.customer || row.customer_name || '',
    custDetail: [row.customer || row.customer_name, row.city].filter(Boolean).join(' - '),
    status: row.handover_status || '',
    receivedBy: row.received_by || '', receivedDate: row.received_date || '',
    deliveredBy: row.delivered_by || '', deliveredDate: row.delivered_date || '',
    returnedBy: row.returned_by || '', returnedDate: row.returned_date || '',
    expiredDate: row.expired_date || '', remarks: row.handover_remarks || '',
    statusCode: row.handover_status_code || '',
    createdBy: row.created_by || '', createDate: row.created_date || row.order_date || '',
    modifiedBy: row.modified_by || '', modifiedDate: row.modified_date || '',
    customerSign: row.customer_sign || '', trust: 'legacy-unverified',
  };
}

function page(rows, body) {
  const size = [50, 100, 200].includes(+body.rows) ? +body.rows : 50;
  const current = Math.max(1, +body.page || 1);
  const records = rows.length;
  const slice = rows.slice((current - 1) * size, current * size);
  return { gridModel: slice, rowDTOListFromUpdate: slice, rows: slice, page: current, total: Math.ceil(records / size), records, trust: 'legacy-unverified' };
}

const match = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    const rows = (await find('fulfillment_orders')).filter(eligible).map(normalize);
    if (req.method === 'GET') {
      const counts = {
        pending: rows.filter(row => row.statusCode === '16').length,
        qcFailed: rows.filter(row => ['205', '210'].includes(row.statusCode)).length,
        received: rows.filter(row => row.statusCode === '201').length,
        all: rows.length,
      };
      return res.json({
        available: false, dataTrust: 'legacy-unverified', counts,
        qcStatuses: [['201', 'QC Passed'], ['205', 'QC Failed']],
        statuses: [['16', 'Pending To Receive'], ['201', 'Received With QC Pass'], ['205', 'Received With QC Fail'], ['210', 'Expired'], ['215', 'Delivered'], ['220', 'Returned']],
        pageSizes: [50, 100, 200],
        notice: 'Receipt, return, and delivery statuses require verified carrier events and Central Inventory transactions.',
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (body.action === 'search' || body.REQ_SEARCH_FLAG) {
      let result = rows.filter(row => match(row.orderNo, body.orderNo) && match(row.deliveryNo, body.deliveryNo) &&
        match(row.trackingNo, body.trackingNo) && (!text(body.fromOrderDate) || row.orderDate >= body.fromOrderDate) &&
        (!text(body.toOrderDate) || row.orderDate <= body.toOrderDate) &&
        (!text(body.fromDelDate) || row.delDate >= body.fromDelDate) && (!text(body.toDelDate) || row.delDate <= body.toDelDate));
      const status = text(body.status);
      if (status && status !== '-1') result = result.filter(row => status.split(',').includes(row.statusCode));
      result.sort((left, right) => text(left.orderDate).localeCompare(text(right.orderDate)) * (text(body.sord) === 'asc' ? 1 : -1));
      return res.json(page(result, body));
    }

    if (body.action === 'audit') {
      const auditRows = await find('generic_records', { module: 'shipment-handover-audit' });
      return res.json({ rows: auditRows.filter(row => !text(body.deliveryNo) || row.delivery_no === body.deliveryNo).map(row => ({ ...row, trust: 'legacy-unverified' })), trust: 'legacy-unverified' });
    }
    return res.status(501).json({ error: 'Shipment receipt, delivery, and return actions require verified carrier events and Central Inventory transactions.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Shipment Handover error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
