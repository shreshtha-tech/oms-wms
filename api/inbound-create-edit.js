import { isInboundQuantity, isInboundRow, isInboundRecordId, addInboundQuantities } from './inbound-quantity.js';
import { createHash, randomUUID } from 'node:crypto';
import { sendDatabaseUnavailable, cors, find, findOne, insert, transitionGrnReceipt } from './mongo.js';
import { ensureReceiptRequestIndex, transitionGrnDraft } from './inbound-receipt-guard.js';
import { activeLocations, clientPairs } from './catalogs.js';
import { verifyCommittedCentralInboundStock } from '../inventory/wms-operations.js';
import { stageReceiptCommand } from '../inventory/receipt-bridge.js';

const text = value => String(value ?? '').trim();
const now = () => new Date().toISOString();
const line = row => ({
  skuCode: row.sku_code || row.skuCode || '',
  skuName: row.description || row.sku_desc || row.sku_name || row.skuName || '',
  poQty: Number(row.qty || row.po_qty || row.poQty || 0),
  rcvdUOMQty: Number(row.rcvdUOMQty || row.received_qty || 0),
  rcvdQty: Number(row.rcvdQty || row.received_qty || 0),
  invoiceQty: Number(row.invoiceQty || 0),
  binLoc: row.binLoc || row.bin || '',
  idCode: row.idCode || row.lpn || '',
  unitPrice: Number(row.unit_price || row.price || row.unitPrice || 0),
  lineAmount: Number(row.line_amount || row.amount || row.lineAmount || 0),
  lottable01: row.lottable01 || '', lottable02: row.lottable02 || '', lottable03: row.lottable03 || '',
  lottable04: row.lottable04 || '', lottable05: row.lottable05 || '', lottable06: row.lottable06 || '',
  serialNos: row.serialNos || [],
});
const normalize = row => ({
  ...row,
  inboundNo: row.inbound_no || row.grn_no,
  poNo: row.po_no || '',
  createdDate: row.created_date || row.grn_date || '',
  status: row.status || 'Pending Confirmation',
  centralRequestId: row.central_request_id || '',
  centralReceiptStatus: row.central_receipt_status || '',
  lines: (row.lines || []).map(line),
});
const receivedLines = lines => {
  const quantities = new Map();
  for (const row of lines) {
    const skuCode = text(row.skuCode || row.sku_code);
    const quantity = Number(row.rcvdUOMQty ?? row.rcvdQty ?? 0);
    if (quantity > 0) quantities.set(skuCode, addInboundQuantities(quantities.get(skuCode) || 0, quantity));
  }
  return [...quantities.entries()].map(([skuCode, quantity]) => ({ skuCode, quantity })).sort((a, b) => a.skuCode.localeCompare(b.skuCode));
};
const receiptFingerprint = (poNo, locationCode, lines) => createHash('sha256')
  .update(JSON.stringify({ poNo, locationCode, lines })).digest('hex');
const legacyRealtimeFingerprint = (poNo, locationCode, lines) => createHash('sha256')
  .update(JSON.stringify({ poNo, locationCode, received: lines })).digest('hex');

