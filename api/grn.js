import { sendDatabaseUnavailable, find, cors } from './mongo.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await find('grn', {}, { sort: { id: -1 } }));
    }
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) return res.status(501).json({ error: 'Legacy GRN writes are unavailable. Use Manage ASN for ASN metadata and the central receipt workflow for physical receiving.' });
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return; console.error('API error:', { name: err?.name, code: err?.code }); res.status(500).json({ error: err.message }); }
}
