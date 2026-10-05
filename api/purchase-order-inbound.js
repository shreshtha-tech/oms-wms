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
    const rows = Math.min(200, Math.max(1, Number(req.query.rows) || 20));
    const inbound = (await find('grn', { po_no: poCode }, { sort: { grn_date: -1 } })).map((row) => ({
      clientId: row.client_id || '', inboundNo: row.inbound_no || row.grn_no || '', createDate: displayDate(row.inbound_date || row.grn_date),
      poNo: row.po_no || '', GRNNo: row.grn_no || '', asnNumber: row.asn_no || '', GRNDate: displayDate(row.grn_date),
      vendorCode: row.vendor || '', expQty: row.expected_qty ?? po.qty ?? '', rcvQty: row.received_qty ?? '', invoiceNo: row.invoice_no || '',
      status: row.status || '', commonInboundType: row.common_inbound_type || 'PO', statusCode: row.status_code || '',
    }));
    const start = (page - 1) * rows;
    return res.status(200).json({ inboundList: inbound.slice(start, start + rows), page, records: inbound.length, rows, total: Math.ceil(inbound.length / rows) });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('API error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
