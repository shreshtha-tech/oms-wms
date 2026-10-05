import { sendDatabaseUnavailable, find, findOne, insert, update, ensureIndex, cors, actor } from './mongo.js';

let skuCodeIndex;
async function ensureSkuCodeIndex() {
  skuCodeIndex ??= ensureIndex('skus', { sku_code: 1 }, { name: 'uq_master_sku_code', unique: true, partialFilterExpression: { sku_code: { $type: 'string' } }, collation: { locale: 'en', strength: 2 } }).catch(error => { skuCodeIndex = null; throw error; });
  return skuCodeIndex;
}
const text = (value) => String(value ?? '').trim();
const isStatus = (value) => ['Active', 'Inactive'].includes(value);

async function validateTaxCategory(hsn, currentHsn = '') {
  if (!hsn) return null;
  const category = await findOne('generic_records', { module: 'tax-category', code: hsn });
  if (!category) return 'HSN/SAC Category does not exist';
  if (category.status !== 'Active' && hsn !== currentHsn) return 'Inactive HSN/SAC Category cannot be assigned';
  return null;
}

function normalizePrices(fields) {
  const values = {};
  for (const [key, label] of [['mrp', 'MRP'], ['cost_price', 'Cost Price'], ['sale_price', 'Sale Price']]) {
    const raw = fields[key] ?? 0;
    if (raw === '') { values[key] = 0; continue; }
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) return { error: `${label} must be a non-negative number.` };
    values[key] = amount;
  }
  return { values };
}

function normalizeSku(body, current = {}) {
  const sku_code = text(body.sku_code ?? current.sku_code);
  const name = text(body.name ?? current.name);
  if (!sku_code) return { error: 'Please Enter SKU Code' };
  if (!name) return { error: 'Please Enter SKU Name' };
  const status = body.status ?? current.status ?? 'Active';
  if (body.status !== undefined && !isStatus(body.status)) return { error: 'Status must be Active or Inactive.' };
  if (!current.id && !isStatus(status)) return { error: 'Status must be Active or Inactive.' };
  const prices = normalizePrices({
    mrp: body.mrp ?? current.mrp,
    cost_price: body.cost_price ?? current.cost_price,
    sale_price: body.sale_price ?? current.sale_price,
  });
  if (prices.error) return prices;
  return {
    values: {
      master_sku_code: text(body.master_sku_code ?? current.master_sku_code),
      sku_code,
      style: text(body.style ?? current.style),
      name,
      classification: text(body.classification ?? current.classification),
      category: text(body.category ?? current.category),
      brand: text(body.brand ?? current.brand),
      uom: text(body.uom ?? current.uom),
      ...prices.values,
      hsn: text(body.hsn ?? current.hsn),
      sku_mfg_code: text(body.sku_mfg_code ?? current.sku_mfg_code),
      primary_vendor: text(body.primary_vendor ?? current.primary_vendor),
      hierarchy_code: text(body.hierarchy_code ?? current.hierarchy_code),
      attribute_set: text(body.attribute_set ?? current.attribute_set),
      back_order: text(body.back_order ?? current.back_order) || 'No',
      status,
    },
  };
}

async function listSkus() {
  return find('skus', {});
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await find('skus', {}, { sort: { id: 1 } }));
    }

    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const body = req.body;
      const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
      const globalSearch = text(body.globalSearch).toLowerCase();
      let rows = (await listSkus()).filter((row) => (
        has(row.client, body.client) && has(row.sku_code, body.sku) && has(row.style, body.style)
        && has(row.name, body.skuName) && has(row.temp_sku_code, body.tempSkuCode)
        && has(row.classification, body.classification) && has(row.size, body.size)
        && has(row.color || row.colour, body.color) && has(row.primary_vendor, body.vendorCode)
        && has(row.brand, body.brandCode) && has(row.hierarchy_code, body.hierarchyCode)
        && has(row.attribute_set, body.attributeSet) && has(row.size_group, body.sizeGroup)
        && has(row.status, body.status) && has(row.created_by, body.createdBy)
        && has(row.created_date, body.createdDate) && has(row.updated_by, body.updatedBy)
        && has(row.updated_date, body.updatedDate) && has(row.back_order, body.backOrder)
        && has(row.magento_status, body.magentoStatus)
        && (!globalSearch || ['master_sku_code', 'sku_code', 'style', 'name', 'category', 'classification', 'brand']
          .some((field) => text(row[field]).toLowerCase().includes(globalSearch)))
      ));
      const key = { sku: 'sku_code', style: 'style', SKUName: 'name' }[body.sidx] || 'sku_code';
      const direction = text(body.sord) === 'asc' ? 1 : -1;
      rows.sort((left, right) => text(left[key]).localeCompare(text(right[key])) * direction);
      const size = [50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 50;
      const page = Math.max(1, Number(body.page) || 1);
      const records = rows.length;
      const total = Math.ceil(records / size);
      const gridModel = rows.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
    }

    if (req.method === 'POST') {
      await ensureSkuCodeIndex();
      const normalized = normalizeSku(req.body || {});
      if (normalized.error) return res.status(400).json({ error: normalized.error });
      const values = normalized.values;
      if ((await listSkus()).some((sku) => text(sku.sku_code).toLowerCase() === values.sku_code.toLowerCase())) {
        return res.status(409).json({ error: 'SKU Code already exists' });
      }
      const taxError = await validateTaxCategory(values.hsn);
      if (taxError) return res.status(400).json({ error: taxError });
      const date = new Date().toISOString().slice(0, 10);
      return res.status(201).json(await insert('skus', {
        ...values,
        created_by: actor(req),
        created_date: date,
        updated_by: '',
        updated_date: '',
      }));
    }

    if (req.method === 'PUT') {
      await ensureSkuCodeIndex();
      const id = Number(req.body?.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'A valid SKU ID is required.' });
      const current = await findOne('skus', { id });
      if (!current) return res.status(404).json({ error: 'SKU not found' });
      const normalized = normalizeSku(req.body || {}, current);
      if (normalized.error) return res.status(400).json({ error: normalized.error });
      const values = normalized.values;
      if ((await listSkus()).some((sku) => sku.id !== current.id && text(sku.sku_code).toLowerCase() === values.sku_code.toLowerCase())) {
        return res.status(409).json({ error: 'SKU Code already exists' });
      }
      const taxError = await validateTaxCategory(values.hsn, current.hsn);
      if (taxError) return res.status(400).json({ error: taxError });
      const rows = await update('skus', current.id, {
        ...current,
        ...values,
        created_by: current.created_by || actor(req),
        created_date: current.created_date || new Date().toISOString().slice(0, 10),
        updated_by: actor(req),
        updated_date: new Date().toISOString().slice(0, 10),
      });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      return res.status(409).json({ error: 'SKUs cannot be deleted. Set Status to Inactive instead.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    if (error?.code === 11000) return res.status(409).json({ error: 'SKU Code already exists' });
    console.error('SKU API error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message || 'SKU request failed.' });
  }
}
