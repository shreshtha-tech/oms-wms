import { sendDatabaseUnavailable, cors, find, findOne, insert, update } from './mongo.js';
const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const normalize = (row) => ({ ...row, zone_code: row.zone_code || row.code || '', picker_id: row.picker_id || row.picker || row.name || '', zone_preference: row.zone_preference || row.description || '', status: row.status || 'Active', created_by: row.created_by || 'super admin', created_date: row.created_date || '', modified_by: row.modified_by || '', modified_date: row.modified_date || '' });
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    if (req.method === 'POST' && (body.REQ_SEARCH_FLAG || body.action === 'search')) {
      const requestedStatus = body.status === '1' ? 'Active' : body.status === '0' || body.status === 'InActive' ? 'Inactive' : body.status;
      let rows = (await find('generic_records', { module: 'picker-zone-pref' })).map(normalize).filter((row) => has(row.zone_code, body.zoneCode) && has(row.picker_id, body.pickerId) && has(row.zone_preference, body.zonePreference) && has(row.status, requestedStatus));
      rows.sort((a, b) => text(a.zone_code).localeCompare(text(b.zone_code)) * (text(body.sord) === 'desc' ? -1 : 1));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20, page = Math.max(1, Number(body.page) || 1), records = rows.length, total = Math.ceil(records / size), gridModel = rows.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, pickerZonePreferenceEnq: gridModel, rows: size, record: records, page, records, total });
    }
    if (req.method === 'POST' && body.action === 'import') {
      const rows = Array.isArray(body.rows) ? body.rows : []; let created = 0;
      for (const row of rows) { const zoneCode = text(row.zoneCode), pickerId = text(row.pickerId); if (!zoneCode || !pickerId) continue; const duplicate = (await find('generic_records', { module: 'picker-zone-pref' })).some((item) => normalize(item).zone_code === zoneCode && normalize(item).picker_id === pickerId); if (duplicate) continue; await insert('generic_records', { module: 'picker-zone-pref', code: zoneCode, name: pickerId, description: text(row.zonePreference), zone_code: zoneCode, picker_id: pickerId, zone_preference: text(row.zonePreference), status: row.status === 'Inactive' ? 'Inactive' : 'Active', created_by: 'super admin', created_date: new Date().toISOString(), modified_by: '', modified_date: '' }); created++; }
      return res.status(201).json({ created });
    }
    if ((req.method === 'PUT') || (req.method === 'POST' && body.action === 'save')) {
      const current = await findOne('generic_records', { id: Number(body.id) }); if (!current || current.module !== 'picker-zone-pref') return res.status(404).json({ error: 'Picker Zone Preference was not found.' });
      if (!text(body.zoneCode)) return res.status(400).json({ error: 'Zone is mandatory.' }); if (!text(body.pickerId)) return res.status(400).json({ error: 'Picker Id is Mandatory' });
      const changed = await update('generic_records', current.id, { zone_preference: text(body.zonePreference), description: text(body.zonePreference), status: body.status === false || body.status === '0' ? 'Inactive' : 'Active', modified_by: 'super admin', modified_date: new Date().toISOString() });
      return res.status(200).json({ row: normalize(changed[0]), jsonMessage: 'Data saved successfully.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('Picker Zone Preference error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message }); }
}
