import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';
import { locationPairs } from './catalogs.js';
import { currentUser } from './auth-session.js';

const clean = (value) => String(value ?? '').trim();
const today = () => new Date().toISOString().slice(0, 10);
const statusText = (row) => row.active === false ? 'Inactive' : 'Active';
const rowSep = '\u0017';
const liveRow = (row) => ({ buyerCode: Number(row.buyer_code), buyerName: row.buyer_name, buyerDesc: row.description, phone: row.phone, altPhone: row.alternate_phone, email: row.email, displayIsActive: statusText(row), isActive: row.active !== false, udf1: row.udf?.[0] || '', udf2: row.udf?.[1] || '', udf3: row.udf?.[2] || '', udf4: row.udf?.[3] || '', udf5: row.udf?.[4] || '', locationCode: row.location, locationName: null, createdBy: row.created_by, createDate: row.created_date, modifiedBy: row.updated_by, modifiedDate: row.updated_date, linkToCategory: (row.categories || []).join(rowSep) });

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const row = await findOne('procurement_buyers', { buyer_code: clean(req.query.buyerCode) });
      if (!row) return res.status(404).json({ error: 'Category Buyer not found.' });
      return res.status(200).json(row);
    }
    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const body = req.body; const has = (value, query) => !clean(query) || clean(value).toLowerCase().includes(clean(query).toLowerCase());
      const selectedCategories = Array.isArray(body.linkToCat) ? body.linkToCat : clean(body.linkToCat || body.linkToCategory).split(rowSep).filter(Boolean);
      const filtered = (await find('procurement_buyers')).filter((row) => has(row.buyer_code, body.buyerCode)
        && has(row.buyer_name, body.buyerName) && has(row.description, body.buyerDesc) && has(row.phone, body.phone)
        && has(row.alternate_phone, body.altPhone) && has(row.email, body.email)
        && (clean(body.isActive ?? body.displayIsActive) === '-1' || !clean(body.isActive ?? body.displayIsActive) || String(row.active === false ? 0 : 1) === clean(body.isActive ?? body.displayIsActive))
        && has(row.udf?.[0], body.udf1) && has(row.udf?.[1], body.udf2) && has(row.udf?.[2], body.udf3)
        && has(row.udf?.[3], body.udf4) && has(row.udf?.[4], body.udf5)
        && has(row.created_date, body.createdDate) && has(row.updated_by, body.updatedBy) && has(row.updated_date, body.updatedDate)
        && (!selectedCategories.length || selectedCategories.every((category) => (row.categories || []).includes(clean(category)))));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1); const records = filtered.length; const total = Math.ceil(records / size);
      const gridModel = filtered.sort((a, b) => Number(b.buyer_code) - Number(a.buyer_code)).slice((page - 1) * size, page * size).map(liveRow);
      return res.status(200).json({ categoryBuyerDTO: { sortColumnName: clean(body.sidx), sortType: clean(body.sord), fromRecords: (page - 1) * size, toRecords: size }, categoryBuyerDTOs: gridModel, gridModel, rows: gridModel, page, records, total });
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = req.body || {};
      if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) return res.status(400).json({ error: 'Invalid Emai' });
      if (!clean(body.buyer_name)) return res.status(400).json({ error: 'Buyer Name is Mandatory' });
      if (!clean(body.email) || !clean(body.phone)) return res.status(400).json({ error: 'Please fill all the mandatory fields' });
      const all = await find('procurement_buyers');
      const current = clean(body.buyer_code) ? await findOne('procurement_buyers', { buyer_code: clean(body.buyer_code) }) : null;
      if (all.some((row) => row.id !== current?.id && clean(row.buyer_name).toLowerCase() === clean(body.buyer_name).toLowerCase())) return res.status(409).json({ error: 'Buyer Name already exists.' });
      const location = clean(body.location);
      if (location && !(await locationPairs()).some(([code]) => code === location)) return res.status(400).json({ error: 'Select a configured location.' });
      const actor = currentUser(req)?.username || 'unknown';
      const data = { buyer_code: current?.buyer_code || String(Math.max(0, ...all.map((row) => Number(row.buyer_code) || 0)) + 1), buyer_name: clean(body.buyer_name), description: clean(body.description), email: clean(body.email), phone: clean(body.phone), alternate_phone: clean(body.alternate_phone), active: body.active !== false, categories: Array.isArray(body.categories) ? body.categories : [], udf: Array.from({ length: 5 }, (_, index) => clean(body.udf?.[index])), location, created_by: current?.created_by || actor, created_date: current?.created_date || today(), updated_by: actor, updated_date: today() };
      const saved = current ? (await update('procurement_buyers', current.id, data))[0] : await insert('procurement_buyers', data);
      return res.status(current ? 200 : 201).json(saved);
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('Category Buyers API error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message || 'Unable to process Category Buyer.' }); }
}
