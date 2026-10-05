import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';

function normalizeAdditionalCharges(charges, poAmount) {
  return charges.map((charge) => {
    const operand = Number(charge.operand || 0);
    const chargeType = String(charge.charge_type || '');
    const calculated = chargeType === 'Percentage'
      ? Number((Number(poAmount || 0) * operand / 100).toFixed(2))
      : chargeType === 'Absolute' ? operand : Number(charge.charge || 0);
    return {
      charge_id: String(charge.charge_id || ''), charge_line_id: String(charge.charge_line_id || ''),
      charge_type: chargeType, charge_name: String(charge.charge_name || ''), operand, charge: calculated,
    };
  });
}

async function matchingOtb({ vendor_code, warehouse, po_date, line_items }) {
  const skuCodes = (line_items || []).map((line) => line.sku_code).filter(Boolean);
  if (!skuCodes.length) return [];
  const skus = await find('skus');
  const selected = skus.filter((sku) => skuCodes.includes(sku.sku_code));
  return (await find('otb_budgets')).filter((budget) => {
    if (budget.status !== 'Confirmed' || po_date < budget.start_date || po_date > budget.end_date) return false;
    if (budget.location && budget.location !== warehouse) return false;
    if (budget.vendor_code && budget.vendor_code !== vendor_code) return false;
    return selected.some((sku) => String(sku[budget.operand_type?.toLowerCase()] || sku.category || '').toLowerCase() === String(budget.operand || '').toLowerCase());
  });
}

