import { sendDatabaseUnavailable, find, findOne, insert, update, remove, cors } from './mongo.js';

const protectedMaster = value => ['customer', 'transporter', 'client'].includes(String(value || '').trim().toLowerCase());

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      let existing;
      if (req.method !== 'POST') {
        const rawId = req.body?.id;
        const id = Number(rawId);
        if (Array.isArray(rawId) || !Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'A single valid Partner ID is required.' });
        existing = await findOne('partners', { id });
        req.body.id = id;
      }
      if ([req.body?.type, req.body?.partner_type, existing?.type, existing?.partner_type].some(protectedMaster)) {
        return res.status(501).json({ error: 'Customer, Transporter and Client changes must use their dedicated master APIs so identity, validation, history and deletion guards are applied.' });
      }
    }
    if (req.method === 'GET') {
      const { type } = req.query;
      const q = type ? { type } : {};
      return res.status(200).json(await find('partners', q, { sort: { id: 1 } }));
    }
    if (req.method === 'POST') {
      const { code, name, type, contact, phone, email, city, state, gstin } = req.body;
      return res.status(201).json(await insert('partners', { code, name, type, contact, phone, email, city, state, gstin }));
    }
    if (req.method === 'PUT') {
      const { id, ...fields } = req.body;
      const rows = await update('partners', id, fields);
      return res.status(200).json(rows[0]);
    }
    if (req.method === 'DELETE') {
      const { id } = req.body;
      return res.status(200).json(await remove('partners', id));
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return; console.error('API error:', { name: err?.name, code: err?.code }); res.status(500).json({ error: err.message }); }
}
