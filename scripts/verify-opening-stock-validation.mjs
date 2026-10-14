import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { validateOpeningStockWorkbook } from '../inventory/opening-stock-validation.js';

const mapping = {
  version: 'fixture-v1', sheet: 'Count', headerRow: 1,
  sku: { column: 1, header: 'Seller SKU ID', transform: 'trim' },
  location: { mode: 'column', column: 2, header: 'Facility', transform: 'trim' },
  quantity: { column: 3, header: 'Counted units', format: 'integer_plain' },
  unitContract: 'exact_sku_units', uom: 'EA', approved: false,
};
const skus = [
  { tenantId: 't1', id: 'sku-a', sku: 'A', uom: 'EA', active: true },
  { tenantId: 't1', id: 'sku-b', sku: 'B', uom: 'EA', active: false },
  { tenantId: 't2', id: 'sku-foreign', sku: 'FOREIGN', uom: 'EA', active: true },
];
const locations = [
  { tenantId: 't1', id: 'location-w', code: 'WH', type: 'warehouse', active: true },
  { tenantId: 't1', id: 'location-inactive', code: 'CLOSED', type: 'warehouse', active: false },
];

async function dryRun(data, changes = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Count');
  sheet.addRow(['Seller SKU ID', 'Facility', 'Counted units']);
  data.forEach(row => sheet.addRow(row));
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  return validateOpeningStockWorkbook({ bytes, tenantId: 't1', mapping: { ...mapping, ...changes }, skus, locations });
}

let result = await dryRun([['A', 'WH', 7]]);
assert.equal(result.rows[0].status, 'VALID');
assert.equal(result.rowsReadyToImport, 0, 'Dry run cannot assert approval');
assert.equal(result.rowsReadyForApproval, 1);
assert.equal(result.rows[0].quantity, 7);
assert.equal(JSON.stringify(result).includes('"sku":"A"'), false, 'Raw SKU must not enter report');
result = await dryRun([['A', 'WH', 7]], { approved: true });
assert.equal(result.rowsReadyToImport, 0, 'Caller-supplied approval cannot enable import');
result = await dryRun([['A', 'Source WH', 7]], { location: { ...mapping.location, valueMap: { 'Source WH': 'WH' } } });
assert.equal(result.rows[0].status, 'VALID', 'Explicit facility translation should resolve');
result = await dryRun([['A', 'WH', 7]], { location: { ...mapping.location, valueMap: { 'Source WH': 'WH' } } });
assert.equal(result.rows[0].status, 'UNMAPPED_LOCATION', 'A declared map cannot silently fall back to the source code');
result = await dryRun([['A', '', 7]], { location: { mode: 'constant', code: 'WH', evidenceRef: 'approved-facility-contract' } });
assert.equal(result.rows[0].status, 'VALID', 'Explicit evidenced constant location should resolve');
await assert.rejects(() => dryRun([['A', '', 7]], { location: { mode: 'constant', code: 'WH' } }), /evidence reference/);

const cases = [
  [['FOREIGN', 'WH', 1], 'UNMAPPED_SKU'],
  [['A', 'UNKNOWN', 1], 'UNMAPPED_LOCATION'],
  [['B', 'WH', 1], 'INACTIVE_SKU'],
  [['A', 'CLOSED', 1], 'INACTIVE_LOCATION'],
  [['A', 'WH', -1], 'NEGATIVE_QUANTITY'],
  [['A', 'WH', 1.5], 'DECIMAL_NOT_ALLOWED'],
  [['A', 'WH', '9007199254740993'], 'OVERFLOW'],
  [['A', 'WH', 'bad'], 'INVALID_QUANTITY'],
  [['A', 'WH', null], 'MISSING_REQUIRED_FIELD'],
  [['A', 'WH', { formula: '2+3', result: 5 }], 'AMBIGUOUS'],
];
for (const [row, expected] of cases) {
  result = await dryRun([row]);
  assert.equal(result.rows[0].status, expected, JSON.stringify(row));
  assert.equal(result.rowsReadyToImport, 0);
  assert.ok(result.rows[0].issues.every(item => item.sourceColumn && item.valueReference));
}
result = await dryRun([['A', 'WH', 7], ['A', 'WH', 7]]);
assert.equal(result.rowsDuplicated, 2);
assert.ok(result.rows.every(row => row.issues.some(item => item.status === 'DUPLICATE')));
result = await dryRun([['A', 'WH', 7], ['A', 'WH', 8]]);
assert.ok(result.rows.every(row => row.status === 'CONFLICTING_QUANTITY'));
await assert.rejects(() => dryRun([['A', 'WH', 1]], { quantity: { column: 3, header: 'Stock', format: 'integer_plain' } }), /header differs/);
console.log('PASS read-only opening-stock row classification, tenant scope, exact mapping and duplicate conflicts');
