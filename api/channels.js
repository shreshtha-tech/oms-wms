import { sendDatabaseUnavailable, find, findOne, insert, update, remove, cors, actor } from './mongo.js';

const text = (value) => String(value ?? '').trim();
const percentageError = (value) => {
  const raw = text(value);
  if (!raw) return '';
  const percentage = Number(raw);
  return Number.isFinite(percentage) && percentage >= 0 && percentage <= 100
    ? ''
    : 'Channel Inventory Percentage must be a finite number between 0 and 100.';
};
const duplicateCode = async (channelCode, exceptId = null) => (await find('channels')).some((row) =>
  row.id !== exceptId && text(row.channel_code).toLowerCase() === text(channelCode).toLowerCase());

// Manage Channels / Channel Enquiry
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const rows = await find('channels', {}, { sort: { id: 1 } });
      return res.status(200).json(rows);
    }
    if (req.method === 'POST') {
      const b = req.body;
      if (b.REQ_SEARCH_FLAG) {
        let filters = {};
        try { filters = typeof b.vnfDataString === 'string' ? JSON.parse(b.vnfDataString) : (b.filters || {}); } catch { return res.status(400).json({ error: 'Invalid channel search filters.' }); }
        const has = (value, query) => !String(query ?? '').trim() || String(value ?? '').toLowerCase().includes(String(query).trim().toLowerCase());
        const status = String(filters.param4 ?? ''); const fulfilment = String(filters.param7 ?? '');
        const filtered = (await find('channels', {}, { sort: { id: -1 } })).filter((row) =>
          has(row.channel_code, filters.param1) && has(row.channel_name, filters.param2)
          && (!String(filters.param3 ?? '').trim() || String(filters.param3) === '-1' || String(row.client_id ?? '') === String(filters.param3))
          && (!status || status === '-1' || (status === '1' ? row.status === 'Active' : status === '0' ? ['inactive', 'in active'].includes(text(row.status).toLowerCase().replace(/\s+/g, '')) : has(row.status, status)))
          && has(row.channel_type, filters.param5) && has(row.brand_code || row.brand, filters.param8)
          && has(row.location, b.param6 ?? filters.param6) && (!fulfilment || fulfilment === '-1' || (fulfilment === '1' ? row.fulfilment_status === 'Online' : fulfilment === '0' ? row.fulfilment_status === 'Offline' : has(row.fulfilment_status, fulfilment)))
          && has(row.channel_group_code, filters.param17));
        const size = [20, 50, 100, 200].includes(Number(b.rows)) ? Number(b.rows) : 20;
        const page = Math.max(1, Number(b.page) || 1); const records = filtered.length; const total = Math.ceil(records / size);
        const gridModel = filtered.slice((page - 1) * size, page * size);
        return res.status(200).json({ commonSearchDTOList: gridModel, gridModel, rows: gridModel, page, records, total, sidx: String(b.sidx || ''), sord: String(b.sord || 'desc') });
      }
      const channelCode = text(b.channel_code); const channelName = text(b.channel_name);
      if (!channelCode || !channelName) return res.status(400).json({ error: 'Channel Code and Channel Name are required.' });
      const invalidPercentage = percentageError(b.inventory_percentage);
      if (invalidPercentage) return res.status(400).json({ error: invalidPercentage });
      if (await duplicateCode(channelCode)) return res.status(409).json({ error: 'Channel Code already exists.' });
      const { REQ_SEARCH_FLAG: _search, vnfDataString: _filters, key: _key, rows: _rows, page: _page, sidx: _sidx, sord: _sord, ...channelFields } = b;
      const now = new Date().toISOString();
      const doc = await insert('channels', {
        ...channelFields,
        channel_code: channelCode, channel_name: channelName,
        brand: b.brand || 'custom', channel_type: b.channel_type || 'Marketplace',
        fulfilment_status: b.fulfilment_status || 'Online', status: b.status || 'Active',
        location: b.location || '', brand_code: b.brand_code || '',
        registration_date: now,
        channel_configured: 'No',
        created_by: actor(req), created_date: now, updated_by: actor(req), updated_date: now,
      });
      return res.status(201).json(doc);
    }
    if (req.method === 'PUT') {
      const { id, ...fields } = req.body;
      const numericId = Number(id);
      if (!Number.isSafeInteger(numericId) || numericId < 1) return res.status(400).json({ error: 'A valid channel ID is required.' });
      const current = await findOne('channels', { id: numericId });
      if (!current) return res.status(404).json({ error: 'Channel not found.' });
      if (text(fields.channel_configured).toLowerCase() === 'yes') return res.status(409).json({ error: 'Channel Configured is set only after a verified seller connection.' });
      const nextCode = text(fields.channel_code ?? current.channel_code);
      const nextName = text(fields.channel_name ?? current.channel_name);
      if (!nextCode || !nextName) return res.status(400).json({ error: 'Channel Code and Channel Name are required.' });
      const invalidPercentage = percentageError(fields.inventory_percentage ?? current.inventory_percentage);
      if (invalidPercentage) return res.status(400).json({ error: invalidPercentage });
      if (await duplicateCode(nextCode, numericId)) return res.status(409).json({ error: 'Channel Code already exists.' });
      delete fields.created_by; delete fields.created_date; delete fields.updated_by; delete fields.updated_date;
      const now = new Date().toISOString();
      const rows = await update('channels', numericId, {
        ...fields, channel_code: nextCode, channel_name: nextName,
        updated_by: actor(req), updated_date: now,
      });
      return res.status(200).json(rows[0]);
    }
    if (req.method === 'DELETE') {
      const { id } = req.body;
      return res.status(200).json(await remove('channels', id));
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return;
    console.error('channels error:', { name: err?.name, code: err?.code });
    res.status(500).json({ error: err.message });
  }
}
