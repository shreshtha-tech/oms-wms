import { sendDatabaseUnavailable, readTaxGroupSnapshot, saveTaxGroup, find, findOne, insert, update, remove, cors } from './mongo.js';

const MODULE = 'tax-group';
const APPLIED_ON = ['Cost', 'MRP', 'RSP'];
const TAX_LEVELS = ['1', '2', '3', '4', '5'];

async function listGroups() {
  const [groups, mappings, codes] = await readTaxGroupSnapshot();
  return groups.map((group) => {
    const components = mappings
      .filter((mapping) => mapping.group_id === group.id)
      .sort((left, right) => left.sequence - right.sequence)
      .map((mapping) => ({
        ...mapping,
        tax_code: codes.find((code) => code.id === mapping.tax_code_id),
      }))
      .filter((mapping) => mapping.tax_code);
    return {
      ...group,
      components,
      no_of_tax_codes: components.length,
      total_rate: components.reduce((sum, item) => sum + Number(item.tax_code.percentage || 0), 0),
    };
  });
}

function validateBase(body) {
  if (!String(body.code || '').trim()) return 'Tax Group Code is required';
  if (String(body.code).trim().length > 50) return 'Tax Group Code cannot exceed 50 characters';
  if (!String(body.name || '').trim()) return 'Tax Group Name is required';
  if (String(body.name).trim().length > 100) return 'Tax Group Name cannot exceed 100 characters';
  if (!APPLIED_ON.includes(body.applied_on)) return 'Applied On is required';
  const date = String(body.start_date || '');
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return 'Please Select a valid Start Date';
  if (!['Active', 'Inactive'].includes(body.status)) return 'Invalid status';
  return null;
}

function normalizeComponents(body) {
  const source = Array.isArray(body.tax_codes)
    ? body.tax_codes
    : Array.isArray(body.tax_code_ids)
      ? body.tax_code_ids.map((tax_code_id) => ({ tax_code_id }))
      : [];
  if (!source.length) return { error: 'Add at least one Tax Code.' };
  if (source.length > 100) return { error: 'A Tax Group cannot contain more than 100 Tax Codes.' };
  const components = source.map((item) => ({
    tax_code_id: Number(item?.tax_code_id ?? item?.id),
    tax_level: item?.tax_level == null || item.tax_level === '' ? '' : String(item.tax_level),
  }));
  if (components.some((item) => !Number.isSafeInteger(item.tax_code_id) || item.tax_code_id <= 0)) return { error: 'One or more Tax Codes are invalid.' };
  if (new Set(components.map((item) => item.tax_code_id)).size !== components.length) return { error: 'A Tax Code can only be added once.' };
  if (components.some((item) => item.tax_level && !TAX_LEVELS.includes(item.tax_level))) return { error: 'Tax Level must be between 1 and 5.' };
  return { components };
}

async function validateComponents(components, previousIds = new Set()) {
  const allCodes = await find('tax_codes', {});
  const byId = new Map(allCodes.map((code) => [Number(code.id), code]));
  if (components.some((item) => !byId.has(item.tax_code_id))) return { error: 'One or more Tax Codes are invalid.', status: 400 };
  if (components.some((item) => byId.get(item.tax_code_id).is_active !== 'Active' && !previousIds.has(item.tax_code_id))) {
    return { error: 'Inactive Tax Codes cannot be added to a Tax Group.', status: 400 };
  }
  return { codes: byId };
}

async function restoreMappings(groupId, previous) {
  const current = await find('tax_group_codes', { group_id: groupId });
  for (const mapping of current) await remove('tax_group_codes', mapping.id);
  for (const mapping of previous) {
    const { id, ...fields } = mapping;
    await insert('tax_group_codes', fields);
  }
}

async function replaceMappings(groupId, components) {
  const previous = await find('tax_group_codes', { group_id: groupId });
  try {
    for (const mapping of previous) await remove('tax_group_codes', mapping.id);
    for (const [index, component] of components.entries()) {
      await insert('tax_group_codes', {
        group_id: groupId,
        tax_code_id: component.tax_code_id,
        tax_level: component.tax_level,
        sequence: index + 1,
      });
    }
  } catch (error) {
    await restoreMappings(groupId, previous);
    throw error;
  }
  return previous;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const rows = await listGroups();
      const { code, name, status } = req.query;
      return res.status(200).json(rows.filter((row) => (
        (!code || row.code.toLowerCase().includes(String(code).toLowerCase()))
        && (!name || row.name.toLowerCase().includes(String(name).toLowerCase()))
        && (!status || row.status === status)
      )));
    }

    if (req.method === 'POST' && (req.body?.REQ_SEARCH_FLAG === true || String(req.body?.REQ_SEARCH_FLAG) === 'true')) {
      const body = req.body;
      const has = (value, query) => !String(query ?? '').trim() || String(value ?? '').toLowerCase().includes(String(query).trim().toLowerCase());
      const filtered = (await listGroups()).filter((row) => (
        has(row.code, body.extTaxGroupCode)
        && has(row.applied_on, body.appliedOn)
        && has(row.start_date, body.displayStartDate)
        && has(row.status === 'Active' ? 'Yes' : 'No', body.displayIsActive)
      ));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = filtered.length;
      const total = Math.ceil(records / size);
      const gridModel = filtered.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total, sidx: String(body.sidx || ''), sord: String(body.sord || 'asc') });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = req.body || {};
      const baseError = validateBase(body);
      if (baseError) return res.status(400).json({ error: baseError });
      const normalized = normalizeComponents(body);
      if (normalized.error) return res.status(400).json({ error: normalized.error });
      const code = String(body.code).trim();
      const name = String(body.name).trim();
      const id = req.method === 'POST' ? null : Number(body.id);
      if (req.method === 'PUT' && (Array.isArray(body.id) || !Number.isSafeInteger(id) || id <= 0)) return res.status(400).json({ error: 'A valid Tax Group ID is required.' });
      const date = new Date().toISOString().slice(0, 10);
      const groupId = await saveTaxGroup(id, { module: MODULE, code, name, applied_on: body.applied_on, start_date: body.start_date, status: body.status, ...(id == null ? { created_date: date } : { updated_date: date }) }, normalized.components);
      return res.status(id == null ? 201 : 200).json((await listGroups()).find(row => row.id === groupId));
    }

    if (req.method === 'DELETE') return res.status(409).json({ error: 'Tax Groups are maintained by status; deletion is not available.' });
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('tax groups error:', { name: error?.name, code: error?.code });
    return res.status([400,404,409,503].includes(error.statusCode)?error.statusCode:500).json({ error: error.message || 'Tax Group request failed.' });
  }
}
