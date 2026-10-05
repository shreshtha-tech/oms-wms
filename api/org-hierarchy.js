import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';

const MODULE = 'org-hierarchy';
const clean = (value) => String(value ?? '').trim();
const cycle = (rows, parent, code) => {
  const seen = new Set([code]); let current = parent;
  while (current) { if (seen.has(current)) return true; seen.add(current); current = rows.find((row) => row.code === current)?.parent_hierarchy_code || ''; }
  return false;
};
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const rows = await find('generic_records', { module: MODULE }, { sort: { code: 1 } });
    if (req.method === 'GET') return res.status(200).json({ rows, records: rows.length });
    if (req.method === 'POST' || req.method === 'PUT') {
      const b = req.body, code = clean(b.code).toUpperCase(), name = clean(b.name), description = clean(b.description), type = clean(b.hierarchy_type), parent = clean(b.parent_hierarchy_code);
      if (!type) return res.status(400).json({ error: 'Organization Type is Mandatory' });
      if (!code) return res.status(400).json({ error: 'Organization Id is Mandatory' });
      if (!name) return res.status(400).json({ error: 'Organization Name is Mandatory' });
      if (!description) return res.status(400).json({ error: 'Organization Desc is Mandatory' });
      if (type === 'Company' && !clean(b.org_country)) return res.status(400).json({ error: 'Org Country is mandatory' });
      const current = req.method === 'PUT' ? await findOne('generic_records', { id: Number(b.id) }) : null;
      if (req.method === 'PUT' && (!current || current.module !== MODULE)) return res.status(404).json({ error: 'Organization Hierarchy not found' });
      if (rows.some((row) => row.id !== current?.id && row.code.toUpperCase() === code)) return res.status(409).json({ error: 'Duplicate Organization Code. Enter another code.' });
      if (parent === code) return res.status(400).json({ error: 'Parent Hierarchy Code Can not be same' });
      if (parent && !rows.some((row) => row.code === parent)) return res.status(400).json({ error: 'Organization parentCode is Mendatory' });
      if (cycle(rows, parent, code)) return res.status(400).json({ error: 'Circular parent hierarchy is not allowed' });
      const doc = { module: MODULE, code, name, description, hierarchy_type: type, parent_hierarchy_code: parent, org_country: clean(b.org_country), base_currency: clean(b.base_currency), base_language: clean(b.base_language), timezone: clean(b.timezone), weight_unit: clean(b.weight_unit), dimension_unit: clean(b.dimension_unit), financial_start_date: clean(b.financial_start_date), locale: clean(b.locale), status: 'Active' };
      if (req.method === 'POST') return res.status(201).json(await insert('generic_records', { ...doc, created_date: new Date().toISOString().slice(0, 10) }));
      return res.status(200).json((await update('generic_records', current.id, doc))[0]);
    }
    if (req.method === 'DELETE') return res.status(409).json({ error: 'Organization hierarchy nodes cannot be deleted.' });
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return; console.error('org hierarchy error:', { name: error?.name, code: error?.code }); return res.status(500).json({ error: error.message }); }
}
