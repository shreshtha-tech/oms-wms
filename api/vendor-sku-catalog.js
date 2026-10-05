import { sendDatabaseUnavailable, cors, find, insert, actor } from './mongo.js';
import {
  fail, folded, locationIsActive, numericFields, rowReference, skuCode, skuIsActive, text, vendorCode, vendorIsActive,
} from './vendor-sku-catalog-utils.js';

const MODULE = 'vendor-sku-catalog';
const numeric = [['cost', 'Cost'], ['mrp', 'SKU MRP'], ['margin', 'Margin Perc'], ['maxOrder', 'Maximum Order Qty'], ['minOrder', 'Minimum Order Qty'], ['leadTime', 'Lead Time (Days)']];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const [allVendors, allSkus, rows] = await Promise.all([
      find('vendors', {}), find('skus', {}), find('generic_records', { module: MODULE }, { sort: { id: -1 } }),
    ]);
    const vendors = allVendors.filter(vendorIsActive).map((row) => ({ id: row.id, vendor_code: vendorCode(row), vendor_name: text(row.vendor_name || row.name), status: row.status }));
    const skus = allSkus.filter(skuIsActive).map((row) => ({ id: row.id, sku_code: skuCode(row), name: text(row.name), status: row.status || 'Active' }));

    if (req.method === 'GET') return res.status(200).json({ rows, vendors, skus });
    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed.');

    const body = req.body || {};
    const vendor = text(body.vendor);
    const sku = text(body.sku);
    if (!vendor || !sku) return fail(res, 400, 'Vendor and SKU are mandatory.');
    const vendorRecord = allVendors.find((row) => folded(vendorCode(row)) === folded(vendor));
    if (!vendorRecord || !vendorIsActive(vendorRecord)) return fail(res, 400, 'Select an active Vendor Master record.');
    const skuRecord = allSkus.find((row) => folded(skuCode(row)) === folded(sku));
    if (!skuRecord || !skuIsActive(skuRecord)) return fail(res, 400, 'Select an active Master SKU record.');

    const normalized = numericFields(body, numeric);
    if (normalized.error) return fail(res, 400, normalized.error);
    const values = normalized.values;
    const canonicalVendor = vendorCode(vendorRecord);
    const canonicalSku = skuCode(skuRecord);
    const code = `${canonicalVendor}:${canonicalSku}`;
    if (rows.some((row) => folded(row.code) === folded(code)
      || (folded(rowReference(row, 'vendor', row.code?.split(':')[0])) === folded(canonicalVendor)
        && folded(rowReference(row, 'sku', row.code?.split(':')[1])) === folded(canonicalSku)))) {
      return fail(res, 409, 'Vendor and SKU already exist in Vendor SKU Catalog.');
    }

    const username = actor(req);
    const date = new Date().toISOString().slice(0, 10);
    return res.status(201).json(await insert('generic_records', {
      module: MODULE,
      code,
      name: canonicalSku,
      description: '',
      status: 'Active',
      extra: { vendor: canonicalVendor, sku: canonicalSku, ...values },
      created_by: username,
      created_date: date,
      updated_by: username,
      updated_date: date,
    }));
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Vendor SKU Catalog API error:', { name: error?.name, code: error?.code });
    return fail(res, 500, error.message || 'Vendor SKU Catalog request failed.');
  }
}
