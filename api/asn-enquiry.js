import { sendDatabaseUnavailable, find, cors } from './mongo.js';

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
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    const query = req.method === 'POST' ? (req.body || {}) : req.query;
    const page = Math.max(1, Number(query.page) || 1);
    const rows = [50, 100, 200].includes(Number(query.rows)) ? Number(query.rows) : 50;
    const includes = (value, query) => !query || String(value || '').toLowerCase().includes(String(query).toLowerCase());
    const all = await find('grn', {}, { sort: { asn_date: -1 } });
    const asnTagQuery = query.asnTagTmp || query.asnTag;
    const filtered = all.filter((row) => includes(row.asn_no || row.grn_no, query.asnNo) && includes(row.ext_asn_no, query.extRefNo || query.extAsnNo)
      && (!query.status || query.status === '-1' || row.status === query.status || String(row.status_code) === String(query.status))
      && (!query.asnType || query.asnType === '-1' || String(row.asn_type) === String(query.asnType))
      && includes(row.vendor_code, query.vendorCode) && includes(row.customer_code, query.customerCode) && includes(row.po_no, query.poCode)
      && includes((row.lines || []).map((line) => line.sku_code).join(' '), query.skuCode) && includes(row.reference_no, query.referenceNo)
      && (!query.clientId || query.clientId === '-1' || String(row.client_id ?? '') === String(query.clientId))
      && (!query.deliveryLocation || query.deliveryLocation === '-1' || includes(row.warehouse, query.deliveryLocation)) && includes(row.invoice_no, query.invoiceNo)
      && (!asnTagQuery || String(asnTagQuery).split('|').filter(Boolean).every((tag) => String(row.asn_tag || '').split(',').includes(tag)))
      && (!query.fromASNDate || String(row.asn_date || row.grn_date || '') >= String(query.fromASNDate))
      && (!query.toASNDate || String(row.asn_date || row.grn_date || '') <= String(query.toASNDate)));
    const records = filtered.map((row) => ({
      id: row.id, clientId: row.client_id ?? '', asnNo: row.asn_no || row.grn_no || '', extAsnNo: row.ext_asn_no || '', asnDate: displayDate(row.asn_date || row.grn_date), status: row.status || '', statusAsn: row.status_code || '',
      vendorName: row.vendor || '', customerName: row.customer_name || '', poCode: row.po_no || '', asnType: row.asn_type || '', asnTypeText: row.asn_type_text || row.asn_type || '', partyCode: row.document_no || row.po_no || '', deliveryLocation: row.warehouse || '', invoiceNo: row.invoice_no || '', asnTagVal: row.asn_tag || '',
      closedQty: row.closed_qty ?? 0, asnQty: row.expected_qty ?? '', asnRcvdQty: row.received_qty ?? 0,
    }));
    const start = (page - 1) * rows;
    const pageRows = records.slice(start, start + rows);
    return res.status(200).json({ asnList: pageRows, asnEnquiryDTOList: pageRows, page, rows, records: records.length, total: Math.ceil(records.length / rows) });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('API error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message }); }
}
