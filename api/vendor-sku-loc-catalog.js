import { sendDatabaseUnavailable, cors, find, insert, actor } from './mongo.js';
import {
  fail, folded, locationCode, locationIsActive, numericFields, rowReference, skuCode, skuIsActive, text, vendorCode, vendorIsActive,
} from './vendor-sku-catalog-utils.js';

const MODULE = 'vendor-sku-loc-catalog';
const numeric = [['cost', 'Cost'], ['maxOrder', 'Maximum Order Qty'], ['minOrder', 'Minimum Order Qty'], ['leadTime', 'Lead Time (Days)']];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const [allVendors, allSkus, allLocations, rows] = await Promise.all([
      find('vendors', {}), find('skus', {}), find('generic_records', { module: 'location' }),
      find('generic_records', { module: MODULE }, { sort: { id: -1 } }),
    ]);
    const vendors = allVendors.filter(vendorIsActive).map((row) => ({ id: row.id, vendor_code: vendorCode(row), vendor_name: text(row.vendor_name || row.name), status: row.status }));
    const skus = allSkus.filter(skuIsActive).map((row) => ({ id: row.id, sku_code: skuCode(row), name: text(row.name), status: row.status || 'Active' }));
    const locations = allLocations.filter(locationIsActive).map((row) => ({ id: row.id, code: locationCode(row), name: text(row.location_name || row.name), status: row.status || 'Active' }));

    if (req.method === 'GET') return res.status(200).json({ rows, vendors, skus, locations });
    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed.');

    const body = req.body || {};
    const vendor = text(body.vendor);
    const sku = text(body.sku);
    const location = text(body.location);
    if (!vendor || !sku || !location) return fail(res, 400, 'Vendor, SKU, and Location are mandatory.');
    const vendorRecord = allVendors.find((row) => folded(vendorCode(row)) === folded(vendor));
    if (!vendorRecord || !vendorIsActive(vendorRecord)) return fail(res, 400, 'Select an active Vendor Master record.');
    const skuRecord = allSkus.find((row) => folded(skuCode(row)) === folded(sku));
    if (!skuRecord || !skuIsActive(skuRecord)) return fail(res, 400, 'Select an active Master SKU record.');
    const locationRecord = allLocations.find((row) => folded(locationCode(row)) === folded(location));
    if (!locationRecord || !locationIsActive(locationRecord)) return fail(res, 400, 'Select an active Location Master record.');

    const normalized = numericFields(body, numeric);
    if (normalized.error) return fail(res, 400, normalized.error);
    const values = normalized.values;
    const canonicalVendor = vendorCode(vendorRecord);
    const canonicalSku = skuCode(skuRecord);
    const canonicalLocation = locationCode(locationRecord);
    const code = `${canonicalVendor}:${canonicalSku}:${canonicalLocation}`;
    if (rows.some((row) => folded(row.code) === folded(code)
      || (folded(rowReference(row, 'vendor', row.code?.split(':')[0])) === folded(canonicalVendor)
        && folded(rowReference(row, 'sku', row.code?.split(':')[1])) === folded(canonicalSku)
        && folded(rowReference(row, 'location', row.code?.split(':')[2])) === folded(canonicalLocation)))) {
      return fail(res, 409, 'Vendor, SKU, and Location already exist in Vendor SKU Location Catalog.');
    }

    const username = actor(req);
    const date = new Date().toISOString().slice(0, 10);
    return res.status(201).json(await insert('generic_records', {
      module: MODULE,
      code,
      name: canonicalSku,
      description: '',
      status: 'Active',
      extra: { vendor: canonicalVendor, sku: canonicalSku, location: canonicalLocation, ...values },
      created_by: username,
      created_date: date,
      updated_by: username,
      updated_date: date,
    }));
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Vendor SKU Location Catalog API error:', { name: error?.name, code: error?.code });
    return fail(res, 500, error.message || 'Vendor SKU Location Catalog request failed.');
  }
}