async function enforceOtbAvailability(po) {
  const budgets = await matchingOtb(po);
  for (const budget of budgets) {
    const remaining = Number(budget.open_to_buy ?? Number(budget.total_budget) - Number(budget.consumed || 0));
    if (Number(po.amount) > remaining) throw Object.assign(new Error(`Budget exceeded for OTB ${budget.otb_id}. Remaining OpenToBuy is ${remaining.toFixed(2)}.`), { statusCode: 409 });
  }
  return budgets.length;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const { id, status } = req.query;
      if (id) {
        const row = await findOne('purchase_orders', { id: Number(id) });
        if (!row) return res.status(404).json({ error: 'Purchase Order not found' });
        return res.status(200).json(row);
      }
      const q = status ? { status } : {};
      return res.status(200).json(await find('purchase_orders', q, { sort: { id: -1 } }));
    }
    if (req.method === 'POST') {
      const { po_no, vendor, vendor_code, warehouse, source_location, po_date, expected_date, items, qty, amount, status, buyer_name, po_type, po_mode, release_date, recv_validation_code, external_po_no, reference_no, notes, discount_type, discount_value, currency_code, po_method, delivery_locations, source_order_no, line_items, allocation, udf, terms, comments, tags, additional_charges } = req.body;
      if (!po_no || !vendor || !warehouse || !po_date || !buyer_name || !recv_validation_code || !expected_date || !Number.isFinite(Number(qty)) || Number(qty) <= 0 || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
        return res.status(400).json({ error: 'Vendor, buyer, receiving validation code, expected delivery date, quantity and amount are required.' });
      }
      if (typeof po_no !== 'string' || !po_no.trim() || po_no.length > 100) return res.status(400).json({ error: 'Purchase Order number must be a nonempty string of at most 100 characters.' });
      if (reference_no && /[^a-zA-Z0-9 _-]/.test(reference_no)) return res.status(400).json({ error: 'Special characters are not allowed in Reference No.' });
      if (additional_charges && (!Array.isArray(additional_charges) || additional_charges.some((charge) => !Number.isFinite(Number(charge.operand)) || Number(charge.operand) < 0))) {
        return res.status(400).json({ error: 'Additional charge Amount must be zero or greater.' });
      }
      if (udf && (!Array.isArray(udf) || udf.some((value) => String(value ?? '').length > 50))) {
        return res.status(400).json({ error: 'Each PO UDF value must be 50 characters or fewer.' });
      }
      const normalizedUdf = Array.from({ length: 10 }, (_, index) => String(udf?.[index] ?? '').trim());
      const payload = {
        po_no: po_no.trim(), vendor, vendor_code: vendor_code || '', warehouse, po_date, expected_date, items, qty: Number(qty), amount: Number(amount), status: 'Pending Confirmation',
        buyer_name: buyer_name || 'System Buyer', po_type: po_type || 'Outright', po_mode: po_mode || '', source_location: source_location || '', release_date: release_date || po_date,
        recv_validation_code, external_po_no: external_po_no || '', reference_no: reference_no || '', notes: notes || '',
        discount_type: discount_type || 'Amount', discount_value: Number(discount_value || 0), currency_code: currency_code || 'INR',
        po_method: po_method || 'Single Location', delivery_locations: Array.isArray(delivery_locations) && delivery_locations.length ? delivery_locations : [warehouse],
        source_order_no: source_order_no || '', line_items: Array.isArray(line_items) ? line_items : [], allocation: Array.isArray(allocation) ? allocation : [],
        udf: normalizedUdf, terms: terms || '', comments: Array.isArray(comments) ? comments : [], tags: Array.isArray(tags) ? tags : [],
        additional_charges: Array.isArray(additional_charges) ? normalizeAdditionalCharges(additional_charges, amount) : [],
        revision_no: 0, revisions: [],
      };
      payload.otb_guarded = Boolean(await enforceOtbAvailability(payload));
      return res.status(201).json(await insert('purchase_orders', payload));
    }
    if (req.method === 'PUT') {
      const { id, action, ...fields } = req.body;
      const current = await findOne('purchase_orders', { id: Number(id) }); if (!current) return res.status(404).json({ error: 'Purchase Order not found' });
      if ('po_no' in fields && fields.po_no !== current.po_no) return res.status(409).json({ error: 'Purchase Order number is immutable.' });
      delete fields.otb_guarded;
      if ('status' in fields) {
        if (fields.status !== current.status) return res.status(409).json({ error: 'PO status can only change through a supported action.' });
        delete fields.status;
      }
      if ('udf' in fields) {
        if (!Array.isArray(fields.udf) || fields.udf.some((value) => String(value ?? '').length > 50)) {
          return res.status(400).json({ error: 'Each PO UDF value must be 50 characters or fewer.' });
        }
        fields.udf = Array.from({ length: 10 }, (_, index) => String(fields.udf[index] ?? '').trim());
      }
      if ('additional_charges' in fields) {
        if (!Array.isArray(fields.additional_charges)) return res.status(400).json({ error: 'Additional charges must be a list.' });
        if (fields.additional_charges.some((charge) => !Number.isFinite(Number(charge.operand)) || Number(charge.operand) < 0)) {
          return res.status(400).json({ error: 'Additional charge Amount must be zero or greater.' });
        }
        fields.additional_charges = normalizeAdditionalCharges(fields.additional_charges, fields.amount ?? current.amount);
      }
      if (action) {
        const allowed = {
          confirm: ['Pending Confirmation'], release: ['Confirmed', 'ReConfirmed'], reopen: ['Released'],
          reconfirm: ['ReOpen'], cancel: ['Released'], close: ['Released', 'Partially Received', 'Received'],
        };
        const next = { confirm: 'Confirmed', release: 'Released', reopen: 'ReOpen', reconfirm: 'ReConfirmed', cancel: 'Cancelled', close: 'Closed' };
        if (!allowed[action]?.includes(current.status)) return res.status(409).json({ error: `Cannot ${action} a Purchase Order in ${current.status} status.` });
        if ((action === 'confirm' || action === 'reconfirm') && (current.otb_guarded || await enforceOtbAvailability(current))) {
          return res.status(501).json({ error: 'OTB-backed PO confirmation requires an atomic budget reservation and PO status transaction.' });
        }
        fields.status = next[action];
        if (action === 'release') fields.release_date = new Date().toISOString().slice(0, 10);
      }
      if ('revision_reason' in fields) {
        if (current.status === 'Received') return res.status(409).json({ error: 'Received Purchase Orders cannot be revised.' });
        if (!String(fields.revision_reason || '').trim()) return res.status(400).json({ error: 'Revision reason is required.' });
        if (!Number.isFinite(Number(fields.qty)) || Number(fields.qty) <= 0 || !Number.isFinite(Number(fields.amount)) || Number(fields.amount) < 0) return res.status(400).json({ error: 'Revision quantity and amount must be valid.' });
        if (!fields.expected_date) return res.status(400).json({ error: 'Expected delivery date is required.' });
        const revisionNo = Number(current.revision_no || 0) + 1;
        const revision = {
          revision_no: revisionNo, revision_code: `${current.po_no}-R${revisionNo}`, reason: String(fields.revision_reason).trim(),
          revised_at: new Date().toISOString(),
          before: { qty: current.qty, amount: current.amount, expected_date: current.expected_date },
          after: { qty: Number(fields.qty), amount: Number(fields.amount), expected_date: fields.expected_date },
        };
        delete fields.revision_reason;
        fields.qty = Number(fields.qty);
        fields.amount = Number(fields.amount);
        fields.revision_no = revisionNo;
        fields.po_revision_code = revision.revision_code;
        fields.revision_date = revision.revised_at.slice(0, 10);
        fields.revisions = [...(current.revisions || []), revision];
      }
      if (!action && current.status === 'Pending Confirmation') {
        fields.otb_guarded = Boolean(current.otb_guarded || await enforceOtbAvailability({ ...current, ...fields }));
      }
      const rows = await update('purchase_orders', id, fields);
      return res.status(200).json(rows[0]);
    }
    if (req.method === 'DELETE') {
      return res.status(409).json({ error: 'Purchase Orders are preserved for audit and cannot be deleted.' });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Purchase Order number already exists.' });
    if (sendDatabaseUnavailable(res, err)) return; if (!err.statusCode || err.statusCode >= 500) console.error('API error:', { name: err?.name, code: err?.code }); res.status(err.statusCode || 500).json({ error: err.message }); }
}
