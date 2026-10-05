import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';

const STATUS = { '1': 'Pending', '4': 'Confirmed', '7': 'Cancelled' };
const clean = (value) => String(value ?? '').trim();

function validate(body) {
  if (!clean(body.vendorCode)) return 'Please select vendor code';
  if (!clean(body.promoCode)) return 'Please enter Promo Code.';
  if (!clean(body.promoName)) return 'Please enter Promo Name.';
  if (clean(body.promoType) !== '1') return 'Please select Promotion Type.';
  if (!clean(body.startDate)) return 'Please select Start date.';
  if (!clean(body.endDate)) return 'Please select End date.';
  if (new Date(body.startDate) > new Date(body.endDate)) return 'End Date cannot be less than StartDate';
  if (!Array.isArray(body.lines) || !body.lines.length) return 'Please enter details for promotion';
  if (!body.linkToAll && (!Array.isArray(body.locations) || !body.locations.length)) return 'Please enter details for location';
  for (const line of body.lines) {
    if (!clean(line.conditionOn) || clean(line.conditionOn) === '-1') return 'Please select Condition Type.';
    if (clean(line.conditionOn) === '3' && !clean(line.conditionCode)) return 'SKU Code is Mandatory.';
    if (['1', '2'].includes(clean(line.conditionOn)) && !clean(line.conditionCode)) return clean(line.conditionOn) === '1' ? 'Please select a Parent hierarchy.' : 'Please select any Sub Level Hierarchy.';
    if (!(Number(line.skuQty) > 0)) return 'Please eneter SKU Qty.';
    if ((clean(line.freeSku) && !(Number(line.freeQty) > 0)) || (!clean(line.freeSku) && Number(line.freeQty) > 0)) return 'Please enter Free SKU with its free Qty.';
    if ((clean(line.discType) && !Number.isFinite(Number(line.discValue))) || (!clean(line.discType) && clean(line.discValue))) return 'Please select Discount Type and its value.';
    if (clean(line.discType) === '1' && Number(line.discValue) > 100) return 'Please enter discount value less than or equal 100';
    if (!clean(line.qtyFactor) || clean(line.qtyFactor) === '-1') return 'Please Select Quantity factor.';
  }
  return '';
}

function shape(body, current = {}) {
  const now = new Date().toISOString(); const status = clean(body.status || current.status || '1');
  return { discKey: current.discKey || clean(body.discKey), vendorCode: clean(body.vendorCode), vendorNameDesc: clean(body.vendorNameDesc), vendorCurrDesc: clean(body.vendorCurrDesc), promoCode: clean(body.promoCode), promoName: clean(body.promoName), promoType: '1', promoTypeText: 'Line Discount', startDate: clean(body.startDate), endDate: clean(body.endDate), status, statusText: STATUS[status] || 'Pending', lines: body.lines || [], locations: body.locations || [], linkToAll: Boolean(body.linkToAll), createdBy: current.createdBy || 'Local User', createDateText: current.createDateText || now, modifiedBy: 'Local User', modifiedDateText: now, rowVersion: Number(current.rowVersion || 0) + 1 };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const row = req.query.discKey ? await findOne('vendor_promotions', { discKey: clean(req.query.discKey) }) : null;
      if (!row) return res.status(404).json({ error: 'Vendor promotion not found.' });
      return res.status(200).json(row);
    }
    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const all = await find('vendor_promotions');
      const contains = (value, query) => !clean(query) || String(value || '').toLowerCase().includes(clean(query).toLowerCase());
      const filtered = all.filter((row) => (clean(req.body.delLocation) === '-1' || !clean(req.body.delLocation) || row.linkToAll || row.locations?.includes(clean(req.body.delLocation))) && contains(row.vendorCode, req.body.vendorCode) && contains(row.promoCode, req.body.promoCode) && contains(row.promoName, req.body.promoName) && (clean(req.body.promoType) === '-1' || !clean(req.body.promoType) || row.promoType === clean(req.body.promoType)) && (clean(req.body.status) === '-1' || !clean(req.body.status) || row.status === clean(req.body.status)) && (!clean(req.body.startDate) || row.startDate >= clean(req.body.startDate)) && (!clean(req.body.endDate) || row.endDate <= clean(req.body.endDate)));
      const rows = [20, 50, 100, 200].includes(Number(req.body.rows)) ? Number(req.body.rows) : 20; const page = Math.max(1, Number(req.body.page) || 1); const records = filtered.length; const total = Math.ceil(records / rows); const gridModel = filtered.sort((a, b) => Number(b.discKey) - Number(a.discKey)).slice((page - 1) * rows, page * rows);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
    }
    if (req.method === 'POST') {
      const error = validate(req.body); if (error) return res.status(400).json({ error });
      const current = clean(req.body.discKey) ? await findOne('vendor_promotions', { discKey: clean(req.body.discKey) }) : null;
      if (!current && (await find('vendor_promotions')).some((row) => row.promoCode.toLowerCase() === clean(req.body.promoCode).toLowerCase())) return res.status(409).json({ error: 'Promotion Code already exists.' });
      if (current && Number(req.body.rowVersion || 0) !== Number(current.rowVersion || 0)) return res.status(409).json({ error: 'Promotion was changed by another user. Reload and try again.' });
      const data = shape(req.body, current || {});
      if (current) return res.status(200).json((await update('vendor_promotions', current.id, data))[0]);
      const next = Math.max(0, ...(await find('vendor_promotions')).map((row) => Number(row.discKey) || 0)) + 1;
      return res.status(201).json(await insert('vendor_promotions', { ...data, discKey: String(next) }));
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('Vendor Promotions API error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message || 'Unable to process vendor promotion' }); }
}
