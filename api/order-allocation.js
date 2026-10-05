import { clientPairs, locationPairs } from './catalogs.js';
import { sendDatabaseUnavailable, cors, find } from './mongo.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());

function normalize(row) {
  return {
    id: row.id,
    clientId: row.client_id ?? '',
    orderNo: row.order_no || '',
    fromExternOrderNo: row.ext_order_no || row.external_order_no || '',
    status: row.status || '',
    statusId: row.status_id || '',
    orderDate: row.order_date || '',
    skuCode: row.sku_code || '',
    lineQty: row.qty ?? row.line_qty ?? '',
    openQty: row.open_qty ?? '',
    lineAmount: row.amount ?? '',
    lineNo: row.line_no ?? '',
    siteLocation: row.site_location || row.warehouse || '',
    customerCode: row.customer_name || row.customer || '',
    customerEmail: row.customer_email || row.email || '',
    customerPhone: row.customer_phone || row.phone || '',
    orderType: row.order_type || '',
    orderQty: row.order_qty ?? row.qty ?? '',
    holdFlag: row.on_hold ? 'Yes' : 'No',
    errorDesc: row.logs || '',
    trust: 'legacy-unverified',
  };
}

function page(rows, body) {
  const size = [50, 100, 200].includes(+body.rows) ? +body.rows : 50;
  const current = Math.max(1, +body.page || 1);
  const records = rows.length;
  const slice = rows.slice((current - 1) * size, current * size);
  return { gridModel: slice, rows: slice, page: current, total: Math.ceil(records / size), records };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    const all = await find('fulfillment_orders');
    if (req.method === 'GET') {
      const [locations, clients] = await Promise.all([locationPairs(), clientPairs()]);
      return res.json({
        allocationAvailable: false,
        dataTrust: 'legacy-unverified',
        reason: 'Order allocation, unallocation, and cancellation require Central Inventory reservation and release transactions.',
        locations: [['-1', '--- Select ---'], ...locations],
        statuses: [['10', 'Part Allocated'], ['13', 'Allocated'], ['16', 'Part Picked'], ['19', 'Pick complete'], ['28', 'Partially Shipped'], ['4', 'Confirmed']],
        orderTypes: [['-1', '--- Select ---'], ['14', 'Normal'], ['18', 'Cash On Delivery'], ['1', 'Prepaid'], ['2', 'COD']],
        clients,
        orderTags: [],
      });
    }

    if (req.method === 'POST' && (body.REQ_SEARCH_FLAG || body.action === 'search')) {
      const statuses = Array.isArray(body.status) ? body.status : text(body.status).split(/[|,]/).filter(Boolean);
      const orderFilter = text(body.filteredOrderArr).split(',').filter(Boolean);
      const rows = all.map(normalize).filter(row =>
        has(row.siteLocation, body.siteLocation) && has(row.fromExternOrderNo, body.fromMagentoOrderNo) &&
        has(row.orderNo, body.fromOrderNo) && has(row.holdFlag, body.onHold === '1' ? 'Yes' : body.onHold === '0' ? 'No' : body.onHold) &&
        has(row.orderType, body.orderType) && (!text(body.fromOrderDate) || row.orderDate >= body.fromOrderDate) &&
        (!text(body.toOrderDate) || row.orderDate <= body.toOrderDate) &&
        (!statuses.length || statuses.includes(row.status) || statuses.includes(row.statusId)) &&
        has(row.skuCode, body.skuCode || body.sku) && has(row.customerCode, body.customerName) &&
        has(row.customerEmail, body.customerEmail) && has(row.customerPhone, body.customerPh) &&
        has(row.clientId, body.clientId) && (!orderFilter.length || orderFilter.includes(row.orderNo) || orderFilter.includes(row.fromExternOrderNo)));
      rows.sort((left, right) => text(left.orderNo).localeCompare(text(right.orderNo)));
      return res.json({ ...page(rows, body), trust: 'legacy-unverified' });
    }

    if (req.method === 'POST' && body.action === 'import') {
      const orders = [...new Set((Array.isArray(body.orders) ? body.orders : []).map(text).filter(Boolean))];
      if (orders.length > 100) return res.status(400).json({ error: 'Max 100 lines are allowed at a time' });
      if (!orders.length) return res.status(400).json({ error: 'Enter at least one order number' });
      const matches = all.filter(row => orders.includes(text(row.order_no)) || orders.includes(text(row.ext_order_no || row.external_order_no)));
      const resultRows = matches.map(normalize);
      return res.json({ rows: resultRows, notFound: orders.filter(order => !matches.some(row => [text(row.order_no), text(row.ext_order_no || row.external_order_no)].includes(order))), trust: 'legacy-unverified' });
    }

    if (req.method === 'PUT') {
      return res.status(501).json({ error: 'Allocation, unallocation, and order cancellation are paused until Central Inventory can atomically reserve or release each order line.' });
    }
    if (req.method === 'POST') return res.status(501).json({ error: 'Order allocation has no supported write action without Central Inventory reservations.' });
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Order allocation error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
