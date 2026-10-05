import { randomUUID, createHash } from 'node:crypto';
import { sendDatabaseUnavailable, cors, find, findOne, insert, transitionGrnReceipt } from './mongo.js';
import { ensureReceiptRequestIndex, transitionGrnDraft } from './inbound-receipt-guard.js';
import { activeLocations, clientPairs, locations } from './catalogs.js';
import { receiveCentralInboundStock, verifyCommittedCentralInboundStock } from '../inventory/wms-operations.js';

const text = value => String(value ?? '').trim();
const now = () => new Date().toISOString();
const types = ['With ASN', 'Direct Inbound', 'With Gate Pass', 'With PO', 'Return Inbound', 'With STO'];
const line = row => ({
  skuCode: row.sku_code || row.skuCode || '',
  skuDesc: row.sku_name || row.product_name || row.description || row.skuDesc || '',
  expQty: Number(row.expQty || row.qty || 0),
  rcvdQty: Number(row.rcvdQty ?? row.received_qty ?? 0),
  invoiceQty: Number(row.invoiceQty || 0),
  binLoc: row.binLoc || '',
  lpn: row.lpn || '',
  lotCode: row.lotCode || '',
  unitPrice: Number(row.unitPrice || row.unit_price || 0),
  mrp: Number(row.mrp || 0),
  lottable01: row.lottable01 || '', lottable02: row.lottable02 || '',
  lottable03: row.lottable03 || '', lottable04: row.lottable04 || '',
  lottable05: row.lottable05 || '', lottable06: row.lottable06 || '',
  serialNos: row.serialNos || [], udf: row.udf || Array(10).fill(''),
});
const normalize = row => ({
  ...row,
  inboundNo: row.inbound_no || row.grn_no,
  inboundType: row.inbound_type || 'Direct Inbound',
  processBy: row.process_by || 'scan',
  poNo: row.po_no || '', asnNo: row.asn_no || '', gatePassNo: row.gate_pass_no || '',
  stoNo: row.sto_no || '', returnNo: row.return_no || '',
  invoiceNo: row.invoice_no || '', invoiceDate: row.invoice_date || '',
  invoiceAmount: row.invoice_amount ?? '', challanNo: row.challan_no || '',
  centralRequestId: row.central_request_id || '',
  centralReceiptStatus: row.central_receipt_status || '',
  lines: (row.lines || []).map(line),
});
const reference = (body, type) => type === 'With PO' ? body.poNo
  : type === 'With ASN' ? body.asnNo
    : type === 'With Gate Pass' ? body.gatePassNo
      : type === 'With STO' ? body.stoNo
        : type === 'Return Inbound' ? body.returnNo : '';

function receivedLines(lines) {
  const totals = new Map();
  for (const row of lines) {
    const skuCode = text(row.skuCode || row.sku_code);
    const quantity = Number(row.rcvdQty ?? row.received_qty ?? 0);
    if (quantity > 0) totals.set(skuCode, (totals.get(skuCode) || 0) + quantity);
  }
  return [...totals.entries()].map(([skuCode, quantity]) => ({ skuCode, quantity }))
    .sort((a, b) => a.skuCode.localeCompare(b.skuCode));
}

const receiptFingerprint = (poNo, locationCode, received) => createHash('sha256')
  .update(JSON.stringify({ poNo, locationCode, lines: received })).digest('hex');
const legacyReceiptFingerprint = (poNo, locationCode, received) => createHash('sha256')
  .update(JSON.stringify({ poNo, locationCode, received })).digest('hex');

