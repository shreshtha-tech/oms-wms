import { sendDatabaseUnavailable, find, cors } from './mongo.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await find('picklists', {}, { sort: { id: -1 } }));
    }
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      return res.status(501).json({
        error: 'Legacy picklist writes are paused until their orders are linked to Central Inventory reservations and supported pick/pack events.',
      });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return;
    console.error('Picklists API error:', { name: err?.name, code: err?.code });
    return res.status(500).json({ error: err.message });
  }
}
