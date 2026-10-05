import { sendDatabaseUnavailable, find, findOne, insert, cors } from './mongo.js';
import { clientPairs } from './catalogs.js';
import { transitionGrnDraft } from './inbound-receipt-guard.js';

const TYPE_TEXT = { '1': 'Vendor', '2': 'Customer', '3': 'Other', '4': 'PO', '5': 'Marketplace' };
const STATUS_TEXT = { '1': 'Pending Confirmation', '4': 'Confirmed', '7': 'Cancelled', '15': 'Closed', '17': 'Part received', '20': 'Short Closed' };

function validate(body) {
  const type = String(body.asn_type || '');
  if (!TYPE_TEXT[type]) return 'ASN Type is mandatory';
  if (type === '1' && !String(body.vendor_code || '').trim()) return 'Vendor is mandatory';
  if (type === '2' && !String(body.customer_code || '').trim()) return 'Please Select Customer First';
  if (type === '4' && !String(body.po_no || '').trim()) return 'PO No is Mandatory.';
  if (!Array.isArray(body.lines) || !body.lines.length) return 'No Data Found In The Grid';
  if (body.lines.some((line) => !String(line.sku_code || '').trim() || !Number.isFinite(Number(line.exp_qty)) || Number(line.exp_qty) <= 0)) return 'Expected quantity must be greater than zero.';
  if (String(body.operation || '1') !== '20' && body.lines.some((line) => Number.isFinite(Number(line.pending_qty)) && Number(line.exp_qty) > Number(line.pending_qty))) return 'Exp Qty can not be greater than pending ASN.';
  if (String(body.operation || '') === '20' && !body.lines.some((line) => Number(line.closed_qty || 0) > 0 && String(line.close_reason || '').trim())) return 'Please select atleast one row to Close';
  if (Array.isArray(body.udf) && body.udf.some((value) => String(value ?? '').length > 50)) return 'Each PO UDF value must be 50 characters or fewer.';
  return '';
}

