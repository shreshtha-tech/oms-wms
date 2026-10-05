import { sendDatabaseUnavailable, find, findOne, cors } from './mongo.js';

function displayDate(value) {
  if (!value) return '';
  const date = new Date(value); if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(date);
  const item = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${item.day}/${item.month}/${item.year} ${item.hour}:${item.minute} ${String(item.dayPeriod || '').toUpperCase()}`;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const poCode = String(req.query.poCode || '');
    if (!poCode) return res.status(400).json({ error: 'PO Code is required.' });
    const po = await findOne('purchase_orders', { po_no: poCode });
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.rows) || 20));
    const records = (await find('grn', { po_no: poCode }, { sort: { asn_date: -1 } })).filter((row) => row.asn_no).map((row) => ({
      asnNo: row.asn_no, asnDate: displayDate(row.asn_date || row.grn_date), invoiceNo: row.invoice_no || '', transporter: row.transporter || '', status: row.status || '',
      closedQty: row.closed_qty ?? 0, asnQty: row.expected_qty ?? po.qty ?? '', asnRcvdQty: row.received_qty ?? 0,
    }));
    const start = (page - 1) * pageSize;
    return res.status(200).json({ asnEnquiryDTOList: records.slice(start, start + pageSize), page, records: records.length, rows: pageSize, total: Math.ceil(records.length / pageSize) });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('API error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message }); }
}
