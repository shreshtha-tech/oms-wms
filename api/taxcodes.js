import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';

const TYPES = ['GST', 'CESS', 'VAT', 'OTHERS'];
const NATURES = ['Central Cess', 'State Cess'];
function validate(body) {
  const tax_code = String(body.tax_code || '').trim();
  if (!tax_code) return 'Please Enter Tax Code';
  if (!/^[a-z0-9]+$/i.test(tax_code)) return 'Please Enter Only AlphaNumerics';
  if (tax_code.length > 50) return 'Tax Code cannot exceed 50 characters';
  if (!TYPES.includes(body.tax_code_type)) return 'Please Select Tax Code Type';
  if (!NATURES.includes(body.tax_nature)) return 'Please Select Tax Nature';
  const date = String(body.start_date || '');
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return 'Please Select a valid Start Date';
  if (String(body.description || '').length > 500) return 'Description cannot exceed 500 characters';
  if (body.percentage === '' || body.percentage === undefined || body.percentage === null) return 'Please Enter Percentage';
  if (!['number', 'string'].includes(typeof body.percentage) || String(body.percentage).trim() === '') return 'Please Enter Valid Percentage';
  const percentage = Number(body.percentage);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return 'Please Enter Valid Percentage';
  if (!['Active', 'Inactive'].includes(body.is_active)) return 'Invalid status';
  return null;
}

// Tax Code master (Master > Tax Management > Tax Code)
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await find('tax_codes', {}, { sort: { id: -1 } }));
    }
    if (req.method === 'POST') {
      const b = req.body;
      if (b.REQ_SEARCH_FLAG) {
        const has = (value, query) => !String(query ?? '').trim() || String(value ?? '').toLowerCase().includes(String(query).trim().toLowerCase());
        const filtered = (await find('tax_codes', {}, { sort: { id: -1 } })).filter((row) => has(row.tax_code, b.extTaxCode) && has(row.tax_code_type, b.taxCodeValue) && has(row.start_date, b.displayStartDate) && has(row.percentage, b.percentage) && has(row.description, b.description) && has(row.is_active, b.displayIsActive) && has(row.tax_nature, b.taxNature));
        const size = [20, 50, 100, 200].includes(Number(b.rows)) ? Number(b.rows) : 20, page = Math.max(1, Number(b.page) || 1), records = filtered.length, total = Math.ceil(records / size), gridModel = filtered.slice((page - 1) * size, page * size);
        return res.status(200).json({ gridModel, rows: gridModel, page, records, total, sidx: String(b.sidx || 'taxCode'), sord: String(b.sord || 'desc') });
      }
      const error = validate({ ...b, is_active: b.is_active === undefined ? 'Active' : b.is_active }); if (error) return res.status(400).json({ error });
      if ((await find('tax_codes', {})).some((row) => row.tax_code?.toLowerCase() === String(b.tax_code).trim().toLowerCase())) return res.status(409).json({ error: 'Tax Code already exists' });
      const doc = await insert('tax_codes', {
        tax_code: String(b.tax_code).trim(), tax_code_type: b.tax_code_type,
        start_date: b.start_date,
        percentage: Number(b.percentage), description: String(b.description || '').trim(),
        is_active: b.is_active === undefined ? 'Active' : b.is_active, tax_nature: b.tax_nature,
      });
      return res.status(201).json(doc);
    }
    if (req.method === 'PUT') {
      const { id, _id: ignoredMongoId, ...fields } = req.body;
      if (Array.isArray(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) return res.status(400).json({ error: 'A valid Tax Code ID is required' });
      const current = await findOne('tax_codes', { id: Number(id) }); if (!current) return res.status(404).json({ error: 'Tax Code not found' });
      if (['VINCCNA', 'VINSCNA'].includes(String(current.tax_code).toUpperCase())) return res.status(403).json({ error: 'VINCCNA/VINSCNA are system defined taxes. You have no rights to change it.' });
      const next = { ...current, ...fields, tax_code: String(fields.tax_code || '').trim() };
      const error = validate(next); if (error) return res.status(400).json({ error });
      if ((await find('tax_codes', {})).some((row) => row.id !== current.id && row.tax_code?.toLowerCase() === next.tax_code.toLowerCase())) return res.status(409).json({ error: 'Tax Code already exists' });
      const rows = await update('tax_codes', current.id, { ...fields, tax_code: next.tax_code, percentage: Number(next.percentage) });
      return res.status(200).json(rows[0]);
    }
    if (req.method === 'DELETE') {
      return res.status(409).json({ error: 'Tax Codes are maintained by status; deletion is not available.' });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return; console.error('taxcodes error:', { name: err?.name, code: err?.code }); res.status(500).json({ error: err.message }); }
}