function payload(body, current = {}) {
  const type = String(body.asn_type ?? current.asn_type ?? '');
  const operation = String(body.operation || '1');
  const now = new Date().toISOString();
  const lines = (body.lines ?? current.lines ?? []).map((line, index) => ({ ...line, rcvd_qty: Number(current.lines?.[index]?.rcvd_qty || 0) }));
  return {
    asn_no: current.asn_no || body.asn_no || `ASN${Date.now().toString().slice(-8)}`,
    grn_no: current.grn_no || '', asn_date: current.asn_date || body.asn_date || now.slice(0, 10),
    asn_type: type, asn_type_text: TYPE_TEXT[type], client_id: body.client_id ?? current.client_id ?? '',
    vendor_code: body.vendor_code ?? current.vendor_code ?? '', vendor: body.vendor_name ?? current.vendor ?? '',
    customer_code: body.customer_code ?? current.customer_code ?? '', customer_name: body.customer_name ?? current.customer_name ?? '',
    po_no: body.po_no ?? current.po_no ?? '', document_no: body.party_code ?? body.po_no ?? current.document_no ?? '',
    warehouse: body.delivery_location ?? current.warehouse ?? '', ext_asn_no: body.ext_asn_no ?? current.ext_asn_no ?? '',
    remarks: body.remarks ?? current.remarks ?? '', expected_date: body.expected_date ?? current.expected_date ?? '',
    gross_weight: Number(body.gross_weight ?? current.gross_weight ?? 0), tracking_no: body.tracking_no ?? current.tracking_no ?? '',
    challan_no: body.challan_no ?? current.challan_no ?? '', material_received_date: body.material_received_date ?? current.material_received_date ?? '',
    no_of_boxes: Number(body.no_of_boxes ?? current.no_of_boxes ?? 0), invoice_no: body.invoice_no ?? current.invoice_no ?? '',
    invoice_amount: Number(body.invoice_amount ?? current.invoice_amount ?? 0), transporter: body.transporter ?? current.transporter ?? '',
    receipt_validation: body.receipt_validation ?? current.receipt_validation ?? '', reference_no: body.reference_no ?? current.reference_no ?? '',
    lines, expected_qty: lines.reduce((sum, line) => sum + Number(line.exp_qty || 0), 0),
    received_qty: lines.reduce((sum, line) => sum + Number(line.rcvd_qty || 0), 0),
    udf: Array.from({ length: 10 }, (_, index) => String((body.udf ?? current.udf ?? [])[index] ?? '').trim()),
    documents: body.documents ?? current.documents ?? [], asn_tags: body.asn_tags ?? current.asn_tags ?? [],
    asn_tag: (body.asn_tags ?? current.asn_tags ?? []).join(','), status_code: operation,
    status: STATUS_TEXT[operation] || current.status || 'Pending Confirmation', row_version: Number(current.row_version || 0) + 1, updated_at: now,
  };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET' && req.query.meta === 'tags') return res.status(200).json((await find('generic_records', { module: 'asn-tag-definition' })).map((row) => ({ value: row.code, label: row.name })));
    if (req.method === 'GET') {
      const row = req.query.id ? await findOne('grn', { id: Number(req.query.id) }) : await findOne('grn', { asn_no: String(req.query.asnNo || '') });
      if (!row) return res.status(404).json({ error: 'ASN not found.' });
      return res.status(200).json(row);
    }
    if (req.method === 'POST') {
      if (req.body?.action === 'create-tag') {
        const name = String(req.body.name || '').trim();
        if (!name || name.length > 50) return res.status(400).json({ error: 'Enter a tag name of 1 to 50 characters.' });
        const existing = (await find('generic_records', { module: 'asn-tag-definition' })).find((row) => String(row.name).toLowerCase() === name.toLowerCase());
        if (existing) return res.status(409).json({ error: 'ASN tag already exists.' });
        const row = await insert('generic_records', { module: 'asn-tag-definition', code: `ASNTAG-${Date.now()}`, name });
        return res.status(201).json({ value: row.code, label: row.name });
      }
      if (String(req.body?.grn_no || '').trim()) return res.status(400).json({ error: 'An ASN cannot set a GRN receipt number.' });
      const error = validate(req.body); if (error) return res.status(400).json({ error });
      if (req.body.client_id && !(await clientPairs()).some(([code]) => code === String(req.body.client_id))) return res.status(400).json({ error: 'Select a configured client.' });
      const tagIds = new Set((await find('generic_records', { module: 'asn-tag-definition' })).map((tag) => tag.code));
      if ((req.body.asn_tags || []).some((tag) => !tagIds.has(String(tag)))) return res.status(400).json({ error: 'Select configured ASN tags.' });
      if (req.body.asn_no && await findOne('grn', { asn_no: req.body.asn_no })) return res.status(409).json({ error: 'ASN No. already exists.' });
      return res.status(201).json(await insert('grn', payload(req.body)));
    }
    if (req.method === 'PUT') {
      const current = await findOne('grn', { id: Number(req.body.id) }); if (!current) return res.status(404).json({ error: 'ASN not found.' });
      if (!current.asn_no || current.inbound_no || current.grn_no || Number(current.received_qty || 0) > 0
          || current.central_request_id || current.central_receipt_status
          || ['Central Receipt Pending', 'Receipt Blocked'].includes(current.status)) {
        return res.status(409).json({ error: 'This record is an inbound receipt, not an editable ASN. Reconcile it in the receipt workflow.' });
      }
      if (Number(req.body.row_version || 0) !== Number(current.row_version || 0)) return res.status(409).json({ error: 'ASN was changed by another user. Reload and try again.' });
      const merged = { ...current, ...req.body }; const error = validate(merged); if (error) return res.status(400).json({ error });
      if ((current.lines || []).some((line) => Number(line.rcvd_qty || 0) > 0) &&
          (merged.lines.length !== current.lines.length || merged.lines.some((line, index) => line.sku_code !== current.lines[index].sku_code))) {
        return res.status(409).json({ error: 'ASN lines with recorded receipts cannot be replaced or reordered.' });
      }
      if (merged.client_id && !(await clientPairs()).some(([code]) => code === String(merged.client_id))) return res.status(400).json({ error: 'Select a configured client.' });
      const tagIds = new Set((await find('generic_records', { module: 'asn-tag-definition' })).map((tag) => tag.code));
      if ((merged.asn_tags || []).some((tag) => !tagIds.has(String(tag)))) return res.status(400).json({ error: 'Select configured ASN tags.' });
      const operation = String(req.body.operation || current.status_code || '1');
      if (operation === '4' && !['1', '4'].includes(String(current.status_code || '1'))) return res.status(409).json({ error: `Cannot confirm ASN in ${current.status} status.` });
      const saved = await transitionGrnDraft(current, payload({ ...merged, operation }, current),
        { row_version: current.row_version ?? null, inbound_no: null, asn_no: current.asn_no });
      if (!saved) return res.status(409).json({ error: 'ASN changed while it was being edited. Reload it before retrying.' });
      return res.status(200).json(saved);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('Manage ASN API error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message || 'Unable to process ASN' }); }
}
