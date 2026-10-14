export function isInboundQuantity(value, minimum = 0) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return false;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= minimum;
}
export function isInboundRow(row) {
  return !!row && typeof row === 'object' && !Array.isArray(row);
}
export function isInboundRecordId(value) {
  // The existing create form uses numeric zero or an empty string for new rows.
  if (value === undefined || value === 0 || value === '') return true;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return false;
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}
export function addInboundQuantities(left, right) {
  if (!isInboundQuantity(left) || !isInboundQuantity(right) || !Number.isSafeInteger(Number(left) + Number(right))) {
    throw Object.assign(new Error('Inbound quantity total exceeds the supported safe-integer range or contains an invalid quantity.'), { status: 400 });
  }
  return Number(left) + Number(right);
}
