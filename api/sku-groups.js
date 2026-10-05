import { sendDatabaseUnavailable, find, findOne, insert, updateIfRevision, ensureIndex, cors, actor } from './mongo.js';
import { clientPairs } from './catalogs.js';

const MODULE = 'sku-group';
const text = (value) => String(value ?? '').trim();
const matches = (value, query) => !text(query) || text(query) === '-1'
  || text(value).toLocaleLowerCase('en').includes(text(query).toLocaleLowerCase('en'));
const fail = (res, status, error) => res.status(status).json({ error });
let skuGroupCodeIndex;
async function ensureSkuGroupCodeIndex() {
  if (!skuGroupCodeIndex) {
    skuGroupCodeIndex = ensureIndex('generic_records', { module: 1, code: 1 }, {
      name: 'uq_sku_group_code',
      unique: true,
      partialFilterExpression: { module: MODULE, code: { $type: 'string' } },
      collation: { locale: 'en', strength: 2 },
    }).catch(error => { skuGroupCodeIndex = null; throw error; });
  }
  return skuGroupCodeIndex;
}

function normalizeStatus(value, fallback = 'Active') {
  const status = text(value || fallback).toLocaleLowerCase('en');
  if (status === 'active') return 'Active';
  if (status === 'inactive') return 'InActive';
  return null;
}

async function normalizeForm(body, current = {}) {
  const code = text(body.code ?? current.code).toUpperCase();
  const name = text(body.name ?? current.name);
  const client = text(body.client ?? current.client);
  const status = normalizeStatus(body.status, current.status || 'Active');
  const rawSkus = body.skus ?? current.skus ?? [];
  if (!code || !name) return { error: 'SKU Group Code and SKU Group Name are mandatory.' };
  if (!status) return { error: 'Status must be Active or InActive.' };
  if (!Array.isArray(rawSkus)) return { error: 'SKUs must be supplied as a list.' };

  const submittedCodes = rawSkus.map(text).filter(Boolean);
  const foldedCodes = submittedCodes.map((skuCode) => skuCode.toLocaleLowerCase('en'));
  if (new Set(foldedCodes).size !== foldedCodes.length) return { error: 'Duplicate SKUs cannot be assigned to a SKU Group.' };

  const [skuRows, clients] = await Promise.all([find('skus', {}), clientPairs()]);
  const canonicalSkus = [];
  for (const skuCode of submittedCodes) {
    const row = skuRows.find((sku) => text(sku.sku_code).toLocaleLowerCase('en') === skuCode.toLocaleLowerCase('en'));
    if (!row) return { error: `SKU Code ${skuCode} does not exist in Master SKU.` };
    canonicalSkus.push(row.sku_code);
  }

  if (client && client !== text(current.client)) {
    const knownClients = new Set(clients.map(([id, label]) => `${id}-${label}`));
    if (!knownClients.has(client)) return { error: 'Client must be selected from Client Master.' };
  }

  return {
    values: {
      module: MODULE,
      client,
      code,
      name,
      skus: canonicalSkus,
      no_of_sku: canonicalSkus.length,
      status,
      description: text(body.description ?? current.description),
    },
  };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    if (req.method === 'GET') {
      const [rows, skus, clients] = await Promise.all([
        find('generic_records', { module: MODULE }),
        find('skus', {}),
        clientPairs(),
      ]);
      return res.status(200).json({ rows, skus, clients });
    }

    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const body = req.body;
      const allRows = await find('generic_records', { module: MODULE });
      const rows = allRows.filter((row) => (!text(body.clientId) || text(body.clientId) === '-1' || text(row.client) === text(body.clientId))
        && matches(row.code, body.skuGrpCode)
        && matches(row.name, body.skuGrpName)
        && matches(row.status, body.status));
      rows.sort((left, right) => text(left.code).localeCompare(text(right.code)) * (text(body.sord) === 'asc' ? 1 : -1));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = rows.length;
      const total = Math.ceil(records / size);
      const gridModel = rows.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      await ensureSkuGroupCodeIndex();
      const body = req.body || {};
      const id = Number(body.id);
      if (req.method === 'PUT' && (!Number.isSafeInteger(id) || id <= 0)) return fail(res, 400, 'A valid SKU Group ID is required.');
      const allRows = await find('generic_records', { module: MODULE });
      const current = req.method === 'PUT' ? await findOne('generic_records', { id }) : null;
      if (req.method === 'PUT' && (!current || current.module !== MODULE)) return fail(res, 404, 'SKU Group not found.');
      if (req.method === 'PUT' && text(body.code).toLocaleLowerCase('en') !== text(current.code).toLocaleLowerCase('en')) {
        return fail(res, 400, 'SKU Group Code cannot be changed.');
      }

      const expectedRevision = Number(body.revision ?? current?.revision ?? 0);
      if (req.method === 'PUT' && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== (current.revision || 0))) return fail(res, 409, 'SKU Group changed. Refresh before saving.');
      const normalized = await normalizeForm(body, current || {});
      if (normalized.error) return fail(res, 400, normalized.error);
      const values = normalized.values;
      if (allRows.some((row) => row.id !== current?.id && text(row.code).toLocaleLowerCase('en') === values.code.toLocaleLowerCase('en'))) {
        return fail(res, 409, 'SKU Group Code already exists.');
      }

      const username = actor(req);
      const date = new Date().toISOString().slice(0, 10);
      if (req.method === 'POST') {
        return res.status(201).json(await insert('generic_records', {
          ...values,
          revision: 0,
          created_by: username,
          created_date: date,
          updated_by: username,
          updated_date: date,
        }));
      }

      const saved = await updateIfRevision('generic_records', current.id, expectedRevision, {
        ...current,
        ...values,
        created_by: current.created_by || username,
        created_date: current.created_date || date,
        updated_by: username,
        updated_date: date,
      });
      if (!saved) return fail(res, 409, 'SKU Group changed. Refresh before saving.');
      return res.status(200).json(saved);
    }

    return fail(res, 405, 'Method not allowed.');
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    if (error?.code === 11000 && (error.keyPattern?.code || String(error.message).includes('uq_sku_group_code'))) {
      return fail(res, 409, 'SKU Group Code already exists.');
    }
    console.error('SKU Groups API error:', { name: error?.name, code: error?.code });
    return fail(res, 500, error.message || 'SKU Group request failed.');
  }
}
