import { sendDatabaseUnavailable, find, findOne, update, cors } from './mongo.js';

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const split = (value) => String(value || '').split(/[|,]/).map((item) => item.trim()).filter(Boolean);
const viewRow = (row) => ({ ...row, inventory: null, inventory_trust: 'central-unmapped' });

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.status(200).json((await find('back_orders', {}, { sort: { id: -1 } })).map(viewRow));
    }
    if (req.method === 'POST' && req.query?.action === 'search') {
      const rows = await find('back_orders');
      const query = req.body || {};
      const match = (value, search) => !search || search === '-1' || String(value || '').toLowerCase().includes(String(search).toLowerCase());
      const inRange = (value, from, to) => {
        if (!from && !to) return true;
        const date = String(value || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && (!from || date >= from) && (!to || date <= to);
      };
      const orderTypes = split(query.orderTypes);
      const tags = split(query.orderTags);
      const filtered = rows.filter((row) => match(row.siteLocation, query.siteLocation)
        && match(row.skuCode, query.skuCode) && match(row.vendorCode, query.vendorCode)
        && match(row.merchCodes, query.merchCodes) && match(row.brandCode, query.brandCode)
        && match(row.priorityCode, query.priorityCode) && match(row.channelCode, query.channelCode)
        && match(row.refNo, query.refVal)
        && inRange(row.orderDate || row.order_date || row.created_date, query.fromOrderDate, query.toOrderDate)
        && inRange(row.expectedDate || row.expected_date || row.shipByDate, query.fromExpDelDate, query.toExpDelDate)
        && (!orderTypes.length || orderTypes.includes(row.orderType))
        && (!tags.length || tags.some((tag) => (row.orderTags || []).includes(tag)))
        && (!query.backOrder || Boolean(row.backOrder)) && (!query.pendingConfirm || Boolean(row.pendingConfirm)));
      const page = Math.max(1, finite(query.page) || 1);
      const rowsPerPage = [20, 50, 100, 200].includes(finite(query.rows)) ? finite(query.rows) : 20;
      const orderTypeOptions = [...new Set(rows.map((row) => String(row.orderType || '').trim()).filter(Boolean))].sort();
      return res.status(200).json({
        page, total: Math.ceil(filtered.length / rowsPerPage), records: filtered.length,
        rows: filtered.slice((page - 1) * rowsPerPage, page * rowsPerPage).map(viewRow), orderTypeOptions,
      });
    }
    if (req.method === 'POST' && req.query?.action === 'create-po') {
      return res.status(501).json({ error: 'Back-order PO creation requires an atomic, idempotent transaction linking each source row to exactly one purchase order.' });
    }
    if (req.method === 'POST') {
      return res.status(501).json({ error: 'Back orders must originate from an approved order workflow; direct creation is unavailable.' });
    }
    if (req.method === 'PUT') {
      const row = await findOne('back_orders', { id: Number(req.body?.id) });
      if (!row) return res.status(404).json({ error: 'Back order not found.' });
      if (row.isProcessed) return res.status(409).json({ error: 'A processed back order cannot be edited.' });
      const fields = {};
      if (Object.hasOwn(req.body || {}, 'toOrderQty')) {
        const quantity = Number(req.body.toOrderQty);
        if (!['string', 'number'].includes(typeof req.body.toOrderQty) || String(req.body.toOrderQty).trim() === '' || !Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'To Order Qty must be greater than zero.' });
        fields.toOrderQty = quantity;
      }
      if (Object.hasOwn(req.body || {}, 'unitCost')) {
        const cost = Number(req.body.unitCost);
        if (!['string', 'number'].includes(typeof req.body.unitCost) || String(req.body.unitCost).trim() === '' || !Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: 'Unit Cost must be zero or greater.' });
        fields.unitCost = cost;
      }
      if (!Object.keys(fields).length) return res.status(400).json({ error: 'Only To Order Qty and Unit Cost planning fields can be edited.' });
      const [saved] = await update('back_orders', row.id, fields);
      return res.status(200).json(viewRow(saved));
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Back orders API error:', { name: error?.name, code: error?.code });
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
}
