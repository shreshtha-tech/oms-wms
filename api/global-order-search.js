import { sendDatabaseUnavailable, cors, find, insert } from './mongo.js';
import { GLOBAL_ORDER_OPTIONS } from './global-order-search-options.js';

const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
const normalize = (row) => ({ ...row, web_order_no: row.web_order_no || row.ext_order_no || row.external_order_no || '', order_type: row.order_type || 'Normal', customer_name: row.customer_name || row.customer || '', ship_city: row.ship_city || row.city || '', email_id: row.email_id || row.customer_email || '', mobile: row.mobile || row.customer_phone || '', order_amount: row.order_amount ?? row.amount ?? '', tax_amt: row.tax_amt ?? row.tax_amount ?? '', disc_amt: row.disc_amt ?? row.discount_amount ?? '', order_tag: row.order_tag || '', on_hold: row.on_hold === true || row.on_hold === 'Yes' ? 'Yes' : 'No', vendor: row.vendor || row.vendor_name || '', vendor_mode: row.vendor_mode || row.delivery_mode || '', timezone: row.timezone || '' });
const parseDate = (value) => { const source = text(value).slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return new Date(`${source}T00:00:00Z`); const match = source.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return match ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`) : null; };
const optionLabel = (group, value) => !text(value) ? '' : GLOBAL_ORDER_OPTIONS[group].find((option) => option.value === text(value))?.label || text(value);
const validateSearch = (body) => {
  if (!text(body.orderNo) && !text(body.webOrderNo) && !text(body.orderDate) && !text(body.fromDate) && !text(body.toDate)) return 'Please Provide Value For Either Order No ,Web Order No or Order Date.';
  if (text(body.orderDate) || text(body.fromDate) || text(body.toDate)) {
    const from = parseDate(body.fromDate || text(body.orderDate).split(' - ')[0]), to = parseDate(body.toDate || text(body.orderDate).split(' - ')[1]);
    if (!from || !to) return !text(body.fromDate || text(body.orderDate).split(' - ')[0]) ? 'Please fill Po Date' : 'The server encountered an internal error and was unable to complete your request. Please contact the server administrator.';
    if ((to.getTime() - from.getTime()) / 86400000 > 90) return 'Order Date range can not be greater than 90 days';
  }
  return '';
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') return res.status(200).json({ ...GLOBAL_ORDER_OPTIONS, modes: [{ value: '1', label: 'By Merchant' }, { value: '2', label: 'By Marketplace' }], pageSizes: [20, 50, 100, 200], merchantKey: 'SPGBLODRSRCH', marketplaceKey: 'SPGBLDSODRSRCH', maxDateRangeDays: 90 });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {}, mode = body.mode === 'merchant' || text(body.mode) === '1' ? 'merchant' : body.mode === 'marketplace' || text(body.mode) === '2' ? 'marketplace' : '';
    if (!mode) return res.status(400).json({ error: 'mode must be merchant or marketplace' });
    const procedure = mode === 'marketplace' ? 'SPGBLDSODRSRCH' : 'SPGBLODRSRCH';
    if (text(body.key) !== procedure) return res.status(400).json({ error: `key must be ${procedure} for ${mode} mode` });
    if (body.action === 'export') {
      if (!Array.isArray(body.rows) || !body.rows.length) return res.status(400).json({ error: 'No order available to download in search results.' });
      const reportId = `GOR-${Date.now()}`;
      await insert('generic_records', { module: 'pending-report', code: reportId, name: 'Global Order Search', status: 'Pending', search_data: body.filters || {}, procedure, created_date: new Date().toISOString() });
      return res.status(200).json({ jsonMessage: null, reportId });
    }
    if (!body.REQ_SEARCH_FLAG) return res.status(400).json({ error: 'REQ_SEARCH_FLAG is required' });
    const validation = validateSearch(body); if (validation) return res.status(400).json({ error: validation });
    let rows = (await find('sale_orders')).map(normalize);
    const orderType = optionLabel('orderTypes', body.orderType), statuses = (Array.isArray(body.status) ? body.status : text(body.status).split(',').filter(Boolean)).map((value) => optionLabel(mode === 'marketplace' ? 'marketplaceStatuses' : 'merchantStatuses', value));
    const tag = optionLabel('orderTags', body.orderTag), onHold = optionLabel('onHold', body.onHold), vendorMode = optionLabel('vendorModes', body.vendorMode);
    rows = rows.filter((row) => has(row.order_no, body.orderNo) && has(row.web_order_no, body.webOrderNo) && has(row.order_type, orderType) && has(row.customer_name, body.customerName) && has(row.email_id, body.emailId) && has(row.mobile, body.mobile) && (!statuses.length || statuses.includes(text(row.status))) && has(row.order_tag, tag) && (!text(body.onHold) || text(body.onHold) === '-1' || text(row.on_hold) === onHold) && (mode !== 'marketplace' || has(row.vendor, body.vendor)) && (mode !== 'marketplace' || !text(body.vendorMode) || has(row.vendor_mode, vendorMode)));
    const from = parseDate(body.fromDate || text(body.orderDate).split(' - ')[0]), to = parseDate(body.toDate || text(body.orderDate).split(' - ')[1]);
    if (from && to) rows = rows.filter((row) => { const date = parseDate(row.order_date); return date && date >= from && date <= to; });
    const sortKey = text(body.sidx).replace(/^o\.|^d\.|^ot\./, '').replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`); rows.sort((a, b) => text(a[sortKey] ?? a.order_date).localeCompare(text(b[sortKey] ?? b.order_date)) * (text(body.sord) === 'asc' ? 1 : -1));
    const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20, current = Math.max(1, Number(body.page) || 1), records = rows.length, total = Math.ceil(records / size), gridModel = rows.slice((current - 1) * size, current * size);
    return res.status(200).json({ gridModel, rows: gridModel, page: current, records, total, mode, key: procedure });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('global order search error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message }); }
}
