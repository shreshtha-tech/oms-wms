import { sendDatabaseUnavailable, cors, find } from './mongo.js';
import { COD_TRANSPORTERS } from './cod-reconciliation-transporters.js';

const text = (value) => String(value ?? '').trim();
const money = (value) => Number(value || 0).toFixed(2);
const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
const transporterName = (code) => {
  const label = COD_TRANSPORTERS.find((item) => item.value === text(code))?.label || text(code);
  return label.replace(/\s*-\s*[^-]+$/, '').trim();
};
const normalize = (row) => ({
  ...row,
  orderNo: row.ext_order_no || row.order_no || '',
  delNo: row.delivery_no || row.shipment_no || `DEL-${row.id}`,
  shipDate: row.ship_date || row.order_date || '',
  trackingNo: row.tracking_no || row.awb_no || '',
  transporterName: row.transporter_name || row.transporter || 'Delhivery',
  collectableAmount: money(row.collectable_amount ?? row.cod_amount ?? row.order_amount ?? row.amount),
  isReconcile: row.payment_reconciled === true || row.payment_reconciled === 'Yes' ? 'Yes' : 'No',
  collectedAmount: money(row.collected_amount),
  settledamtCash: money(row.cash),
  settledamtCC: money(row.credit_card),
  settledamtCoupon: money(row.coupon),
  recievedAmount: money(row.received_amount),
  status: row.status || '',
  orderSource: row.source || row.order_source || '',
});
const page = (rows, body) => {
  const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
  const current = Math.max(1, Number(body.page) || 1), records = rows.length, total = Math.ceil(records / size);
  const gridModel = rows.slice((current - 1) * size, current * size);
  return { gridModel, rows: gridModel, page: current, records, total };
};
const dateDay = (value) => {
  const source = text(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    const parsed = new Date(`${source}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === source ? source : '';
  }
  const match = source.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  const [, day, month, year] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() + 1 === Number(month) && parsed.getUTCDate() === Number(day)
    ? `${year}-${month}-${day}` : '';
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') return res.status(200).json({ transporters: COD_TRANSPORTERS, reconciliation: [{ value: '-1', label: '--- Select ---' }, { value: '0', label: 'No' }, { value: '1', label: 'Yes' }], pageSizes: [20, 50, 100, 200], maxImportLines: 500 });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    if (body.action === 'export') {
      if (!Number(body.gridDataLen || body.rows?.length)) return res.status(400).json({ error: 'No Data In Grid To Export' });
      return res.status(501).json({ error: 'COD export is unavailable until a report worker can create and deliver the file.' });
    }
    if (body.action === 'import') {
      const lines = text(body.cODReconciliationImport).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return res.status(400).json({ error: 'Nothing To Import' });
      if (lines.length > 500) return res.status(400).json({ error: 'Maximum 500 records can be imported at a time' });
      return res.status(501).json({ error: 'COD settlement import is unavailable until remittance identity, duplicate handling, and settlement readback are connected.' });
    }
    if (body.action === 'reconcile' || body.action === 'force-reconcile') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return res.status(400).json({ error: 'Please Select Record For Process.' });
      return res.status(501).json({ error: 'COD reconciliation requires an authorized settlement source, recorded remittance evidence, and an auditable idempotent settlement transaction.' });
    }
    if (!body.REQ_SEARCH_FLAG) return res.status(400).json({ error: 'REQ_SEARCH_FLAG is required' });
    if (!text(body.transporterName) || text(body.transporterName) === '-1') return res.status(400).json({ error: 'Please select transporter' });
    if (!COD_TRANSPORTERS.some((item) => item.value === text(body.transporterName))) return res.status(400).json({ error: 'Please select transporter' });
    const fromDate = text(body.shipStartDate) ? dateDay(body.shipStartDate) : '';
    const toDate = text(body.shipEndDate) ? dateDay(body.shipEndDate) : '';
    if ((text(body.shipStartDate) && !fromDate) || (text(body.shipEndDate) && !toDate)) return res.status(400).json({ error: 'Ship Date must use DD/MM/YYYY or YYYY-MM-DD.' });
    if (fromDate && toDate && fromDate > toDate) return res.status(400).json({ error: 'Ship Date start cannot be after end.' });
    if (text(body.isReconcile) && !['-1', '0', '1'].includes(text(body.isReconcile))) return res.status(400).json({ error: 'Payment reconciled filter is invalid.' });
    const selectedTransporter = transporterName(body.transporterName);
    let rows = (await find('sale_orders', {})).map(normalize).filter((row) => has(row.orderNo, body.orderNo) && has(row.delNo, body.delNo) && has(row.trackingNo, body.trackingNo) && has(row.transporterName, selectedTransporter));
    if (fromDate || toDate) rows = rows.filter((row) => { const shipDate = dateDay(row.shipDate); return !!shipDate && (!fromDate || shipDate >= fromDate) && (!toDate || shipDate <= toDate); });
    if (text(body.isReconcile) === '0') rows = rows.filter((row) => row.isReconcile === 'No');
    if (text(body.isReconcile) === '1') rows = rows.filter((row) => row.isReconcile === 'Yes');
    rows.sort((a, b) => text(a.orderNo).localeCompare(text(b.orderNo)) * (text(body.sord) === 'desc' ? -1 : 1));
    return res.status(200).json(page(rows, body));
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('cod reconciliation error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message }); }
}
