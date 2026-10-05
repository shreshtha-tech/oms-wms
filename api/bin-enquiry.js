import { sendDatabaseUnavailable, cors, find } from './mongo.js';

const text = (value) => String(value ?? '').trim();
const contains = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const normalize = (row) => ({
  ...row,
  location: row.location || '',
  loc_code: row.loc_code || '',
  bin_code: row.bin_code || row.code || '',
  zone: row.zone || '',
  inv_bucket: row.inv_bucket || 'Good',
  bin_location_type: row.bin_location_type || 'Regular',
  approximate_units: Number(row.approximate_units ?? 0),
  // Bin-level balances are not mapped to Central Inventory yet. Never turn a
  // missing legacy value into a false zero-stock result.
  bin_qty: null,
  status: row.status || 'Active',
  commingle_lot: row.commingle_lot ? 'Yes' : 'No',
  commingle_item: row.commingle_item ? 'Yes' : 'No',
});

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    if (req.method !== 'POST' || (!body.REQ_SEARCH_FLAG && body.action !== 'search')) return res.status(405).json({ error: 'Method not allowed' });
    const unsupportedFlags = ['defRetBin', 'defRTOBin', 'defInbBin', 'defCrossDockBin', 'defUSNExcessBin'];
    const flagRequested = (value) => value === true || ['1', 'true', 'yes', 'y'].includes(text(value).toLowerCase());
    if (text(body.fromEmptyBins) || text(body.toEmptyBins) || unsupportedFlags.some((key) => flagRequested(body[key]))) {
      return res.status(501).json({ error: 'Empty-bin counts and default-bin filters are unavailable until bin balances and default-bin mappings are connected to Central Inventory.' });
    }
    const active = body.status === '1' || body.status === 'Y' ? 'Active' : body.status === '0' || body.status === 'N' ? 'Inactive' : body.status;
    let rows = (await find('generic_records', { module: 'bin-enquiry' })).map(normalize).filter((row) =>
      contains(row.loc_code, body.locCode) && contains(row.bin_code, body.binCode) && contains(row.zone, body.zone) &&
      contains(row.inv_bucket, body.invBucket) && contains(row.bin_location_type, body.binloactionType) && contains(row.status, active) &&
      contains(row.bin_type, body.binType) && contains(row.aisle, body.aisle));
    const direction = text(body.sord).toLowerCase() === 'asc' ? 1 : -1;
    rows.sort((a, b) => text(a.bin_code).localeCompare(text(b.bin_code)) * direction);
    const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
    const page = Math.max(1, Number(body.page) || 1), records = rows.length, total = Math.ceil(records / size);
    const gridModel = rows.slice((page - 1) * size, page * size);
    return res.status(200).json({ gridModel, binMasterDTOs: gridModel, rows: size, page: records ? page : 0, records, total });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Bin Enquiry error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
