export const text = (value) => String(value ?? '').trim();
export const folded = (value) => text(value).toLocaleLowerCase('en');
export const fail = (res, status, error) => res.status(status).json({ error });

export function numericFields(body, fields) {
  const values = {};
  for (const [key, label] of fields) {
    const raw = body[key];
    if (raw === undefined || raw === null || raw === '') {
      values[key] = '';
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { error: `${label} must be a non-negative number.` };
    values[key] = value;
  }
  const minimum = values.minOrder;
  const maximum = values.maxOrder;
  if (minimum !== '' && maximum !== '' && minimum > maximum) return { error: 'Minimum Order Qty cannot exceed Maximum Order Qty.' };
  return { values };
}

export const vendorIsActive = (row) => ['active', 'confirmed'].includes(folded(row.status));
export const skuIsActive = (row) => !row.status || folded(row.status) === 'active';
export const locationIsActive = (row) => !row.status || folded(row.status) === 'active';

export function vendorCode(row) { return text(row.vendor_code || row.code); }
export function skuCode(row) { return text(row.sku_code || row.code); }
export function locationCode(row) { return text(row.location_code || row.code); }

export function rowReference(row, key, fallback) {
  return text(row.extra?.[key] ?? row[key] ?? fallback);
}
