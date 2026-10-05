import { sendDatabaseUnavailable, find, insert, cors, actor } from './mongo.js';

const MODULE = 'manage-attribute';
const scopes = new Set(['S', 'C', 'E']);
const inputTypes = new Set(['Text', 'Number', 'Date', 'List']);
const text = (value) => String(value ?? '').trim();
const folded = (value) => text(value).toLocaleLowerCase('en');
const fail = (res, status, error) => res.status(status).json({ error });

function choiceMatches(value, query) {
  const expected = text(query);
  return !expected || expected === '-1' || folded(value) === folded(expected);
}

function textMatches(value, query) {
  const expected = text(query);
  return !expected || folded(value).includes(folded(expected));
}

function parseBoolean(value, fallback, label) {
  if (value === undefined) return { value: fallback };
  if (typeof value === 'boolean') return { value };
  return { error: `${label} must be true or false.` };
}

function search(req, res) {
  const body = req.body || {};
  return find('generic_records', { module: MODULE }).then((allRows) => {
    const rows = allRows.filter((row) => textMatches(row.code, body.pick_sku)
      && textMatches(row.description || row.name, body.attributeDescription)
      && choiceMatches(String(Boolean(row.extra?.mandatory)), body.mandatory1)
      && choiceMatches(String(row.extra?.visible !== false), body.visible1)
      && choiceMatches(row.extra?.scope, body.scope1)
      && choiceMatches(String(Boolean(row.extra?.searchable)), body.searchable1)
      && choiceMatches(String(row.status === 'Active'), body.active));
    const direction = text(body.sord).toLocaleLowerCase('en') === 'asc' ? 1 : -1;
    rows.sort((left, right) => text(left.code).localeCompare(text(right.code), 'en') * direction);
    const requestedSize = Number(body.rows);
    const size = [20, 50, 100, 200].includes(requestedSize) ? requestedSize : 20;
    const requestedPage = Number(body.page);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const records = rows.length;
    const total = Math.ceil(records / size);
    const gridModel = rows.slice((page - 1) * size, page * size);
    return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
  });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    if (req.method === 'GET') {
      const rows = await find('generic_records', { module: MODULE }, { sort: { code: 1 } });
      return res.status(200).json({ rows });
    }

    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG === true) {
      return await search(req, res);
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const code = text(body.code).toLocaleUpperCase('en');
      const description = text(body.description);
      const scope = text(body.scope);
      const inputType = text(body.inputType || 'Text');
      if (!code || !description) return fail(res, 400, 'Attribute Code and Description are mandatory.');
      if (code.length > 100 || description.length > 1000) return fail(res, 400, 'Attribute Code or Description is too long.');
      if (!scopes.has(scope)) return fail(res, 400, 'Scope must be Seller Panel, Company, or Enterprise.');
      if (!inputTypes.has(inputType)) return fail(res, 400, 'Input Type must be Text, Number, Date, or List.');

      const mandatory = parseBoolean(body.mandatory, false, 'Mandatory');
      const visible = parseBoolean(body.visible, true, 'Visible');
      const searchable = parseBoolean(body.searchable, false, 'Searchable');
      const active = parseBoolean(body.isActive, true, 'Active status');
      for (const parsed of [mandatory, visible, searchable, active]) {
        if (parsed.error) return fail(res, 400, parsed.error);
      }

      const rows = await find('generic_records', { module: MODULE });
      if (rows.some((row) => folded(row.code) === folded(code))) return fail(res, 409, 'Attribute Code already exists.');

      const username = actor(req);
      const date = new Date().toISOString().slice(0, 10);
      const values = {
        module: MODULE,
        code,
        name: description,
        description,
        status: active.value ? 'Active' : 'Inactive',
        extra: {
          mandatory: mandatory.value,
          visible: visible.value,
          scope,
          searchable: searchable.value,
          input_type: inputType,
        },
        created_by: username,
        created_date: date,
        updated_by: username,
        updated_date: date,
      };
      return res.status(201).json(await insert('generic_records', values));
    }

    return fail(res, 405, 'Method not allowed.');
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Manage Attributes API error:', { name: error?.name, code: error?.code });
    return fail(res, 500, error.message || 'Manage Attribute request failed.');
  }
}
