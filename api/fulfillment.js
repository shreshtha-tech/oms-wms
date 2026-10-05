import { sendDatabaseUnavailable, cors, find, update } from './mongo.js';

const SAFE_PRIORITIES = new Set(['Low', 'Normal', 'High']);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const { status, warehouse } = req.query;
      const query = {};
      if (status) query.status = status;
      if (warehouse) query.warehouse = warehouse;
      return res.status(200).json(await find('fulfillment_orders', query, { sort: { id: 1 } }));
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const action = String(body.action || '');
      if (action === 'generate-shipping-label') {
        return res.status(501).json({ error: 'Shipping labels require a connected carrier service and Central Inventory dispatch workflow.' });
      }
      if (['allocate', 'unallocate'].includes(action)) {
        return res.status(501).json({ error: 'Order allocation and unallocation require Central Inventory reservation transactions.' });
      }

      const targetIds = (Array.isArray(body.ids) ? body.ids : body.id == null ? [] : [body.id]).map(Number);
      if (!targetIds.length || targetIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        return res.status(400).json({ error: 'Valid order ids are required.' });
      }

      const fields = Object.fromEntries(Object.entries(body).filter(([key]) => !['ids', 'id', 'action'].includes(key)));
      if (Object.keys(fields).length === 1 && Object.hasOwn(fields, 'priority')) {
        if (!SAFE_PRIORITIES.has(String(fields.priority))) {
          return res.status(400).json({ error: 'Priority must be Low, Normal, or High.' });
        }
        const selected = (await find('fulfillment_orders')).filter(row => targetIds.includes(Number(row.id)));
        if (selected.length !== new Set(targetIds).size) {
          return res.status(404).json({ error: 'One or more selected orders no longer exist.' });
        }
        return res.status(200).json(await update('fulfillment_orders', targetIds, { priority: String(fields.priority) }));
      }

      return res.status(501).json({ error: 'Legacy fulfillment state changes are disabled. Only priority metadata can be edited here; stock, order status, allocation, picking, and dispatch changes require their Central Inventory workflow.' });
    }

    if (req.method === 'POST') {
      return res.status(501).json({ error: 'Fulfillment orders must be created through the order intake workflow connected to Central Inventory.' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return;
    console.error('Fulfillment API error:', { name: err?.name, code: err?.code });
    return res.status(500).json({ error: err.message });
  }
}
