import { sendDatabaseUnavailable, find, findOne, insert, update, remove, cors, actor } from './mongo.js';

const text = (value) => String(value ?? '').trim();
const enumValue = (value, allowed, label) => {
  const normalized = text(value);
  if (!allowed.includes(normalized)) return `${label} must be one of: ${allowed.join(', ')}.`;
  return null;
};

async function findMasterSku(code) {
  const wanted = text(code).toLowerCase();
  if (!wanted) return null;
  return (await find('skus', {})).find((row) => text(row.sku_code).toLowerCase() === wanted) || null;
}

function normalizeBarcode(body, current, masterSku) {
  const sku_code = text(body.sku_code ?? current.sku_code);
  const sku_barcode = text(body.sku_barcode ?? current.sku_barcode);
  if (!sku_code) return { error: 'SKU Code is required.' };
  if (!masterSku) return { error: 'SKU Code does not exist in Master SKU.' };
  if (!sku_barcode) return { error: 'SKU Barcode is required.' };

  const is_active = body.is_active ?? current.is_active ?? 'Active';
  const is_default = body.is_default ?? current.is_default ?? 'Yes';
  const is_saleable = body.is_saleable ?? current.is_saleable ?? 'Yes';
  const is_purchasable = body.is_purchasable ?? current.is_purchasable ?? 'Yes';
  for (const [value, allowed, label] of [
    [is_active, ['Active', 'Inactive'], 'Is Active'],
    [is_default, ['Yes', 'No'], 'Is Default'],
    [is_saleable, ['Yes', 'No'], 'Is Saleable'],
    [is_purchasable, ['Yes', 'No'], 'Is Purchasable'],
  ]) {
    const error = enumValue(value, allowed, label);
    if (error) return { error };
  }

  const caseSizeRaw = body.case_size ?? current.case_size ?? 1;
  const case_size = Number(caseSizeRaw);
  if (!Number.isSafeInteger(case_size) || case_size < 1) return { error: 'Case Size must be a positive whole number.' };
  const salePriceRaw = body.sale_price ?? current.sale_price ?? 0;
  const sale_price = Number(salePriceRaw);
  if (!Number.isFinite(sale_price) || sale_price < 0 || sale_price > 999999999999999) return { error: 'Sale Price must be a non-negative number within the supported limit.' };

  const numeric = {};
  for (const [field, label] of [['length', 'Length'], ['breath', 'Breadth'], ['height', 'Height'], ['weight', 'Weight'], ['cube', 'Cube'], ['cost', 'Cost']]) {
    const raw = body[field] ?? current[field] ?? 0;
    const value = Number(raw === '' ? 0 : raw);
    if (!Number.isFinite(value) || value < 0) return { error: `${label} must be a non-negative number.` };
    numeric[field] = value;
  }

  return { values: {
    client: text(body.client ?? current.client),
    sku_code: masterSku.sku_code,
    sku_name: text(body.sku_name ?? current.sku_name) || text(masterSku.name),
    sku_barcode,
    uom: text(body.uom ?? current.uom) || 'Each',
    barcode_type: text(body.barcode_type ?? current.barcode_type) || 'Default',
    is_active,
    is_default,
    is_saleable,
    is_purchasable,
    case_size,
    sale_price,
    import_batch_no: text(body.import_batch_no ?? current.import_batch_no),
    additional_uom: text(body.additional_uom ?? current.additional_uom),
    primary_vendor: text(body.primary_vendor ?? current.primary_vendor),
    vendor: text(body.vendor ?? current.vendor),
    ...numeric,
  } };
}

async function barcodeCollision(code, exceptId = null) {
  const wanted = text(code).toLowerCase();
  return (await find('sku_barcode', {})).some((row) => row.id !== exceptId && text(row.sku_barcode).toLowerCase() === wanted);
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await find('sku_barcode', {}, { sort: { id: -1 } }));
    }

    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const body = req.body;
      const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
      const rows = (await find('sku_barcode', {})).filter((row) => (
        has(row.client, body.client) && has(row.sku_code, body.skuCode) && has(row.sku_name, body.skuName)
        && has(row.sku_barcode, body.skuBarcode) && has(row.uom, body.uom)
        && has(row.barcode_type, body.barcodeType) && has(row.is_active, body.isActive)
        && has(row.is_default, body.isDefault)
      ));
      const direction = text(body.sord) === 'asc' ? 1 : -1;
      rows.sort((left, right) => text(left.sku_code).localeCompare(text(right.sku_code)) * direction);
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = rows.length;
      const total = Math.ceil(records / size);
      const gridModel = rows.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const masterSku = await findMasterSku(body.sku_code);
      const normalized = normalizeBarcode(body, {}, masterSku);
      if (normalized.error) return res.status(400).json({ error: normalized.error });
      if (await barcodeCollision(normalized.values.sku_barcode)) return res.status(409).json({ error: 'SKU Barcode already exists.' });
      const date = new Date().toISOString().slice(0, 10);
      return res.status(201).json(await insert('sku_barcode', {
        ...normalized.values,
        created_by: actor(req),
        created_date: date,
        modified_by: actor(req),
        modified_date: date,
      }));
    }

    if (req.method === 'PUT') {
      const id = Number(req.body?.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'A valid SKU Barcode ID is required.' });
      const current = await findOne('sku_barcode', { id });
      if (!current) return res.status(404).json({ error: 'SKU Barcode not found.' });
      const body = req.body || {};
      const masterSku = await findMasterSku(body.sku_code ?? current.sku_code);
      const normalized = normalizeBarcode(body, current, masterSku);
      if (normalized.error) return res.status(400).json({ error: normalized.error });
      if (await barcodeCollision(normalized.values.sku_barcode, current.id)) return res.status(409).json({ error: 'SKU Barcode already exists.' });
      const rows = await update('sku_barcode', current.id, {
        ...current,
        ...normalized.values,
        created_by: current.created_by || actor(req),
        created_date: current.created_date || new Date().toISOString().slice(0, 10),
        modified_by: actor(req),
        modified_date: new Date().toISOString().slice(0, 10),
      });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const id = Number(req.body?.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'A valid SKU Barcode ID is required.' });
      if (!await findOne('sku_barcode', { id })) return res.status(404).json({ error: 'SKU Barcode not found.' });
      return res.status(200).json(await remove('sku_barcode', id));
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('SKU Barcode API error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message || 'SKU Barcode request failed.' });
  }
}
