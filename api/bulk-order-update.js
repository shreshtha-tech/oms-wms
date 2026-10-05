import { sendDatabaseUnavailable, cors, find } from './mongo.js';

const MODULE = 'bulk-order-update-result';
const TYPES = { '5': 'Order Cancel', '1': 'Order Pack', '2': 'Order Ship', '4': 'Order UnPack' };

const paged = (rows, body) => {
  const size = [20, 50, 100, 200].includes(+body.rows) ? +body.rows : 20;
  const page = Math.max(1, +body.page || 1);
  const records = rows.length;
  const gridModel = rows.slice((page - 1) * size, page * size);
  return { gridModel, rows: gridModel, page, total: Math.ceil(records / size), records };
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') return res.json({
      importTypes: Object.entries(TYPES).map(([id, name]) => ({ id, name })),
      maxRows: 500,
      pageSizes: [20, 50, 100, 200],
      available: false,
      notice: 'Order status imports remain disabled until each state change is committed through Central Inventory and provider-aware fulfillment services.',
    });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    if (body.action === 'results') {
      const rows = (await find('generic_records', { module: MODULE }))
        .sort((a, b) => +a.seq_no - +b.seq_no);
      return res.json({ ...paged(rows, body), batch: body.batch || null, trust: 'legacy-unverified' });
    }
    if (body.action === 'import') return res.status(501).json({
      error: 'Bulk order status import is paused until each order state transition is integrated with Central Inventory and supported carrier/provider services.',
    });
    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Bulk Order Update error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
