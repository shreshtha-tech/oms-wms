import { cors } from './mongo.js';

const unavailable = 'Sort-to-box scans and LPN closure are paused until Central Inventory supports verified bin/LPN identity and the pick/pack ledger is connected.';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method === 'GET') return res.json({ fromLpns: [], pageSizes: [20, 50, 100, 200], available: false, notice: unavailable });
  if (req.method === 'POST') return res.status(501).json({ error: unavailable });
  return res.status(405).json({ error: 'Method not allowed' });
}
