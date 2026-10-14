import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';

const MAX_ROWS = 50_000;
const MAX_BYTES = 20 * 1024 * 1024;
const PRIORITY = ['CONFLICTING_QUANTITY','DUPLICATE_SKU_LOCATION','DUPLICATE','INACTIVE_SKU','INACTIVE_LOCATION','UNMAPPED_SKU','UNMAPPED_LOCATION','NEGATIVE_QUANTITY','DECIMAL_NOT_ALLOWED','OVERFLOW','INVALID_QUANTITY','MISSING_REQUIRED_FIELD','AMBIGUOUS','INVALID'];
const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const issue = (status, column, reason, value) => ({ status, sourceColumn: column, reason, valueReference: value == null || value === '' ? '[blank]' : `sha256:${hash(value)}` });
const canonical = value => String(value ?? '').trim();

function requiredColumn(spec, name) {
  if (!spec || !Number.isInteger(spec.column) || spec.column < 1 || typeof spec.header !== 'string' || !spec.header.trim()) {
    throw new Error(`An exact ${name} column number and header are required`);
  }
}

function quantityValue(cell, spec) {
  if (cell.type === ExcelJS.ValueType.Formula) return { error: 'AMBIGUOUS', reason: 'Formula quantity is not physical-count evidence' };
  const value = cell.value;
  if (value === null || value === undefined || value === '') return { error: 'MISSING_REQUIRED_FIELD', reason: 'Quantity is missing' };
  let parsed;
  if (typeof value === 'number') parsed = value;
  else if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return { error: 'MISSING_REQUIRED_FIELD', reason: 'Quantity is missing' };
    const syntax = spec.format === 'integer_grouped' ? /^-?(?:\d{1,3}(?:,\d{3})+|\d+)$/ : /^-?\d+$/;
    if (!syntax.test(raw)) {
      if (/^-?\d+\.\d+$/.test(raw)) return { error: 'DECIMAL_NOT_ALLOWED', reason: 'Decimal quantity is not allowed' };
      return { error: 'INVALID_QUANTITY', reason: 'Quantity does not match approved integer format' };
    }
    parsed = Number(spec.format === 'integer_grouped' ? raw.replaceAll(',', '') : raw);
  } else return { error: 'INVALID_QUANTITY', reason: 'Quantity must be an exact integer cell' };
  if (!Number.isFinite(parsed)) return { error: 'INVALID_QUANTITY', reason: 'Quantity is not finite' };
  if (!Number.isInteger(parsed)) return { error: 'DECIMAL_NOT_ALLOWED', reason: 'Decimal quantity is not allowed' };
  if (!Number.isSafeInteger(parsed)) return { error: 'OVERFLOW', reason: 'Quantity exceeds safe integer range' };
  if (parsed < 0) return { error: 'NEGATIVE_QUANTITY', reason: 'Negative opening quantity is not allowed' };
  return { value: parsed };
}

function selectStatus(issues) {
  if (!issues.length) return 'VALID';
  return PRIORITY.find(status => issues.some(item => item.status === status)) ?? 'INVALID';
}

