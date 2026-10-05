import { sendDatabaseUnavailable, cors, find, insert } from './mongo.js';
import { currentUser } from './auth-session.js';

const text = value => String(value ?? '').trim();
const reasonRows = async () => (await find('generic_records', { module: 'inventory-move-reason' }))
  .filter(row => row.status !== 'Inactive' && text(row.code) && text(row.name));

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    if (req.method === 'GET') {
      const [zoneRows, reasons] = await Promise.all([
        find('generic_records', { module: 'wms-zone' }), reasonRows(),
      ]);
      const zones = [...new Map(zoneRows.map(row => [row.code || row.zone_code, row.name || row.description || ''])).entries()].filter(([code]) => code);
      return res.json({ zones: [['-1', '--- Select ---'], ...zones],
        reasons: [['-1', '--- Select ---'], ...reasons.map(row => [text(row.code), text(row.name)])],
        products: [], bins: [], pageSizes: [20, 50, 100, 200], maxImportRows: 200,
        source: 'central-inventory', unavailableReason: 'Central Inventory does not store bin, LPN, or lot balances.' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const actor = currentUser(req)?.username || 'unknown';
    if (body.action === 'create-reason') {
      const name = text(body.name);
      if (!name) return res.status(400).json({ error: 'Enter an inventory move reason.' });
      const reasons = await reasonRows();
      if (reasons.some(row => text(row.name).toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'Reason already exists.' });
      const code = `IMR${Math.max(0, ...reasons.map(row => Number(text(row.code).replace(/^IMR/, '')) || 0)) + 1}`;
      await insert('generic_records', { module: 'inventory-move-reason', code, name, status: 'Active', created_by: actor });
      return res.status(201).json({ code, name });
    }
    if (['search', 'execute', 'import'].includes(body.action)) return res.status(501).json({ error: 'Bin-level inventory moves are disabled until bin, lot, and LPN balances are mapped to Central Inventory.' });
    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Inventory Move error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