export default async function handler(req, res) {
  if (cors(req, res)) return;
  let pendingReceipt = null;
  try {
    const body = req.body || {};
    const grns = await find('grn');
    if (req.method === 'GET') {
      if (req.query?.inboundNo) {
        const row = grns.find(item => [item.inbound_no, item.grn_no].includes(req.query.inboundNo));
        if (!row) return res.status(404).json({ error: 'Inbound record not found' });
        return res.json(normalize(row));
      }
      const [purchaseOrders, asns, passes, products] = await Promise.all([
        find('purchase_orders'), find('grn'), find('generic_records', { module: 'inbound-gate-pass' }), find('products'),
      ]);
      return res.json({
        inboundTypes: types, processModes: ['scan', 'table'], clients: await clientPairs(), locations: await locations(),
        purchaseOrders: purchaseOrders.map(row => ({ id: row.id, code: row.po_no, name: row.vendor, warehouse: row.warehouse })),
        asns: asns.filter(row => row.asn_no).map(row => ({ id: row.id, code: row.asn_no, name: row.vendor, warehouse: row.warehouse })),
        gatePasses: passes.map(row => ({ id: row.id, code: row.igp_code || row.code, name: row.material_desc || row.name })),
        products: products.map(row => ({ id: row.id, skuCode: row.sku_code, skuDesc: row.product_name || row.sku_name, mrp: row.mrp || 0 })),
        maxImportRows: 2000, reversalPageSizes: [500, 1000],
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (body.action === 'scan') {
      if (!text(body.skuCode)) return res.status(400).json({ error: 'Please enter Sku Code.' });
      if (!text(body.binLoc)) return res.status(400).json({ error: 'Bin Location is mandatory' });
      if (!Number.isSafeInteger(Number(body.qty)) || Number(body.qty) <= 0) return res.status(400).json({ error: 'Qty must be a positive whole number.' });
      const product = (await find('products')).find(row => [row.sku_code, row.barcode]
        .some(value => text(value).toLowerCase() === text(body.skuCode).toLowerCase()));
      if (!product) return res.status(404).json({ error: 'Invalid SKU Code' });
      return res.json({ jsonMessage: null, row: line({
        ...product, skuCode: product.sku_code, skuDesc: product.product_name,
        rcvdQty: Number(body.qty), invoiceQty: Number(body.invoiceQty) || 0,
        binLoc: text(body.binLoc), lpn: text(body.lpn), lotCode: text(body.lotCode), ...body,
      }) });
    }

    if (body.action === 'load-reference') {
      const type = text(body.inboundType), ref = text(body.reference);
      if (!types.includes(type)) return res.status(400).json({ error: 'Inbound Type is mandatory' });
      if (type !== 'Direct Inbound' && !ref) return res.status(400).json({ error: `${type.replace('With ', '')} No is mandatory` });
      let source = null;
      if (type === 'With PO') source = await findOne('purchase_orders', { po_no: ref });
      else if (type === 'With ASN') source = grns.find(row => row.asn_no === ref);
      else if (type === 'With Gate Pass') {
        source = (await find('generic_records', { module: 'inbound-gate-pass' }))
          .find(row => (row.igp_code || row.code) === ref);
      }
      if (!source && ['With PO', 'With ASN', 'With Gate Pass'].includes(type)) {
        return res.status(404).json({ error: 'Reference not found' });
      }
      return res.json({
        inboundType: type, reference: ref, vendor: source?.vendor || source?.name || '',
        warehouse: source?.warehouse || '', lines: (source?.line_items || source?.lines || []).map(line),
      });
    }

    if (body.action === 'import') {
      return res.status(501).json({ error: 'Inbound RealTime import is unavailable until a verified file parser, PO validation, persistence, and Central Inventory receipt flow are connected. No import batch was created.' });
    }

    if (body.action === 'confirm') {
      const inboundType = text(body.inboundType);
      if (inboundType !== 'With PO') {
        return res.status(501).json({ error: 'Only PO-linked inbound receipts are connected to Central Inventory in this workflow. No stock or inbound status was changed.' });
      }
      if (!text(body.poNo)) return res.status(400).json({ error: 'PO No is mandatory' });
      if (!Array.isArray(body.lines) || !body.lines.length) return res.status(400).json({ error: 'Please Add Atleast One SKU' });
      if (body.lines.some(row => !text(row.skuCode || row.sku_code))) return res.status(400).json({ error: 'SKU Code is mandatory.' });
      if (body.lines.some(row => !Number.isSafeInteger(Number(row.rcvdQty ?? row.received_qty ?? 0)) || Number(row.rcvdQty ?? row.received_qty ?? 0) < 0)) {
        return res.status(400).json({ error: 'Received quantity must be a whole number of zero or more.' });
      }
      const linesToReceive = receivedLines(body.lines);
      if (!linesToReceive.length) return res.status(400).json({ error: 'Received Qty is mandatory.' });
      const po = await findOne('purchase_orders', { po_no: text(body.poNo) });
      if (!po) return res.status(404).json({ error: 'Purchase Order not found.' });
      const allowed = new Map();
      for (const item of po.line_items || []) {
        const skuCode = text(item.sku_code || item.skuCode);
        const quantity = Number(item.qty ?? item.po_qty ?? item.poQty);
        if (skuCode && Number.isSafeInteger(quantity) && quantity >= 0) allowed.set(skuCode, (allowed.get(skuCode) || 0) + quantity);
      }
      if (linesToReceive.some(row => !allowed.has(row.skuCode))) return res.status(400).json({ error: 'SKU is not on the selected PO.' });

      const requestId = text(body.requestId || body.centralRequestId);
      if (!/^[A-Za-z0-9-]{1,120}$/.test(requestId)) return res.status(400).json({ error: 'A stable Central Inventory receipt request ID is required.' });
      await ensureReceiptRequestIndex();
      let existing = null;
      if (body.id) {
        existing = await findOne('grn', { id: Number(body.id) });
        if (!existing) return res.status(404).json({ error: 'Inbound record not found.' });
        if (text(existing.po_no) !== text(body.poNo)) return res.status(409).json({ error: 'Inbound PO cannot be changed.' });
      } else if (body.inboundNo) {
        existing = grns.find(row => [row.inbound_no, row.grn_no].includes(text(body.inboundNo))) || null;
      }
      if (existing?.asn_no && !existing.inbound_no) {
        return res.status(409).json({ error: 'The selected record is an ASN, not an inbound draft. Create and save an inbound draft before receiving stock.' });
      }
      if (existing?.status === 'Confirmed' && !existing.central_request_id) {
        return res.status(409).json({ error: 'This legacy inbound is already confirmed but has no Central Inventory receipt marker. Reconcile it before retrying.' });
      }
      if (existing?.status === 'Cancelled') return res.status(409).json({ error: 'Cancelled inbound records cannot be confirmed.' });
      if (existing?.central_request_id && existing.central_request_id !== requestId && existing.central_receipt_status !== 'blocked') {
        return res.status(409).json({ error: 'This inbound already has a Central Inventory receipt request. Retry it with the original request ID.' });
      }

      const locationInput = text(body.warehouse || po.warehouse);
      const configuredLocation = (await activeLocations()).find(row => row.code === locationInput || row.name === locationInput);
      if (!configuredLocation) return res.status(409).json({ error: 'Inbound Location must match an active configured location before receiving Central Inventory stock.' });
      const locationCode = configuredLocation.code;
      const fingerprint = receiptFingerprint(text(body.poNo), locationCode, linesToReceive);
      const legacyFingerprint = legacyReceiptFingerprint(text(body.poNo), locationCode, linesToReceive);
      if (existing?.central_receipt_fingerprint && ![fingerprint, legacyFingerprint].includes(existing.central_receipt_fingerprint)
        && existing.central_receipt_status !== 'blocked') {
        return res.status(409).json({ error: 'This request ID was already staged with different SKU quantities or a different location. Retry the staged inbound unchanged.' });
      }
      const alreadyCommitted = existing?.status === 'Confirmed' && existing.central_receipt_status === 'committed';
      if (alreadyCommitted) {
        await verifyCommittedCentralInboundStock({ requestId, inboundNo: existing.inbound_no || existing.grn_no,
          poNo: text(body.poNo), locationCode, lines: linesToReceive, eventIds: existing.central_receipt_event_ids });
        return res.json({ jsonMessage: 'Inbound receipt is already committed to Central Inventory.', row: normalize(existing) });
      }
      if (!['Released', 'Partially Received'].includes(po.status)) {
        return res.status(409).json({ error: `Purchase Order must be released before receiving stock (current status: ${po.status || 'unknown'}).` });
      }
      const validateRemaining = async () => {
        const previouslyReceived = new Map();
        for (const record of await find('grn')) {
          if (record.id === existing?.id || text(record.po_no) !== text(body.poNo) || text(record.status) !== 'Confirmed') continue;
          for (const received of receivedLines(record.lines || [])) {
            previouslyReceived.set(received.skuCode, (previouslyReceived.get(received.skuCode) || 0) + received.quantity);
          }
        }
        for (const received of linesToReceive) {
          const remaining = Number(allowed.get(received.skuCode)) - Number(previouslyReceived.get(received.skuCode) || 0);
          if (received.quantity > remaining) {
            throw Object.assign(new Error(`Received quantity for ${received.skuCode} exceeds the remaining PO quantity (${Math.max(0, remaining)}).`), { status: 409 });
          }
        }
      };
      await validateRemaining();

      const timestamp = now();
      const inboundNo = existing?.inbound_no || existing?.grn_no || `RTI${Date.now().toString().slice(-9)}${randomUUID().slice(0, 4).toUpperCase()}`;
      const fields = {
        inbound_type: inboundType, process_by: body.processBy || 'scan', po_no: text(body.poNo),
        asn_no: text(body.asnNo), gate_pass_no: text(body.gatePassNo), sto_no: text(body.stoNo), return_no: text(body.returnNo),
        vendor: text(body.vendor || po.vendor), warehouse: locationInput,
        invoice_no: text(body.invoiceNo), invoice_date: text(body.invoiceDate), invoice_amount: Number(body.invoiceAmount) || 0,
        challan_no: text(body.challanNo), remarks: text(body.remarks), documents: body.documents || [],
        lines: body.lines, received_qty: body.lines.reduce((sum, row) => sum + Number(row.rcvdQty ?? row.received_qty ?? 0), 0),
        modified_date: timestamp,
      };
      const stagedFields = {
        ...fields, status: 'Central Receipt Pending', status_code: 2,
        central_request_id: requestId, central_receipt_fingerprint: fingerprint,
        central_receipt_status: 'pending',
      };
      let staged;
      if (existing?.central_receipt_status === 'pending' && existing.central_request_id === requestId) staged = existing;
      else if (existing) {
        staged = await transitionGrnDraft(existing, stagedFields);
        if (!staged) return res.status(409).json({ error: 'Inbound changed while receipt was being staged. Reload it before retrying.' });
      }
      else staged = await insert('grn', {
        ...stagedFields, draft_revision: 1, inbound_no: inboundNo, grn_no: inboundNo,
        created_date: timestamp, grn_date: timestamp.slice(0, 10),
      });
      pendingReceipt = staged;

      const receipt = await receiveCentralInboundStock({
        requestId, inboundNo, poNo: text(body.poNo), locationCode, lines: linesToReceive, allowedQuantities: allowed,
        source: 'wms_inbound_realtime', validate: validateRemaining,
        finalize: async result => {
          const saved = await transitionGrnReceipt(staged.id,
            { status: 'Central Receipt Pending', central_request_id: requestId, central_receipt_status: 'pending' }, {
            status: 'Confirmed', status_code: 4,
            central_receipt_status: 'committed', central_receipt_event_ids: result.eventIds,
            status_changed_date: now(),
          });
          if (!saved) {
            const current = await findOne('grn', { id: staged.id });
            if (current?.status === 'Confirmed' && current.central_request_id === requestId
              && current.central_receipt_status === 'committed' && current.central_receipt_fingerprint === fingerprint) return current;
            throw new Error('Central receipt committed but the inbound record could not be finalized. Retry with the same request ID.');
          }
          return saved;
        },
      });
      pendingReceipt = null;
      return res.status(existing ? 200 : 201).json({
        jsonMessage: receipt.duplicate ? 'Inbound receipt is already committed to Central Inventory.' : 'Inbound confirmed and received in Central Inventory.',
        row: normalize(receipt.finalizedRow),
      });
    }

    if (['save', 'save-invoice', 'cancel'].includes(body.action)) {
      const type = text(body.inboundType);
      if (!types.includes(type)) return res.status(400).json({ error: 'Inbound Type is mandatory' });
      if (body.action === 'save' && !['', 'Pending Confirmation', 'Receipt Blocked'].includes(text(body.status))) {
        return res.status(409).json({ error: 'A draft save cannot set a receipt status. Confirm the inbound through Central Inventory.' });
      }
      const ref = reference(body, type);
      if (type !== 'Direct Inbound' && !text(ref)) return res.status(400).json({ error: `${type.replace('With ', '')} No is mandatory` });
      if (!Array.isArray(body.lines) || (!body.lines.length && body.action !== 'save-invoice')) {
        return res.status(400).json({ error: 'Please Add Atleast One SKU' });
      }
      if (body.action === 'save-invoice' && !text(body.invoiceNo)) return res.status(400).json({ error: 'Invoice No is mandatory.' });
      const existing = body.id ? await findOne('grn', { id: Number(body.id) }) : null;
      if (body.id && !existing) return res.status(404).json({ error: 'Inbound record not found.' });
      if (existing?.asn_no && !existing.inbound_no) {
        return res.status(409).json({ error: 'The selected record is an ASN, not an inbound draft. Create and save an inbound draft before editing it.' });
      }
      if (existing?.status === 'Cancelled') return res.status(409).json({ error: 'Cancelled inbound records cannot be edited here.' });
      if (body.action === 'save-invoice') {
        if (!existing) return res.status(404).json({ error: 'Save the inbound before updating its invoice.' });
        if (existing.central_receipt_status === 'pending') return res.status(409).json({ error: 'This inbound has a pending Central Inventory receipt; retry it unchanged before updating invoice details.' });
        if (existing.status === 'Confirmed' || existing.central_receipt_status === 'committed') {
          return res.status(409).json({ error: 'A confirmed inbound invoice requires a separate authorized and audited correction workflow.' });
        }
        const fields = {
          invoice_no: text(body.invoiceNo), invoice_date: text(body.invoiceDate),
          invoice_amount: Number(body.invoiceAmount) || 0, modified_date: now(),
        };
        const saved = await transitionGrnDraft(existing, fields);
        if (!saved) return res.status(409).json({ error: 'Inbound changed while its invoice was being edited. Reload it before retrying.' });
        return res.json({ jsonMessage: 'Invoice details saved successfully.', row: normalize(saved) });
      }
      if (body.action === 'cancel' && !existing) return res.status(400).json({ error: 'Save the inbound before cancelling it.' });
      if (existing?.status === 'Confirmed' || existing?.central_receipt_status === 'pending' || existing?.central_receipt_status === 'committed') {
        return res.status(409).json({ error: 'Confirmed or staged inbound records cannot be edited or cancelled here.' });
      }
      const state = body.action === 'cancel' ? 'Cancelled' : 'Pending Confirmation';
      const fields = {
        inbound_type: type, process_by: body.processBy || 'scan', po_no: text(body.poNo),
        asn_no: text(body.asnNo), gate_pass_no: text(body.gatePassNo), sto_no: text(body.stoNo), return_no: text(body.returnNo),
        vendor: text(body.vendor), warehouse: text(body.warehouse), invoice_no: text(body.invoiceNo),
        invoice_date: text(body.invoiceDate), invoice_amount: Number(body.invoiceAmount) || 0,
        challan_no: text(body.challanNo), remarks: text(body.remarks), documents: body.documents || [],
        lines: body.lines || [], received_qty: (body.lines || []).reduce((sum, row) => sum + Number(row.rcvdQty || 0), 0),
        status: state, status_code: state === 'Cancelled' ? 7 : 1, modified_date: now(),
      };
      if (existing) {
        const saved = await transitionGrnDraft(existing, fields);
        if (!saved) return res.status(409).json({ error: 'Inbound changed while it was being edited. Reload it before retrying.' });
        return res.json({ jsonMessage: body.action === 'cancel' ? 'Inbound cancelled successfully' : 'Inbound saved successfully', row: normalize(saved) });
      }
      const inboundNo = `RTI${Date.now().toString().slice(-9)}${randomUUID().slice(0, 4).toUpperCase()}`;
      const created = await insert('grn', {
        ...fields, draft_revision: 1, inbound_no: inboundNo, grn_no: inboundNo,
        created_date: now(), grn_date: now().slice(0, 10),
      });
      return res.status(201).json({ jsonMessage: 'Inbound saved successfully', row: normalize(created) });
    }

    if (body.action === 'reverse') {
      return res.status(501).json({ error: 'Inbound reversal is unavailable until a compensating Central Inventory event and reversal audit are connected. No status or stock was changed.' });
    }
    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Inbound RealTime error:', { name: error?.name, code: error?.code });
    if (pendingReceipt && error.safeToEdit) {
      try {
        const blocked = await transitionGrnReceipt(pendingReceipt.id,
          { status: 'Central Receipt Pending', central_request_id: pendingReceipt.central_request_id, central_receipt_status: 'pending' }, {
          status: 'Receipt Blocked', status_code: 3, central_receipt_status: 'blocked',
          central_receipt_error: text(error.message).slice(0, 250),
        });
        pendingReceipt = blocked || pendingReceipt;
      } catch { /* preserve the original staged request for an unchanged retry */ }
    }
    const status = error.code === 11000 ? 409 : error.statusCode || error.status || (error.code || /database|connection/i.test(error.message || '') ? 503 : 500);
    return res.status(status).json({
      error: error.message || 'Inbound operation failed.',
      ...(pendingReceipt ? { receiptPending: normalize(pendingReceipt), receiptCanBeEdited: Boolean(error.safeToEdit) } : {}),
    });
  }
}
