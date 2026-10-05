import { sendDatabaseUnavailable, cors, find } from './mongo.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const normalize = row => ({
  id: row.id,
  extOrderNo: row.ext_order_no || row.order_no,
  hdnOrderNo: row.order_no,
  orderNo: row.order_no,
  channelName: row.channel || '',
  channelCode: row.channel_code || row.channel || '',
  orderType: row.order_type || row.payment_mode || '',
  orderDate: row.order_date || '',
  skuCode: row.sku_code || '',
  skuDesc: row.sku_name || '',
  walkinLocation: row.walkin_location || '',
  fulfillmentLocation: row.fulfillment_location || row.warehouse || '',
  orderQty: Number(row.qty) || 0,
  lineNo: row.line_no || 1,
  lineAmount: Number(row.amount) || 0,
  image: row.image || '',
  customerAddress: [row.customer, row.city].filter(Boolean).join(' - '),
  lot: row.lot || '',
  udfs: row.udfs || '',
  udf1: row.udf1 || '', udf2: row.udf2 || '', udf3: row.udf3 || '', udf4: row.udf4 || '', udf5: row.udf5 || '',
  udf6: row.udf6 || '', udf7: row.udf7 || '', udf8: row.udf8 || '', udf9: row.udf9 || '', udf10: row.udf10 || '',
  ackStatus: row.ack_status || (row.acknowledged ? 'Acknowledged' : 'Pending Acknowledgement'),
  acknowledgedBy: row.acknowledged_by || '',
  acknowledgedDate: row.acknowledged_date || '',
  rejectionReason: row.rejection_reason || '',
  rejectionRemarks: row.rejection_remarks || '',
  trust: 'legacy-unverified',
});

function page(rows, body) {
  const size = [20, 50, 100, 200].includes(+body.rows) ? +body.rows : 100;
  const current = Math.max(1, +body.page || 1);
  const records = rows.length;
  const slice = rows.slice((current - 1) * size, current * size);
  return { gridModel: slice, rowDTOListFromUpdate: slice, rows: slice, page: current, total: Math.ceil(records / size), records };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    const orders = (await find('fulfillment_orders')).map(normalize);
    if (req.method === 'GET') {
      return res.json({
        available: false,
        dataTrust: 'legacy-unverified',
        reason: 'Order acknowledgement requires an authenticated channel connector and provider readback.',
        channels: [...new Set(orders.map(row => row.channelName).filter(Boolean))],
        orderTypes: [...new Set(orders.map(row => row.orderType).filter(Boolean))],
        rejectionReasons: ['Out of Stock'],
        pageSizes: [20, 50, 100, 200],
        counts: {
          pending: orders.filter(row => row.ackStatus === 'Pending Acknowledgement').length,
          history: orders.filter(row => row.ackStatus !== 'Pending Acknowledgement').length,
        },
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (body.action === 'search' || body.REQ_SEARCH_FLAG) {
      const rows = orders.filter(row =>
        (body.tab === 'history' ? row.ackStatus !== 'Pending Acknowledgement' : row.ackStatus === 'Pending Acknowledgement') &&
        has(row.extOrderNo, body.extOrderNo) && has(row.orderNo, body.orderNo) &&
        has(row.channelName, body.channelName) && has(row.orderType, body.orderType) &&
        has(row.skuCode, body.skuCode) &&
        (!text(body.fromOrderDate) || row.orderDate >= body.fromOrderDate) &&
        (!text(body.toOrderDate) || row.orderDate <= body.toOrderDate));
      rows.sort((left, right) => text(left.orderDate).localeCompare(text(right.orderDate)) * (text(body.sord) === 'asc' ? 1 : -1));
      return res.json(page(rows, body));
    }

    if (body.action === 'audit') {
      const rows = await find('generic_records', { module: 'order-acknowledgement-audit' });
      return res.json({ rows: rows.filter(row => !text(body.orderNo) || row.order_no === body.orderNo).map(row => ({ ...row, trust: 'legacy-unverified' })), trust: 'legacy-unverified' });
    }

    if (body.action === 'accept' || body.action === 'reject') {
      return res.status(501).json({ error: 'Marketplace acknowledgement is unavailable until an authenticated channel connector can submit and verify the provider response.' });
    }
    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Order Acknowledgement error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
