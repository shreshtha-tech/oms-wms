import { sendDatabaseUnavailable, cors, find, insert, update, updateWhere } from './mongo.js';
import { currentUser } from './auth-session.js';

const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const labels = ['Unique Batch Nos', 'Lottable2', 'Mfg Date', 'Lottable 04', 'Batch No', 'Recv Date', 'Lottable 07'];
const normalize = (row) => ({
  ...row,
  lotValCode: row.lot_val_code || row.code || '',
  description: row.description || row.name || '',
  isDefault: !!row.is_default,
  lottables: Array.from({ length: labels.length }, (_, index) => row.lottables?.[index] || {
    label: labels[index], mandatory: false, outward: false, mask: '', length: [0, 4, 5, 6].includes(index) ? '50' : '',
  }),
});

function validate(body) {
  const code = text(body.lotValCode);
  if (!code) return 'Please Enter Lottable Validation Code';
  if (!text(body.description)) return 'Please Enter Description';
  if (!/^[a-zA-Z0-9]+$/.test(code)) return 'Please Enter Only AlphaNumerics';
  if (code.length > 20) return 'Lottable Validation Code cannot exceed 20 characters.';
  if (!Array.isArray(body.lottables) || body.lottables.length !== labels.length) return 'All seven lottable definitions are required.';
  for (let index = 0; index < labels.length; index += 1) {
    const lot = body.lottables[index] || {};
    if (lot.label !== labels[index]) return 'Lottable definition order is invalid.';
    if (typeof lot.mandatory !== 'boolean' || typeof lot.outward !== 'boolean') return 'Lottable mandatory settings must be boolean.';
  }
  for (const index of [0, 4, 5, 6]) {
    const length = text(body.lottables[index]?.length);
    const mask = text(body.lottables[index]?.mask);
    if (Number(length) > 50) return `Length${index + 1} exceeds the limit`;
    if (length && !/^\d*[aA]?[\-.]?\d*[aA]?[\-.]?\d*$/.test(length)) return 'Please Enter Valid Length';
    if (mask.length > Number(length || 0)) return `Mask${index + 1} exceeds the limit`;
  }
  return '';
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    if (req.method === 'POST' && (body.REQ_SEARCH_FLAG || body.action === 'search')) {
      const defaultFilter = ['1', 'Yes'].includes(text(body.isDefault)) ? true : ['0', 'No'].includes(text(body.isDefault)) ? false : null;
      let rows = (await find('generic_records', { module: 'lottable-validation' })).map(normalize)
        .filter((row) => has(row.lotValCode, body.receivingValidationCode)
          && has(row.description, body.description)
          && (defaultFilter === null || defaultFilter === row.isDefault));
      rows.sort((a, b) => text(a.lotValCode).localeCompare(text(b.lotValCode)) * (text(body.sord) === 'asc' ? 1 : -1));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = rows.length;
      const gridModel = rows.slice((page - 1) * size, page * size);
      return res.json({ gridModel, lottableValidationDTOs: gridModel, rows: size, record: records, page, records, total: Math.ceil(records / size) });
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const error = validate(body);
      if (error) return res.status(400).json({ error });
      const code = text(body.lotValCode).toUpperCase();
      const all = await find('generic_records', { module: 'lottable-validation' });
      const byCode = all.find((row) => text(row.lot_val_code || row.code).toUpperCase() === code);
      const existing = req.method === 'PUT' && body.id ? all.find((row) => row.id === Number(body.id)) : byCode;
      if (req.method === 'POST' && byCode) return res.status(409).json({ error: 'Lottable Validation Code already exists.' });
      if (req.method === 'PUT' && !existing) return res.status(404).json({ error: 'Lottable Validation was not found.' });
      if (req.method === 'PUT' && byCode && existing.id !== byCode.id) return res.status(409).json({ error: 'Lottable Validation Code already exists.' });
      if (body.isDefault) await updateWhere('generic_records', { module: 'lottable-validation' }, { is_default: false });
      const actor = currentUser(req)?.username || 'unknown';
      const fields = {
        module: 'lottable-validation', code, lot_val_code: code, name: text(body.description), description: text(body.description),
        is_default: !!body.isDefault, lottables: body.lottables, modified_by: actor, modified_date: new Date().toISOString(),
      };
      if (existing) {
        const changed = await update('generic_records', existing.id, fields);
        return res.json({ row: normalize(changed[0]), jsonMessage: 'Data saved successfully.' });
      }
      const row = await insert('generic_records', { ...fields, created_by: actor, created_date: new Date().toISOString() });
      return res.status(201).json({ row: normalize(row), jsonMessage: 'Data saved successfully.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Lottable Validation error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
