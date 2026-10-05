import { sendDatabaseUnavailable, cors, find, insert, update } from './mongo.js';
import { locations } from './catalogs.js';
import { currentUser } from './auth-session.js';

const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
const parse = (value) => {
  const input = text(value).slice(0, 10);
  const match = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T00:00:00Z`) : null;
};
const statusMap = { '5': 'Pending', '10': 'Confirmed', '7': 'Cancelled', '15': 'Delivered', '11': 'To Be Disposed', '12': 'Disposed', '13': 'Rejected' };
const typeMap = { '6': 'With QC', '8': 'Against ASN', '3': 'Delivered Return', '4': 'Non Delivered Return', '1': 'With PO', '5': 'With STO', '2': 'Without PO' };
const norm = (row) => ({
  ...row,
  discrepancyNo: row.discrepancyNo || row.discrepancy_no || row.code || '',
  hiddenDiscrepancyNo: row.hiddenDiscrepancyNo || row.discrepancyNo || row.code || '',
  createdDateString: row.createdDateString || row.created_date || '',
  discrepancyQty: Number(row.discrepancyQty ?? row.qty ?? 0).toFixed(3),
  statusCode1: String(row.statusCode1 ?? row.status_code ?? '5'),
  status: row.statusText || statusMap[String(row.statusCode1 ?? row.status_code)] || row.status || 'Pending',
  inboundNo: row.inboundNo || row.inbound_no || '',
  grnNo: row.grnNo || row.grn_no || '',
  parentDocNo: row.parentDocNo || row.parent_doc_no || '',
  extParentDocNo: row.extParentDocNo || row.ext_parent_doc_no || row.parentDocNo || row.parent_doc_no || '',
  inboundType: row.inboundType || row.inbound_type || '',
  inboundTypeCode: String(row.inboundTypeCode || row.inbound_type_code || ''),
  invoiceNo: row.invoiceNo || row.invoice_no || '',
  discrepancyType: row.discrepancyType || row.discrepancy_type || '',
  commoninboundtype: row.commoninboundtype || row.common_inbound_type || '',
  fileName: row.fileName || row.file_name || '',
  awsUrl: row.attachment_data ? `/api/discrepancy-enquiry?downloadId=${encodeURIComponent(row.id)}` : '',
  createdBy: row.createdBy || row.created_by || '',
  createDateText: row.createDateText || row.created_date || '',
  modifiedBy: row.modifiedBy || row.modified_by || '',
  modifiedDateText: row.modifiedDateText || row.modified_date || '',
  docUploaded: String(row.docUploaded ?? row.doc_uploaded ?? ''),
  dspLocation: row.dspLocation || row.location_code || '',
  otpValidation: String(row.otpValidation ?? row.otp_validation ?? '0'),
  vendorCode: row.vendorCode || row.vendor_code || '',
});
const all = async () => (await find('generic_records', { module: 'discrepancy' })).map(norm);
const next = (rows) => `DN-${String(Math.max(0, ...rows.map((row) => Number(text(row.discrepancyNo).replace(/\D/g, '')) || 0)) + 1).padStart(8, '0')}`;
const detailFields = ['Discrepancy Note No','Discrepancy Created Date','Inbound No','SKU Code','SKU Name','Inbound Location','PO No','GRN No','GRN Date','GRN Created Date','Material Received Date','GRN Value','Invoice No','Vendor Code','Bin Location','Reason','Remarks','Expected Quantity','Received Quantity','Discrepancy Quantity','Unit Price','Tax Amount','Total Amount','Discrepancy Status','ClientId'];
const actor = (req) => currentUser(req)?.username || 'unknown';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const rows = await all();
    if (req.method === 'GET' && req.query?.downloadId) {
      const row = rows.find((item) => item.id === Number(req.query.downloadId));
      if (!row?.attachment_data) return res.status(404).json({ error: 'Attachment not found.' });
      const data = Buffer.from(row.attachment_data, 'base64');
      res.setHeader('Content-Type', row.attachment_content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${String(row.fileName).replace(/["\\r\\n]/g, '_')}"`);
      res.setHeader('Content-Length', data.length);
      return res.status(200).send(data);
    }
    if (req.method === 'GET') {
      return res.json({
        statuses: [['-1','--- Select ---'],['7','Cancelled'],['10','Confirmed'],['15','Delivered'],['12','Disposed'],['5','Pending'],['13','Rejected'],['11','To Be Disposed']],
        inboundTypes: [['-1','--- Select ---'],['6','With QC'],['8','Against ASN'],['3','Delivered Return'],['4','Non Delivered Return'],['1','With PO'],['5','With STO'],['2','Without PO']],
        discrepancyTypes: [['-1','--- Select ---'],['QC','QC'],['INB','Inbound']],
        locations: await locations(), pageSizes: [20,50,100,200], detailFields,
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    if (body.action === 'ingest') {
      const inboundNo = text(body.inboundNo);
      if (!inboundNo) return res.status(400).json({ error: 'Inbound No is required.' });
      const inbound = (await find('grn')).find((row) => [row.inbound_no, row.grn_no, row.asn_no].includes(inboundNo));
      if (!inbound) return res.status(404).json({ error: 'Inbound record not found.' });
      const location = (await locations()).find((item) => [item.code, item.name].includes(text(inbound.warehouse)));
      if (!location) return res.status(400).json({ error: 'The inbound has no configured location.' });
      const typeCode = String(body.inboundTypeCode || '');
      if (!typeMap[typeCode]) return res.status(400).json({ error: 'Please select Inbound Type.' });
      const quantity = Number(body.qty);
      if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Discrepancy quantity must be greater than zero.' });
      const statusCode = String(body.statusCode || '5');
      if (!statusMap[statusCode]) return res.status(400).json({ error: 'Invalid discrepancy status.' });
      const discrepancyType = text(body.discrepancyType);
      if (!['QC','INB'].includes(discrepancyType)) return res.status(400).json({ error: 'Please select a discrepancy type.' });
      const parentDocNo = text(body.parentDocNo || inbound.po_no || inbound.asn_no || inbound.sto_no);
      const discrepancyNo = next(rows), now = new Date().toISOString();
      const row = await insert('generic_records', {
        module: 'discrepancy', code: discrepancyNo, discrepancyNo, status_code: statusCode,
        inbound_no: inboundNo, grn_no: text(body.grnNo || inbound.grn_no), parent_doc_no: parentDocNo,
        inbound_type: typeMap[typeCode], inbound_type_code: typeCode, invoice_no: text(body.invoiceNo || inbound.invoice_no),
        discrepancy_type: discrepancyType, qty: quantity, created_date: now, created_by: actor(req),
        otp_validation: String(body.otpValidation || '0'), location_code: location.code,
      });
      return res.status(201).json({ row: norm(row) });
    }
    if (body.action === 'export' || body.action === 'detail-export') {
      if (body.action === 'detail-export' && !Number(body.gridDataLen)) return res.status(400).json({ error: 'Nothing to export' });
      if (body.action === 'detail-export' && (!Array.isArray(body.fields) || !body.fields.length)) return res.status(400).json({ error: 'No Data In Grid To Export' });
      const reportId = `${body.action === 'detail-export' ? 'DDE' : 'DNE'}-${Date.now()}`;
      await insert('generic_records', { module: 'pending-report', code: reportId, name: body.action === 'detail-export' ? 'Discrepancy Detail Export' : 'Discrepancy Export', status: 'Pending', fields: body.fields || [], created_date: new Date().toISOString() });
      return res.json({ jsonMessage: null, reportId });
    }
    if (body.action === 'status') {
      const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
      const target = String(body.status);
      if (!ids.length) return res.status(400).json({ error: target === '15' ? 'Please select some Discrepancy Note from grid to Deliver Discrepancy' : target === '7' ? 'Please select some Discrepancy Note from grid to Cancel the Discrepancy' : 'Please select some Discrepancy Note from grid to disposed/to be disposed the Discrepancy' });
      const chosen = rows.filter((row) => ids.includes(row.id));
      if (chosen.length !== ids.length) return res.status(404).json({ error: 'A selected discrepancy no longer exists. Search again.' });
      for (const row of chosen) {
        if (target === '7' && row.statusCode1 !== '5') return res.status(400).json({ error: 'Only Pending Row can be Cancelled' });
        if (target === '15' && row.statusCode1 !== '10') return res.status(400).json({ error: 'Only Confirmed Row can be Delivered' });
        if (target === '11' && row.statusCode1 === '11') return res.status(400).json({ error: 'To be disposed Row can only be disposed' });
        if ((target === '11' && row.statusCode1 !== '10') || (target === '12' && !['10','11'].includes(row.statusCode1))) return res.status(400).json({ error: 'Only Confirmed/to be disposed Row can be disposed/to be disposed' });
        if (['15','11'].includes(target) && row.discrepancyType !== 'QC') {
          const attachment = body.attachments?.[row.id];
          if (!attachment?.data && !row.attachment_data && row.otpValidation !== '1') return res.status(400).json({ error: 'Attachment is mandatory' });
          if (attachment?.data && (!attachment.name || !/^[\w.+-]+\/[\w.+-]+$/.test(attachment.type || '') || !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.data))) return res.status(400).json({ error: 'Invalid attachment data.' });
          if (attachment?.data && Buffer.from(attachment.data, 'base64').length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Attachment must be 5 MB or smaller.' });
        }
        if (['15','11'].includes(target) && row.otpValidation === '1') return res.status(503).json({ error: 'OTP verification is unavailable until an OTP provider is configured.', otpRequired: true, rowId: row.id });
      }
      for (const row of chosen) {
        const attachment = body.attachments?.[row.id];
        const now = new Date().toISOString();
        await update('generic_records', row.id, {
          status_code: target, statusText: statusMap[target],
          ...(attachment?.data ? { file_name: text(attachment.name), attachment_content_type: attachment.type, attachment_data: attachment.data } : {}),
          modified_by: actor(req), modified_date: now,
          doc_uploaded: attachment?.data || row.attachment_data ? '1' : row.docUploaded,
        });
      }
      return res.json({ jsonMessage: null, updated: chosen.length, status: statusMap[target] });
    }
    if (body.action === 'delete-attachment') {
      const row = rows.find((item) => item.id === Number(body.id));
      if (!row) return res.status(404).json({ error: 'Discrepancy not found' });
      await update('generic_records', row.id, { file_name: '', attachment_content_type: '', attachment_data: '', aws_url: '', doc_uploaded: '0', modified_by: actor(req), modified_date: new Date().toISOString() });
      return res.json({ message: 'Attachment deleted' });
    }
    if (!body.REQ_SEARCH_FLAG) return res.status(400).json({ error: 'REQ_SEARCH_FLAG is required' });
    if (text(body.parentDocNo) && (!text(body.inboundType) || text(body.inboundType) === '-1')) return res.status(400).json({ error: 'Please select Inbound Type' });
    const from = parse(body.fromCreatedDate), to = parse(body.toCreatedDate);
    let filtered = rows.filter((row) => has(row.discrepancyNo, body.discrepancyNo) && has(row.grnNo, body.GRNNo) && has(row.inboundNo, body.inboundNo) && has(row.invoiceNo, body.invoiceNo) && has(row.parentDocNo, body.parentDocNo) && (!text(body.status) || text(body.status) === '-1' || row.statusCode1 === text(body.status)) && (!text(body.inboundType) || text(body.inboundType) === '-1' || row.inboundTypeCode === text(body.inboundType)) && (!text(body.discrepancyType) || text(body.discrepancyType) === '-1' || row.discrepancyType === text(body.discrepancyType)));
    if (from && to) filtered = filtered.filter((row) => { const date = parse(row.createdDateString); return date && date >= from && date <= to; });
    filtered.sort((a, b) => text(b.createdDateString).localeCompare(text(a.createdDateString)));
    const size = [20,50,100,200].includes(+body.rows) ? +body.rows : 20;
    const page = Math.max(1, +body.page || 1), records = filtered.length, total = Math.ceil(records / size);
    return res.json({ gridModel: filtered.slice((page - 1) * size, page * size), rows: size, page, records, total });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('discrepancy enquiry error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