/** Read-only dry run. Registries are tenant-scoped, independently verified snapshots. */
export async function validateOpeningStockWorkbook({ bytes, tenantId, mapping, skus, locations }) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new Error('Expected a nonempty .xlsx workbook no larger than 20 MB');
  if (!tenantId || typeof tenantId !== 'string') throw new Error('Tenant identity is required');
  if (!mapping || typeof mapping.version !== 'string' || !mapping.version || typeof mapping.sheet !== 'string' || !mapping.sheet || !Number.isInteger(mapping.headerRow) || mapping.headerRow < 1) throw new Error('Versioned exact sheet and header row mapping is required');
  for (const name of ['sku','quantity']) requiredColumn(mapping[name], name);
  if (mapping.location?.mode === 'column') requiredColumn(mapping.location, 'location');
  else if (mapping.location?.mode === 'constant') {
    if (typeof mapping.location.code !== 'string' || !mapping.location.code.trim() || typeof mapping.location.evidenceRef !== 'string' || !mapping.location.evidenceRef.trim()) throw new Error('A constant location requires an exact code and evidence reference');
  } else throw new Error('Location mapping mode must be column or approved constant');
  const columns = [mapping.sku.column, mapping.quantity.column, ...(mapping.location.mode === 'column' ? [mapping.location.column] : [])];
  if (new Set(columns).size !== columns.length) throw new Error('SKU, location and quantity columns must differ');
  if (mapping.sku.transform !== 'trim' || (mapping.location.mode === 'column' && mapping.location.transform !== 'trim')) throw new Error('SKU and location transformations must be explicit');
  if (mapping.location.valueMap !== undefined && (mapping.location.mode !== 'column' || mapping.location.valueMap === null || Array.isArray(mapping.location.valueMap) || typeof mapping.location.valueMap !== 'object')) throw new Error('Location value map must be an explicit object for a column mapping');
  if (!['integer_plain','integer_grouped'].includes(mapping.quantity.format)) throw new Error('Quantity format must be explicit');
  if (mapping.unitContract !== 'exact_sku_units') throw new Error('A verified exact-SKU unit contract is required');
  if (typeof mapping.uom !== 'string' || !mapping.uom) throw new Error('Explicit physical UOM is required');
  if (!Array.isArray(skus) || !Array.isArray(locations)) throw new Error('Tenant-scoped SKU and location registry snapshots are required');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet(mapping.sheet);
  if (!sheet) throw new Error('Mapped worksheet does not exist');
  if (sheet.rowCount - mapping.headerRow > MAX_ROWS) throw new Error('Maximum 50,000 opening-stock rows');
  for (const name of ['sku','quantity',...(mapping.location.mode === 'column' ? ['location'] : [])]) {
    const spec = mapping[name];
    if (canonical(sheet.getRow(mapping.headerRow).getCell(spec.column).text) !== spec.header) throw new Error(`Mapped ${name} header differs from workbook`);
    let headerMatches = 0;
    sheet.getRow(mapping.headerRow).eachCell(cell => { if (canonical(cell.text) === spec.header) headerMatches++; });
    if (headerMatches > 1 && mapping.allowDuplicateHeaders !== true) throw new Error(`Mapped ${name} header occurs more than once; explicit review required`);
  }
  const skuIndex = new Map(), locationIndex = new Map();
  for (const sku of skus) if (sku?.tenantId === tenantId && typeof sku.sku === 'string') {
    const items = skuIndex.get(sku.sku) ?? []; items.push(sku); skuIndex.set(sku.sku, items);
  }
  for (const location of locations) if (location?.tenantId === tenantId && typeof location.code === 'string') {
    const items = locationIndex.get(location.code) ?? []; items.push(location); locationIndex.set(location.code, items);
  }
  const rows = [], byPair = new Map();
  for (let rowNumber = mapping.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    if (!row.hasValues) continue;
    const skuCell = row.getCell(mapping.sku.column), locationCell = mapping.location.mode === 'column' ? row.getCell(mapping.location.column) : null, quantityCell = row.getCell(mapping.quantity.column);
    const sku = canonical(skuCell.value), rawLocation = locationCell ? canonical(locationCell.value) : mapping.location.code;
    const location = mapping.location.valueMap === undefined ? rawLocation : Object.hasOwn(mapping.location.valueMap, rawLocation) ? canonical(mapping.location.valueMap[rawLocation]) : '';
    const locationSource = mapping.location.mode === 'column' ? mapping.location.header : '[approved constant]';
    const problems = [];
    for (const [name, cell, spec] of [['SKU',skuCell,mapping.sku],['Quantity',quantityCell,mapping.quantity],...(locationCell ? [['Location',locationCell,mapping.location]] : [])]) {
      if (cell.isMerged || cell.type === ExcelJS.ValueType.Formula) problems.push(issue('AMBIGUOUS', spec.header, `${name} comes from a merged or formula cell`, cell.address));
    }
    if (!sku) problems.push(issue('MISSING_REQUIRED_FIELD',mapping.sku.header,'SKU is missing',null));
    if (!rawLocation) problems.push(issue('MISSING_REQUIRED_FIELD',locationSource,'Location is missing',null));
    else if (!location) problems.push(issue('UNMAPPED_LOCATION',locationSource,'Source location has no approved value-map entry',rawLocation));
    const parsed = quantityValue(quantityCell,mapping.quantity);
    if (parsed.error) problems.push(issue(parsed.error,mapping.quantity.header,parsed.reason,quantityCell.address));
    const skuMatches = skuIndex.get(sku) ?? [], locationMatches = locationIndex.get(location) ?? [];
    if (sku && !skuMatches.length) problems.push(issue('UNMAPPED_SKU',mapping.sku.header,'SKU has no exact tenant-scoped match',sku));
    if (skuMatches.length > 1) problems.push(issue('AMBIGUOUS',mapping.sku.header,'SKU has multiple tenant-scoped matches',sku));
    if (skuMatches.length === 1 && !skuMatches[0].id) problems.push(issue('AMBIGUOUS',mapping.sku.header,'SKU identity is missing',sku));
    if (skuMatches.length === 1 && skuMatches[0].active !== true) problems.push(issue(skuMatches[0].active === false ? 'INACTIVE_SKU' : 'AMBIGUOUS',mapping.sku.header,'SKU active status is not verified',sku));
    if (location && !locationMatches.length) problems.push(issue('UNMAPPED_LOCATION',locationSource,'Location has no exact tenant-scoped match',location));
    if (locationMatches.length > 1) problems.push(issue('AMBIGUOUS',locationSource,'Location has multiple tenant-scoped matches',location));
    if (locationMatches.length === 1) {
      const match = locationMatches[0];
      if (match.active !== true) problems.push(issue(match.active === false ? 'INACTIVE_LOCATION' : 'AMBIGUOUS',locationSource,'Location active status is not verified',location));
      if (!match.id) problems.push(issue('AMBIGUOUS',locationSource,'Location identity is missing',location));
      if (!['warehouse','store'].includes(match.type)) problems.push(issue('AMBIGUOUS',locationSource,'Location is not an approved physical warehouse/store',location));
    }
    if (skuMatches.length === 1 && (!skuMatches[0].uom || skuMatches[0].uom !== mapping.uom)) problems.push(issue('AMBIGUOUS',mapping.sku.header,'SKU UOM differs from or is missing in approved mapping',sku));
    if (sheet.state !== 'visible' && mapping.allowHiddenSheet !== true) problems.push(issue('AMBIGUOUS',mapping.sheet,'Hidden worksheet requires explicit approval',sheet.name));
    const result = { sheet: sheet.name, row: rowNumber, status: 'INVALID', issues: problems, skuId: skuMatches.length === 1 ? skuMatches[0].id : null, locationId: locationMatches.length === 1 ? locationMatches[0].id : null, quantity: parsed.value ?? null };
    rows.push(result);
    if (sku && location) {
      const key = `${sku}\u0000${location}`; const grouped = byPair.get(key) ?? []; grouped.push(result); byPair.set(key, grouped);
    }
  }
  for (const group of byPair.values()) if (group.length > 1) {
    const quantities = new Set(group.map(row => row.quantity));
    for (const row of group) {
      row.issues.push(issue('DUPLICATE_SKU_LOCATION',mapping.sku.header,'SKU/location pair appears more than once',`${row.skuId}:${row.locationId}`));
      row.issues.push(issue(quantities.size > 1 ? 'CONFLICTING_QUANTITY' : 'DUPLICATE',mapping.quantity.header,quantities.size > 1 ? 'Conflicting quantities for SKU/location' : 'Duplicate quantity for SKU/location',row.row));
    }
  }
  for (const row of rows) row.status = selectStatus(row.issues);
  const counts = Object.fromEntries(['VALID','INVALID','AMBIGUOUS','DUPLICATE','UNMAPPED_SKU','UNMAPPED_LOCATION','INVALID_QUANTITY','NEGATIVE_QUANTITY','DECIMAL_NOT_ALLOWED','OVERFLOW','INACTIVE_SKU','INACTIVE_LOCATION','DUPLICATE_SKU_LOCATION','CONFLICTING_QUANTITY','MISSING_REQUIRED_FIELD'].map(status => [status,rows.filter(row => row.status === status).length]));
  const valid = counts.VALID;
  return {
    fileSha256: createHash('sha256').update(bytes).digest('hex'), mappingVersion: mapping.version,
    sheet: sheet.name, tenantId, rowsRead: rows.length, rowsValid: valid, rowsInvalid: rows.length - valid,
    rowsDuplicated: rows.filter(row => row.issues.some(item => ['DUPLICATE','DUPLICATE_SKU_LOCATION','CONFLICTING_QUANTITY'].includes(item.status))).length,
    rowsUnmapped: rows.filter(row => row.issues.some(item => ['UNMAPPED_SKU','UNMAPPED_LOCATION'].includes(item.status))).length,
    rowsAmbiguous: rows.filter(row => row.issues.some(item => item.status === 'AMBIGUOUS')).length,
    rowsReadyForApproval: rows.length > 0 && rows.length === valid ? valid : 0,
    rowsReadyToImport: 0,
    counts, rows,
    note: 'Read-only dry run. No database, ledger or provider writes. Import readiness requires a separate authenticated approval and posting service.',
  };
}