async function findExistingInbound(body, requestId) {
  if (body.id) {
    const row = await findOne('grn', { id: Number(body.id) });
    if (!row) return { error: 'Inbound record not found.' };
    if (text(row.po_no) !== text(body.poNo)) return { error: 'Inbound PO cannot be changed.', status: 409 };
    return { row };
  }
  if (requestId) return { row: await findOne('grn', { central_request_id: requestId }) };
  return { row: null };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  let pendingReceipt = null;
  try {
    const body = req.body || {};
    if (req.method === 'GET') {
      const [purchaseOrders, clients] = await Promise.all([find('purchase_orders'), clientPairs()]);
      if (req.query?.inboundNo) {
        const row = (await find('grn')).find(item => [item.inbound_no, item.grn_no].includes(req.query.inboundNo));
        if (!row) return res.status(404).json({ error: 'Inbound record not found.' });
        return res.json(normalize(row));
      }
      return res.json({
        clients,
        purchaseOrders: purchaseOrders.map(po => ({
          id: po.id, poNo: po.po_no, externalPoNo: po.external_po_no || po.po_no,
          poQty: (po.line_items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0),
          vendor: po.vendor, vendorCode: po.vendor_code || '',
          lastModifiedDate: po.modified_date || po.created_date || '',
          warehouse: po.warehouse,
          status: po.status || '',
          lineCount: (po.line_items || []).length,
        })),
        importTypes: [['-1', '--- Select ---']], maxImportRows: 200, pickerPageSizes: [10, 20, 30, 50],
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

    if (body.action === 'po-search') {
      const orders = await find('purchase_orders');
      const items = orders.map(po => ({
        id: po.id, poNo: po.po_no, externalPoNo: po.external_po_no || po.po_no,
        poQty: (po.line_items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0),
        vendor: po.vendor, lastModifiedDate: po.modified_date || po.created_date || '',
        status: po.status || '', warehouse: po.warehouse,
      })).filter(row => (!text(body.poNo) || text(row.poNo).toLowerCase().includes(text(body.poNo).toLowerCase()))
        && (!text(body.externalPoNo) || text(row.externalPoNo).toLowerCase().includes(text(body.externalPoNo).toLowerCase()))
        && (!text(body.vendor) || text(row.vendor).toLowerCase().includes(text(body.vendor).toLowerCase()))
        && (!text(body.status) || text(body.status) === '-1' || row.status === body.status)
        && (!text(body.warehouse) || text(row.warehouse).toLowerCase().includes(text(body.warehouse).toLowerCase())));
      const size = [10, 20, 30, 50].includes(+body.rows) ? +body.rows : 20;
      const page = Math.max(1, +body.page || 1), records = items.length, total = Math.ceil(records / size);
      const rows = items.slice((page - 1) * size, page * size);
      return res.json({ poList: rows, rows, page, records, total });
    }

    if (body.action === 'po') {
      if (!text(body.poNo)) return res.status(400).json({ error: 'PO No is mandatory.' });
      const po = await findOne('purchase_orders', { po_no: text(body.poNo) });
      if (!po) return res.status(404).json({ error: 'PO not found.' });
      return res.json({
        poNo: po.po_no, vendor: po.vendor, vendorCode: po.vendor_code || '', warehouse: po.warehouse,
        createdDate: po.created_date || '', lines: (po.line_items || []).map(line),
      });
    }

    if (body.action === 'import') {
      if (!Array.isArray(body.rows) || !body.rows.length) return res.status(400).json({ error: 'Nothing To Import.' });
      if (body.rows.length > 200) return res.status(400).json({ error: 'Max 200 lines are allowed at a time.' });
      if (body.rows.some(item => !isInboundRow(item))) return res.status(400).json({ error: 'Each import row must be an object.' });
      if (!text(body.poNo)) return res.status(400).json({ error: 'PO No is mandatory.' });
      const po = await findOne('purchase_orders', { po_no: text(body.poNo) });
      if (!po) return res.status(404).json({ error: 'PO not found.' });
      const allowed = new Map((po.line_items || []).map(item => [text(item.sku_code || item.skuCode), line(item)]));
      const seen = new Set();
      const rows = body.rows.map((item, index) => {
        const skuCode = text(item.sku_code || item.skuCode);
        const quantity = item.rcvdUOMQty ?? item.received_qty ?? item.qty;
        let errorDescription = !skuCode ? 'SKU Code is mandatory.' : !allowed.has(skuCode) ? 'SKU is not on the selected PO.'
          : seen.has(skuCode) ? 'Duplicate SKU in import.'
            : !isInboundQuantity(quantity, 1) ? 'Received Qty must be a positive whole number.' : '';
        seen.add(skuCode);
        return { ...(allowed.get(skuCode) || line(item)), skuCode, rcvdUOMQty: Number(quantity), rcvdQty: Number(quantity), seqNo: index + 1,
          status: errorDescription ? 'Failed' : 'Success', errorDescription };
      });
      return res.json({ DTOList: rows, totalItems: rows.length, successItems: rows.filter(row => row.status === 'Success').length,
        failedItems: rows.filter(row => row.status === 'Failed').length, inProcessItems: 0 });
    }

    if (!['save', 'confirm'].includes(body.action)) return res.status(400).json({ error: 'Invalid action.' });
    if (!isInboundRecordId(body.id)) return res.status(400).json({ error: 'Inbound ID must be a positive safe integer, or zero for a new draft.' });
    if (!text(body.poNo)) return res.status(400).json({ error: 'PO No is mandatory.' });
    if (!Array.isArray(body.lines) || !body.lines.length) return res.status(400).json({ error: 'Please add at least one SKU.' });
    if (body.lines.some(row => !isInboundRow(row))) return res.status(400).json({ error: 'Each inbound line must be an object.' });
    if (body.lines.some(row => !text(row.skuCode))) return res.status(400).json({ error: 'SKU Code is mandatory.' });
    const po = await findOne('purchase_orders', { po_no: text(body.poNo) });
    if (!po) return res.status(404).json({ error: 'PO not found.' });
    const allowed = new Map();
    for (const item of po.line_items || []) {
      const skuCode = text(item.sku_code || item.skuCode), quantity = Number(item.qty ?? item.po_qty ?? item.poQty);
      if (skuCode) allowed.set(skuCode, addInboundQuantities(allowed.get(skuCode) || 0, quantity));
    }
    if (body.lines.some(row => !allowed.has(text(row.skuCode)))) return res.status(400).json({ error: 'SKU is not on the selected PO.' });
    if (body.lines.some(row => !isInboundQuantity(row.rcvdUOMQty ?? row.rcvdQty ?? 0))) {
      return res.status(400).json({ error: 'Received quantity must be a whole number of zero or more.' });
    }
    if (text(body.remarks).length > 250) return res.status(400).json({ error: 'Remarks exceed the 250 character limit.' });
    const linesToReceive = receivedLines(body.lines);
    if (body.action === 'confirm' && !linesToReceive.length) return res.status(400).json({ error: 'Received Qty is mandatory.' });
    const requestId = text(body.requestId);
    if (body.action === 'confirm' && !/^[A-Za-z0-9-]{1,120}$/.test(requestId)) {
      return res.status(400).json({ error: 'A stable request ID is required to confirm an inbound receipt.' });
    }
    if (body.action === 'confirm') await ensureReceiptRequestIndex();
    const existingResult = await findExistingInbound(body, requestId);
    if (existingResult.error) return res.status(existingResult.status || 404).json({ error: existingResult.error });
    const existing = existingResult.row;
    if (existing?.asn_no && !existing.inbound_no) {
      return res.status(409).json({ error: 'The selected record is an ASN, not an inbound draft. Create and save an inbound draft before receiving stock.' });
    }
    if (existing?.status === 'Cancelled') return res.status(409).json({ error: 'Cancelled inbound records cannot be edited or confirmed.' });
    if (existing?.status === 'Confirmed' && !existing.central_request_id) {
      return res.status(409).json({ error: 'This legacy inbound is already confirmed but has no Central Inventory receipt marker. Reconcile it before changing or receiving it again.' });
    }
    if (existing?.central_request_id && existing.central_request_id !== requestId && existing.central_receipt_status !== 'blocked') {
      return res.status(409).json({ error: 'This inbound already has a pending receipt request. Retry with its original request ID.' });
    }

    const locationInput = text(body.warehouse || po.warehouse);
    const configuredLocation = (await activeLocations()).find(location => location.code === locationInput || location.name === locationInput);
    if (body.action === 'confirm' && !configuredLocation) {
      return res.status(409).json({ error: 'The inbound warehouse must match an active configured location before Central Inventory can receive stock.' });
    }
    const locationCode = configuredLocation?.code || locationInput;
    const fingerprint = receiptFingerprint(text(body.poNo), locationCode, linesToReceive);
    const legacyFingerprint = legacyRealtimeFingerprint(text(body.poNo), locationCode, linesToReceive);
    if (existing?.central_receipt_fingerprint && ![fingerprint, legacyFingerprint].includes(existing.central_receipt_fingerprint) && existing.central_receipt_status !== 'blocked') {
      return res.status(409).json({ error: 'This request ID was already staged with different SKU quantities or a different warehouse. Load the staged inbound and retry it unchanged.' });
    }
    const alreadyCommitted = existing?.status === 'Confirmed' && existing.central_receipt_status === 'committed';
    if (alreadyCommitted) {
      await verifyCommittedCentralInboundStock({ requestId, inboundNo: existing.inbound_no || existing.grn_no,
        poNo: text(body.poNo), locationCode, lines: linesToReceive, eventIds: existing.central_receipt_event_ids });
      return res.json({ jsonMessage: 'Inbound receipt is already committed to Central Inventory.', row: normalize(existing) });
    }
    if (body.action === 'confirm' && !['Released', 'Partially Received'].includes(po.status)) {
      return res.status(409).json({ error: `Purchase Order must be released before receiving stock (current status: ${po.status || 'unknown'}).` });
    }
    const validateReceiptRemaining = async () => {
      const previouslyReceived = new Map();
      for (const record of await find('grn')) {
        if (record.id === existing?.id || text(record.po_no) !== text(body.poNo) || text(record.status) !== 'Confirmed') continue;
        for (const received of receivedLines(record.lines || [])) {
          previouslyReceived.set(received.skuCode, addInboundQuantities(previouslyReceived.get(received.skuCode) || 0, received.quantity));
        }
      }
      for (const received of linesToReceive) {
        const remaining = Number(allowed.get(received.skuCode)) - Number(previouslyReceived.get(received.skuCode) || 0);
        if (received.quantity > remaining) throw Object.assign(new Error(`Received quantity for ${received.skuCode} exceeds the remaining PO quantity (${Math.max(0, remaining)}).`), { status: 409 });
      }
    };
    await validateReceiptRemaining();

    const timestamp = now();
    const inboundNo = existing?.inbound_no || existing?.grn_no || `INB${Date.now().toString().slice(-9)}${randomUUID().slice(0, 4).toUpperCase()}`;
    const receivedQty = body.lines.reduce((sum, row) => addInboundQuantities(sum, row.rcvdUOMQty ?? row.rcvdQty ?? 0), 0);
    const fields = {
      po_no: text(body.poNo), vendor: text(body.vendor || po.vendor), warehouse: locationInput,
      invoice_no: text(body.invoiceNo), invoice_date: text(body.invoiceDate), invoice_amount: Number(body.invoiceAmount) || 0,
      challan_no: text(body.challanNo), material_received_date: text(body.materialReceivedDate), remarks: text(body.remarks),
      lines: body.lines, received_qty: receivedQty, modified_date: timestamp,
    };

    if (body.action === 'save') {
      if (existing?.central_receipt_status === 'pending') return res.status(409).json({ error: 'This inbound has a staged Central Inventory receipt; retry its original confirmation instead of editing it.' });
      if (existing?.status === 'Confirmed') return res.status(409).json({ error: 'Confirmed inbounds cannot be edited.' });
      const draft = { ...fields, status: 'Pending Confirmation', status_code: 1 };
      if (existing) {
        const saved = await transitionGrnDraft(existing, draft);
        if (!saved) return res.status(409).json({ error: 'Inbound changed while it was being edited. Reload it before retrying.' });
        return res.json({ jsonMessage: 'Inbound saved successfully.', row: normalize(saved) });
      }
      const created = await insert('grn', { ...draft, draft_revision: 1, inbound_no: inboundNo, grn_no: inboundNo, created_date: timestamp, grn_date: timestamp.slice(0, 10) });
      return res.status(201).json({ jsonMessage: 'Inbound saved successfully.', row: normalize(created) });
    }

    const stagedFields = {
      ...fields, status: 'Central Receipt Pending', status_code: 2,
      central_request_id: requestId, central_receipt_fingerprint: fingerprint,
      central_receipt_status: 'pending',
    };
    const staged = await stageReceiptCommand({
      existing, fields: { ...stagedFields, ...(existing ? {} : { created_date: timestamp, grn_date: timestamp.slice(0, 10) }) },
      requestId, fingerprint, inboundNo, poNo: text(body.poNo), locationCode, lines: linesToReceive, source: 'wms_inbound_create_edit',
    });
    pendingReceipt = null;
    return res.status(202).json({
      jsonMessage: 'Inbound receipt queued for Central Inventory. Check the receipt status before treating stock as received.',
      row: normalize(staged),
    });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Inbound Create/Edit error:', { name: error?.name, code: error?.code });
    if (pendingReceipt && error.safeToEdit) {
      try {
        const blocked = await transitionGrnReceipt(pendingReceipt.id,
          { status: 'Central Receipt Pending', central_request_id: pendingReceipt.central_request_id, central_receipt_status: 'pending' },
          { status: 'Receipt Blocked', status_code: 3, central_receipt_status: 'blocked', central_receipt_error: text(error.message).slice(0, 250) });
        pendingReceipt = blocked || pendingReceipt;
      } catch { /* keep the original pending receipt available for an unchanged retry */ }
    }
    const status = error.code === 11000 ? 409 : error.statusCode || error.status || (error.code || /database|connection/i.test(error.message || '') ? 503 : 500);
    return res.status(status).json({ error: error.message || 'Inbound operation failed.',
      ...(pendingReceipt ? { receiptPending: normalize(pendingReceipt), receiptCanBeEdited: Boolean(error.safeToEdit) } : {}) });
  }
}
