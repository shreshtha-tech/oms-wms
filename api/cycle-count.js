import { sendDatabaseUnavailable, cors, find, findOne, update } from './mongo.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const types = [['-1', '--- Select ---'], ['1', 'Bin'], ['2', 'LPN']];
const statuses = [['-1', '--- Select ---'], ['21', 'Pending'], ['5', 'Adjustment Required'], ['22', 'Awaiting Verification'], ['7', 'Canceled'], ['20', 'Closed'], ['4', 'Confirmed'], ['17', 'Error'], ['15', 'Partial Posted'], ['10', 'Pending For Post'], ['24', 'Recount Confirmed'], ['23', 'Recount WIP'], ['1', 'WIP']];
const norm = row => ({
  id: row.id, cycleID: row.code || row.cycle_id || '', type: row.cycle_type || 'Bin', typeCode: row.cycle_type_code || '1',
  status: row.status || 'WIP', statusCode: String(row.status_code || '1'), createDate: row.created_date || '',
  updatedDate: row.modified_date || row.created_date || '', bin: row.bin || '', lpn: row.lpn || '',
  user: row.updated_by || '', scannedStock: Number(row.scanned_stock || 0), reason: row.reason || '',
  waveFilter: row.wave_filter || '', taskId: row.task_id || '', totalSkuScan: Number(row.total_sku_scan || 0),
  totalQtyScan: Number(row.total_qty_scan || 0), lastSkuScan: row.last_sku_scan || '',
});

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    if (req.method === 'GET') return res.json({
      types, statuses, pageSizes: [20, 50, 100, 200], bins: [], lpns: [],
      available: false,
      message: 'Bin/LPN cycle counts are paused until those identities and count variances are mapped to Central Inventory.',
    });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (body.action === 'search') {
      const raw = await find('generic_records', { module: 'cycle-count' });
      let rows = raw.map(norm).filter(row => has(row.cycleID, body.cycleID) && has(row.typeCode, body.type)
        && has(row.statusCode, body.status) && has(row.bin, body.bin) && has(row.lpn, body.lpn)
        && has(row.user, body.user) && has(row.reason, body.reason) && has(row.taskId, body.taskId)
        && (!text(body.createDate) || has(row.createDate, body.createDate))
        && (!text(body.updatedDate) || has(row.updatedDate, body.updatedDate)));
      rows.sort((a, b) => text(a.updatedDate).localeCompare(text(b.updatedDate)) * (body.sord === 'asc' ? 1 : -1));
      const size = [20, 50, 100, 200].includes(+body.rows) ? +body.rows : 20;
      const page = Math.max(1, +body.page || 1), records = rows.length, total = Math.ceil(records / size);
      return res.json({ rows: rows.slice((page - 1) * size, page * size), page, total, records, sidx: body.sidx || 'updDate', sord: body.sord || 'desc' });
    }
    if (['create', 'confirm', 'post'].includes(body.action)) {
      return res.status(501).json({ error: 'Cycle count create, confirmation, and posting are paused until counted SKU/location variances can be recorded through Central Inventory.' });
    }
    if (body.action === 'cancel') {
      if (!Array.isArray(body.ids) || !body.ids.length) return res.status(400).json({ error: 'Please select a row.' });
      const timestamp = new Date().toISOString();
      for (const id of body.ids) {
        const row = await findOne('generic_records', { id: +id, module: 'cycle-count' });
        if (row) await update('generic_records', row.id, { status: 'Canceled', status_code: 7, modified_date: timestamp });
      }
      return res.json({ jsonMessage: 'Cycle Count canceled successfully' });
    }
    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
}
