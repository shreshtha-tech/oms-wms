import { sendDatabaseUnavailable, find, cors } from './mongo.js';
import { clientPairs } from './catalogs.js';

const MODULE = 'order-refund';
const text = (value) => String(value ?? '').trim();

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'PUT') {
      return res.status(501).json({ error: 'Refund approval and reapproval require an authorized payment provider, idempotent refund request, and provider status readback.' });
    }
    const list = await find('generic_records', { module: MODULE });
    if (req.method === 'GET') {
      const counts = { pending: 0, in_process: 0, processed: 0, failed: 0 };
      for (const row of list) {
        const status = text(row.refund_status || row.status).toLowerCase();
        if (status.includes('process') && !status.includes('processed')) counts.in_process += 1;
        else if (status.includes('processed')) counts.processed += 1;
        else if (status.includes('fail')) counts.failed += 1;
        else counts.pending += 1;
      }
      return res.status(200).json({ counts, clients: await clientPairs(), record_trust: 'legacy-unverified' });
    }
    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const body = req.body;
      const status = Number(body.status);
      const statusNames = { 1: 'Pending', 2: 'In Process', 3: 'Processed', 4: 'Failed' };
      const filtered = list.filter((row) => (!body.clientID || body.clientID === '-1' || text(row.client_id) === text(body.clientID))
        && (!statusNames[status] || text(row.refund_status || row.status).toLowerCase().includes(statusNames[status].toLowerCase())));
      const size = [15, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 15;
      const page = Math.max(1, Number(body.page) || 1);
      const records = filtered.length;
      const gridModel = filtered.slice((page - 1) * size, page * size).map((row) => ({ ...row, record_trust: 'legacy-unverified' }));
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total: Math.ceil(records / size) });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('order refunds error:', { name: error?.name, code: error?.code });
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
}
