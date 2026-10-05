import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';
const MODULE = 'pricing-event', text = (v) => String(v ?? '').trim(), has = (v, q) => !text(q) || text(q) === '-1' || text(v).toLowerCase().includes(text(q).toLowerCase());
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const list = await find('generic_records', { module: MODULE });
    if (req.method === 'GET') return res.status(200).json({ rows: list, buyers: await find('generic_records', { module: 'category-buyers' }), vendors: await find('vendors', {}), locations: await find('generic_records', { module: 'location' }), skus: await find('skus', {}) });
    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const b = req.body; let rows = list.filter((r) => has(r.start_date, b.startDate) && has(r.organisation_hierarchy, b.orgId) && has(r.owner, b.owner) && has(r.vendor, b.vendor) && has(r.brand, b.brand) && has(r.is_active, b.isActive) && has(r.merch_hierarchy, b.merchIdBySku) && has(r.sku_code, b.sku) && has(r.customer, b.customerName) && has(r.scheme_on, b.schemeOn) && has(r.operation, b.operation) && has(r.discount_type, b.discountType) && has(r.price_zone_code, b.priceZoneCode) && has(r.location_code, b.selectedlocCode));
      rows.sort((a, c) => text(a.code).localeCompare(text(c.code)) * (text(b.sord) === 'asc' ? 1 : -1)); const size = [20, 50, 100, 200].includes(Number(b.rows)) ? Number(b.rows) : 20, page = Math.max(1, Number(b.page) || 1), records = rows.length, total = Math.ceil(records / size), gridModel = rows.slice((page - 1) * size, page * size); return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const b = req.body, name = text(b.name); if (!name || !text(b.start_date)) return res.status(400).json({ error: 'Pricing Event Description and Start Date are mandatory.' }); const current = req.method === 'PUT' ? await findOne('generic_records', { id: Number(b.id) }) : null; const doc = { module: MODULE, code: text(b.code) || `PE${Date.now().toString().slice(-8)}`, name, description: name, status: text(b.status) || 'Pending Confirmation', event_type: text(b.event_type) || 'Regular', start_date: text(b.start_date), end_date: text(b.end_date), location_code: text(b.location_code), customer: text(b.customer) || 'All', is_active: text(b.is_active) || 'Yes', organisation_hierarchy: text(b.organisation_hierarchy), owner: text(b.owner), vendor: text(b.vendor), brand: text(b.brand), merch_hierarchy: text(b.merch_hierarchy), sku_code: text(b.sku_code), scheme_on: text(b.scheme_on), operation: text(b.operation), discount_type: text(b.discount_type), price_zone_code: text(b.price_zone_code), sku_rules: Array.isArray(b.sku_rules) ? b.sku_rules : [] };
      if (req.method === 'POST') return res.status(201).json(await insert('generic_records', doc)); if (!current || current.module !== MODULE) return res.status(404).json({ error: 'Pricing Event not found' }); return res.status(200).json((await update('generic_records', current.id, doc))[0]);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('pricing events error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message }); }
}
