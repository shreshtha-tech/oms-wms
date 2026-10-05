import { cors } from './mongo.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method === 'GET') return res.json({
    maxImportRows: 1000,
    pageSizes: [20, 50, 100, 200],
    templateColumns: ['SKU Code', 'Lot Code', 'Lottable 01', 'Lottable 02', 'Lottable 03', 'Lottable 04', 'Lottable 05', 'Lottable 06'],
    available: false,
    message: 'Bulk lottable import is paused until lot and lottable identities are mapped to Central Inventory.',
  });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.body?.action !== 'import') return res.status(400).json({ error: 'Invalid action' });
  return res.status(501).json({ error: 'Bulk lottable import is paused until lot and lottable identities are mapped to Central Inventory.' });
}
