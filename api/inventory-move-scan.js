import { sendDatabaseUnavailable, cors, find } from './mongo.js';

const text = value => String(value ?? '').trim();

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const reasons = (await find('generic_records', { module: 'inventory-move-reason' }))
        .filter(row => row.status !== 'Inactive' && text(row.code) && text(row.name))
        .map(row => [text(row.code), text(row.name)]);
      return res.json({
        reasons: [['-1', '--- Select ---'], ...reasons],
        bins: [],
        lpns: [],
        pageSizes: [20, 50, 100, 200],
        source: 'central-inventory',
        unavailableReason: 'Central Inventory does not store bin or LPN balances.',
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    return res.status(501).json({ error: 'Bin and LPN moves are disabled until those balances are mapped to Central Inventory.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    const status = error.statusCode || error.status || (error.code || /database|connection/i.test(error.message || '') ? 503 : 500);
    return res.status(status).json({ error: error.message || 'Inventory Move By Scan unavailable.' });
  }
}
