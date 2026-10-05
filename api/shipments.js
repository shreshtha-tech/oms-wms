import { sendDatabaseUnavailable, cors, find } from './mongo.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const rows = await find('shipments', {}, { sort: { id: -1 } });
      return res.status(200).json(rows.map(row => ({ ...row, trust: row.record_trust || 'legacy-unverified' })));
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      return res.status(501).json({ error: 'Shipment and manifest state changes require verified carrier events and the Central Inventory dispatch transaction.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Shipments API error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
