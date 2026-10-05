import { sendDatabaseUnavailable, cors, find, findOne, insert, update } from './mongo.js';

const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const zoneTypeText = (value) => ({ '1': 'Normal', '3': 'Drop Zone', '4': 'Pack Station', Normal: 'Normal', 'Drop Zone': 'Drop Zone', 'Pack Station': 'Pack Station' }[text(value)] || text(value));
const normalize = (row) => ({
  ...row,
  zone_code: row.zone_code || row.code || '',
  descr: row.descr || row.description || row.name || '',
  pick_to_bin: row.pick_to_bin || row.pickto_loc || '',
  kit_to_bin: row.kit_to_bin || row.kitto_loc || '',
  qc_bin: row.qc_bin || '',
  status: row.status || 'Active',
  location: row.location || row.loc_code || '',
  order_types: Array.isArray(row.order_types) ? row.order_types : text(row.order_types).split(',').map(text).filter(Boolean),
  created_by: row.created_by || 'super admin',
  created_date: row.created_date || '',
  modified_by: row.modified_by || '',
  modified_date: row.modified_date || '',
  zone_type: zoneTypeText(row.zone_type || '1'),
  let_down_bin: row.let_down_bin || '',
  drop_zone: row.drop_zone || '',
  default_bin: row.default_bin || '',
  linked_pickers: Array.isArray(row.linked_pickers) ? row.linked_pickers : text(row.linked_pickers).split(',').map(text).filter(Boolean),
});

async function metadata() {
  const generic = await find('generic_records', {});
  const bins = generic.filter((row) => ['bin-enquiry', 'bin-create-edit'].includes(row.module)).map((row) => row.code).filter(Boolean);
  const locations = generic.filter((row) => row.module === 'location').map((row) => ({ code: row.code, name: row.name }));
  const pickers = generic.filter((row) => row.module === 'user-enquiry' && /picker/i.test(`${row.name} ${row.description}`)).map((row) => ({ user_id: row.code, name: row.name }));
  return { bins: [...new Set(bins)], locations, pickers };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') return res.status(200).json(await metadata());
    const body = req.body || {};
    if (req.method === 'POST' && body.REQ_SEARCH_FLAG) {
      let rows = (await find('generic_records', { module: 'wms-zone' })).map(normalize);
      rows = rows.filter((row) => has(row.zone_code, body.zoneCode) && has(row.descr, body.descr) && has(row.pick_to_bin, body.picktoLoc) && has(row.kit_to_bin, body.kittoLoc) && has(row.qc_bin, body.qcBin) && has(row.status, body.status === '1' ? 'Active' : body.status === '0' ? 'Inactive' : body.status) && has(row.location, body.locCode) && has(row.zone_type, zoneTypeText(body.zoneType)) && has(row.let_down_bin, body.letDownBin));
      const direction = text(body.sord) === 'desc' ? -1 : 1;
      rows.sort((a, b) => text(a.zone_code).localeCompare(text(b.zone_code)) * direction);
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20, page = Math.max(1, Number(body.page) || 1), records = rows.length, total = Math.ceil(records / size), gridModel = rows.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, zoneDTOList: gridModel, rows: size, page, records, total });
    }
    if (req.method === 'POST' && body.action === 'save') {
      const zoneCode = text(body.zoneCode).toUpperCase();
      if (!zoneCode) return res.status(400).json({ error: 'Please enter the valid zone code.' });
      if (!/^[A-Z0-9]+$/.test(zoneCode)) return res.status(400).json({ error: 'Please enter AlphaNumerics only' });
      if (zoneCode.length > 10) return res.status(400).json({ error: 'Zone Code cannot exceed 10 characters.' });
      if (text(body.descr).length > 100) return res.status(400).json({ error: 'Zone Description cannot exceed 100 characters.' });
      if (!text(body.locCode)) return res.status(400).json({ error: 'Please select location.' });
      const existing = (await find('generic_records', { module: 'wms-zone' })).find((row) => text(row.code).toUpperCase() === zoneCode);
      if (existing) return res.status(409).json({ error: 'Zone Code already exists.' });
      const now = new Date().toISOString();
      const row = await insert('generic_records', { module: 'wms-zone', code: zoneCode, name: text(body.descr), description: text(body.descr), status: body.status === false ? 'Inactive' : 'Active', zone_type: zoneTypeText(body.zoneType || '1'), location: text(body.locCode), pick_to_bin: text(body.picktoLoc), kit_to_bin: text(body.kittoLoc), qc_bin: text(body.qcBin), let_down_bin: text(body.letDownBin), order_types: Array.isArray(body.orderTypes) ? body.orderTypes : [], drop_zone: text(body.dropZone), default_bin: text(body.defaultBin), linked_pickers: [], created_by: 'super admin', created_date: now, modified_by: '', modified_date: '' });
      return res.status(201).json({ row: normalize(row), message: 'Data saved successfully.' });
    }
    if (req.method === 'PUT' && body.action === 'save') {
      const current = await findOne('generic_records', { id: Number(body.id) });
      if (!current || current.module !== 'wms-zone') return res.status(404).json({ error: 'Zone was not found.' });
      const now = new Date().toISOString();
      const changed = await update('generic_records', current.id, { name: text(body.descr), description: text(body.descr), status: body.status === false ? 'Inactive' : 'Active', pick_to_bin: text(body.picktoLoc), kit_to_bin: text(body.kittoLoc), qc_bin: text(body.qcBin), let_down_bin: text(body.letDownBin), order_types: Array.isArray(body.orderTypes) ? body.orderTypes : [], drop_zone: text(body.dropZone), default_bin: text(body.defaultBin), modified_by: 'super admin', modified_date: now });
      return res.status(200).json({ row: normalize(changed[0]), message: 'Data saved successfully.' });
    }
    if (req.method === 'PUT' && ['link-pickers', 'unlink-pickers'].includes(body.action)) {
      const current = await findOne('generic_records', { id: Number(body.id) });
      if (!current || current.module !== 'wms-zone') return res.status(404).json({ error: 'Zone was not found.' });
      const requested = Array.isArray(body.pickers) ? body.pickers.map(text).filter(Boolean) : [];
      if (!requested.length) return res.status(400).json({ error: body.action === 'link-pickers' ? 'Please Select Picker' : 'Please Select a Row For UnLink' });
      const existing = normalize(current).linked_pickers;
      const linked = body.action === 'link-pickers' ? [...new Set([...existing, ...requested])] : existing.filter((picker) => !requested.includes(picker));
      const changed = await update('generic_records', current.id, { linked_pickers: linked, modified_by: 'super admin', modified_date: new Date().toISOString() });
      return res.status(200).json({ row: normalize(changed[0]), message: body.action === 'link-pickers' ? 'Picker Linked with Zone Successfully.' : 'Picker Unlinked Successfully' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('WMS Zone error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
