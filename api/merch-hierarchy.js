import { sendDatabaseUnavailable, find, findOne, insert, update, cors, actor } from './mongo.js';

const MODULE = 'merch-hierarchy';
const text = (value) => String(value ?? '').trim();
const keyOf = (value) => text(value).toLocaleLowerCase('en');
const hierarchyTypes = ['Department', 'Category', 'Sub Category'];
const outboundPackaging = ['Small Box', 'Big Box', 'Medium Box', 'FEDEX_BOX', 'FEDEX_ENVELOPE', 'Normal'];
const inboundPackaging = ['Small Box', 'Big Box', 'Medium Box', 'Normal'];
const yesNo = ['Yes', 'No'];
const fail = (res, status, error) => res.status(status).json({ error });

function statusValue(value, fallback = 'Active') {
  const normalized = text(value || fallback).toLocaleLowerCase('en');
  if (normalized === 'active') return 'Active';
  if (normalized === 'inactive') return 'InActive';
  return null;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === 'Yes') return true;
  if (value === false || value === 'false' || value === 'No') return false;
  return null;
}

function checkCycle(rows, parentRow, current) {
  const seen = new Set(current ? [current.id] : []);
  let node = parentRow;
  while (node) {
    if (seen.has(node.id)) return true;
    seen.add(node.id);
    const parentCode = keyOf(node.parent_code);
    node = parentCode ? rows.find((row) => keyOf(row.code) === parentCode) || null : null;
  }
  return false;
}

function normalize(body, rows, current = null) {
  const code = text(body.code ?? current?.code).toUpperCase();
  const name = text(body.name ?? current?.name);
  const description = text(body.description ?? current?.description);
  const hierarchy_type = text(body.hierarchy_type ?? current?.hierarchy_type);
  const parentInput = text(body.parent_code ?? current?.parent_code);
  const status = statusValue(body.status, current?.status || 'Active');
  if (!code || !name || !description) return { error: 'Please fill all mandatory fields.' };
  if (!hierarchyTypes.includes(hierarchy_type)) return { error: 'Merchandising Hierarchy Type is invalid.' };
  if (hierarchy_type !== 'Department' && !parentInput) return { error: 'Parent Merch Code is mandatory.' };
  if (!status) return { error: 'Status must be Active or InActive.' };
  if (current && keyOf(code) !== keyOf(current.code)) return { error: 'Merchandising Code cannot be changed.' };

  let parent = null;
  if (parentInput) {
    parent = rows.find((row) => keyOf(row.code) === keyOf(parentInput)) || null;
    if (!parent) return { error: 'Parent Merch Code must exist in Merchandising Hierarchy.' };
    if (current && parent.id === current.id) return { error: 'Parent Merch Code cannot be the same as Merchandising Code.' };
    if (checkCycle(rows, parent, current)) return { error: 'Circular parent hierarchy is not allowed.' };
  }

  const outbound = text(body.outbound_packaging_type ?? current?.outbound_packaging_type);
  const inbound = text(body.inbound_packaging_type ?? current?.inbound_packaging_type);
  if (outbound && !outboundPackaging.includes(outbound)) return { error: 'Outbound Packaging Type is invalid.' };
  if (inbound && !inboundPackaging.includes(inbound)) return { error: 'Inbound Packaging Type is invalid.' };

  const rawDefault = body.is_default ?? current?.is_default ?? 'No';
  const is_default = text(rawDefault);
  if (!yesNo.includes(is_default)) return { error: 'Is Default must be Yes or No.' };

  const rawReturnWindow = body.return_window ?? current?.return_window ?? 0;
  const return_window = Number(rawReturnWindow === '' ? 0 : rawReturnWindow);
  if (!Number.isFinite(return_window) || return_window < 0) return { error: 'Return Window must be a non-negative number.' };

  const udfRaw = body.udf ?? current?.udf ?? Array(5).fill('');
  if (!Array.isArray(udfRaw) || udfRaw.length > 5) return { error: 'At most five User Defined Fields are supported.' };
  const udf = Array.from({ length: 5 }, (_, index) => text(udfRaw[index]));

  const flags = {};
  for (const key of ['non_returnable', 'pre_approved', 'restricted', 'eligible']) {
    const value = booleanValue(body[key], booleanValue(current?.[key], false));
    if (value === null) return { error: `${key.replaceAll('_', ' ')} must be true or false.` };
    flags[key] = value;
  }

  return {
    values: {
      module: MODULE,
      code,
      name,
      description,
      hierarchy_type,
      external_code: text(body.external_code ?? current?.external_code),
      parent_code: parent?.code || '',
      status,
      outbound_packaging_type: outbound,
      inbound_packaging_type: inbound,
      udf,
      default_lottable: text(body.default_lottable ?? current?.default_lottable),
      is_default,
      return_window,
      ...flags,
    },
  };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    if (req.method === 'GET') {
      const rows = await find('generic_records', { module: MODULE }, { sort: { code: 1 } });
      return res.status(200).json({ rows });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = req.body || {};
      const rows = await find('generic_records', { module: MODULE }, { sort: { code: 1 } });
      let current = null;
      if (req.method === 'PUT') {
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0) return fail(res, 400, 'A valid Merchandising Hierarchy ID is required.');
        current = await findOne('generic_records', { id });
        if (!current || current.module !== MODULE) return fail(res, 404, 'Merchandising Hierarchy not found.');
      }

      const normalized = normalize(body, rows, current);
      if (normalized.error) return fail(res, 400, normalized.error);
      const values = normalized.values;
      if (rows.some((row) => row.id !== current?.id && keyOf(row.code) === keyOf(values.code))) {
        return fail(res, 409, 'Duplicate Merchandising Code. Enter another code.');
      }

      const username = actor(req);
      const date = new Date().toISOString().slice(0, 10);
      if (req.method === 'POST') {
        return res.status(201).json(await insert('generic_records', {
          ...values,
          created_by: username,
          created_date: date,
          updated_by: username,
          updated_date: date,
        }));
      }

      const [saved] = await update('generic_records', current.id, {
        ...current,
        ...values,
        created_by: current.created_by || username,
        created_date: current.created_date || date,
        updated_by: username,
        updated_date: date,
      });
      if (!saved) return fail(res, 404, 'Merchandising Hierarchy not found.');
      return res.status(200).json(saved);
    }

    return fail(res, 405, 'Method not allowed.');
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Merchandising Hierarchy API error:', { name: error?.name, code: error?.code });
    return fail(res, 500, error.message || 'Merchandising Hierarchy request failed.');
  }
}
