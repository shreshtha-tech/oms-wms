import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';

const clean = (value) => String(value ?? '').trim();
const requestPath = (req) => String(req.path || req.url || '').split('?')[0];
const parseGrid = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const path = requestPath(req);
    if (req.method === 'GET') {
      const row = await findOne('purchase_charge_masters', { chargeId: clean(req.query.chargeId) });
      if (!row) return res.status(404).json({ error: 'Purchase charge master not found.' });
      return res.status(200).json(row);
    }
    if (req.method === 'POST' && path.endsWith('/jsonPOChargeDetailGrid')) {
      const chargeId = clean(req.query.chargeId);
      const row = await findOne('purchase_charge_masters', { chargeId });
      if (!row) return res.status(404).json({ error: 'Purchase charge master not found.' });
      const size = Number(req.body.rows) || 20; const page = Math.max(1, Number(req.body.page) || 1); const records = row.charges.length; const total = Math.ceil(records / size);
      const gridModel = row.charges.slice((page - 1) * size, page * size);
      return res.status(200).json({ chargeId, clientId: row.clientId, name: row.name, chargeMasterDTO: row, chargeMasterDTOs: gridModel, gridModel, rows: size, page, records, total, jsonMessage: null });
    }
    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const all = await find('purchase_charge_masters');
      const query = clean(req.body.name).toLowerCase();
      const filtered = all.filter((row) => (!clean(req.body.chargeId) || clean(row.chargeId).includes(clean(req.body.chargeId)))
        && (!clean(req.body.clientId) || clean(row.clientId).includes(clean(req.body.clientId)))
        && (!query || clean(row.name).toLowerCase().includes(query)));
      const size = [20, 50, 100, 200].includes(Number(req.body.rows)) ? Number(req.body.rows) : 20;
      const page = Math.max(1, Number(req.body.page) || 1); const records = filtered.length; const total = Math.ceil(records / size);
      const ordered = filtered.sort((a, b) => Number(b.updatedDate || 0) - Number(a.updatedDate || 0));
      const gridModel = ordered.slice((page - 1) * size, page * size);
      return res.status(200).json({ chargeMasterDTOs: gridModel, gridModel, rows: gridModel, page, records, total, chargeMasterDetails: 'success' });
    }
    if (req.method === 'POST') {
      if (req.body?.action === 'remove-lines' || path.endsWith('/delUpdatePOCharges')) {
        const incoming = parseGrid(req.body.gridData ?? req.body.charges);
        const chargeId = clean(req.body.chargeId || incoming[0]?.chargeId);
        const current = await findOne('purchase_charge_masters', { chargeId });
        if (!current) return res.status(404).json({ error: 'Purchase charge master not found.' });
        const charges = incoming;
        const data = { ...current, charges: charges.map((line, index) => ({ chargeId: current.chargeId, chargeLineId: index + 1, chargeName: clean(line.chargeName), chargeType: clean(line.chargeType), chargeTypeTxt: clean(line.chargeType) === '2' ? 'Percentage' : 'Absolute', operand: Number(line.operand) })), updatedDate: Date.now() };
        const saved = (await update('purchase_charge_masters', current.id, data))[0];
        return res.status(200).json({ chargeMasterDTO: saved, chargeMasterDTOs: saved.charges, gridModel: saved.charges, actionMessage: 'Charge details removed successfully', jsonMessage: null });
      }
      const charges = parseGrid(req.body.gridData ?? req.body.charges);
      if (!clean(req.body.name)) return res.status(400).json({ error: 'Enter Name for Charge Master' });
      if (!charges.length) return res.status(400).json({ error: 'Please add charge data alongside creating Charge Master' });
      if (charges.length > 5) return res.status(400).json({ error: 'Maximum limit of parameters reached.' });
      for (const line of charges) {
        if (!clean(line.chargeName)) return res.status(400).json({ error: 'Enter Charge name' });
        if (!clean(line.chargeType)) return res.status(400).json({ error: 'Enter Charge Type' });
        if (clean(line.operand) === '' || !Number.isFinite(Number(line.operand))) return res.status(400).json({ error: 'Enter Operand' });
      }
      const all = await find('purchase_charge_masters'); const incomingChargeId = clean(req.body.chargeId || charges[0]?.chargeId); const current = incomingChargeId ? await findOne('purchase_charge_masters', { chargeId: incomingChargeId }) : null;
      if (!current && all.some((row) => clean(row.name).toLowerCase() === clean(req.body.name).toLowerCase())) return res.status(409).json({ error: 'Charge Master already exists.' });
      const chargeId = current?.chargeId || String(Math.max(0, ...all.map((row) => Number(row.chargeId) || 0)) + 1);
      const data = { chargeId, clientId: clean(req.body.clientId || '0'), name: clean(req.body.name), charges: charges.map((line, index) => ({ chargeId, chargeLineId: index + 1, chargeName: clean(line.chargeName), chargeType: clean(line.chargeType), chargeTypeTxt: clean(line.chargeType) === '2' ? 'Percentage' : 'Absolute', operand: Number(line.operand) })), updatedDate: Date.now() };
      const saved = current ? (await update('purchase_charge_masters', current.id, data))[0] : await insert('purchase_charge_masters', data);
      if (path.endsWith('/saveUpdatePOCharges')) return res.status(current ? 200 : 201).json({ chargeMasterDTO: saved, chargeMasterDTOs: saved.charges, gridModel: saved.charges, actionMessage: 'Charge Master saved successfully', jsonMessage: null });
      return res.status(current ? 200 : 201).json({ ...saved, actionMessage: 'Charge Master saved successfully' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('Purchase Charge Masters API error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message || 'Unable to process purchase charge master' }); }
}
