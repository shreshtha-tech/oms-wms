import { sendDatabaseUnavailable, find, cors } from './mongo.js';

const text = (value) => String(value ?? '').trim();

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

    if (req.method === 'POST' || req.method === 'PUT') {
      return res.status(501).json({
        code: 'SKU_MASTER_POSTGRES_REQUIRED',
        error: 'SKU changes require the Central Inventory product workflow. MongoDB SKU writes are paused.',
        path: '/api/inventory-sync/central/products',
      });
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
