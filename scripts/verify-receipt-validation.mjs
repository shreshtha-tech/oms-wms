import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const testUsername = process.env.ERETAIL_TEST_USERNAME || 'receipt';
const testPassword = process.env.ERETAIL_TEST_PASSWORD || 'local';
const suffix = Date.now().toString().slice(-8);
const boolKeys = [
  'receiveMoreThanPO', 'isDefault', 'allowOtherThanPOSKUs', 'lineLevelInvoiceQty', 'headerLevelInvoiceQty', 'matchMRP',
  'invoiceDateMandatory', 'invoiceAmountMandatory', 'invoiceTaxMandatory', 'materialRcvdDate', 'allowExcessQty', 'generateAdvUSN',
  'allowVirtualBom', 'attachmentMandatory', 'invoiceAmountValidation', 'challanNoMandatory', 'mrpValidation', 'reasonMandatory',
  'marginValidation', 'withOutMarginValidation', 'restrictShortReceiving',
];
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: testUsername, password: testPassword }),
});
assert.equal(login.status, 200, 'The isolated administrator must authenticate before calling WMS APIs.');
const sessionCookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(sessionCookie, /^dmills_session=[a-f0-9]{64}$/);
const send = async (method, body = {}) => {
  const response = await fetch(`${base}/api/receipt-validations`, {
    method,
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json() };
};
const query = (overrides = {}) => ({
  action: 'search', REQ_SEARCH_FLAG: true, rows: 20, page: 1, sidx: 'id.inboundCode', sord: 'desc',
  receivingValidationCode: '', description: '', ...Object.fromEntries(boolKeys.map((key) => [key, false])), ...overrides,
});
const inventoryEvents = async () => {
  const response = await fetch(`${base}/api/inventory-sync/central/events`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  return (await response.json()).map((event) => event.event_key).sort();
};
const config = (code, description = `Receipt ${code}`) => ({
  id: null, receivingValidationCode: code, description, percentage: '12.5', varianceAllowed: '5',
  mrpVarianceAllowed: '10', marginVarianceAllowed: '1.25', withOutMarginVarianceAllowed: '2.5', shortReceivingTolerance: '25',
  receiveMoreThanPO: true, isDefault: false, allowOtherThanPOSKUs: false, lineLevelInvoiceQty: false,
  headerLevelInvoiceQty: true, matchMRP: false, invoiceDateMandatory: true, invoiceAmountMandatory: true,
  invoiceTaxMandatory: false, materialRcvdDate: true, allowExcessQty: false, generateAdvUSN: false,
  allowVirtualBom: false, attachmentMandatory: false, invoiceAmountValidation: true, challanNoMandatory: false,
  mrpValidation: true, reasonMandatory: false, marginValidation: true, withOutMarginValidation: true,
  restrictShortReceiving: true, action: 'save',
});

const eventsBefore = await inventoryEvents();
for (const size of [20, 50, 100, 200]) {
  const result = await send('POST', query({ rows: size }));
  assert.equal(result.response.status, 200);
  assert.equal(result.json.rows, size);
  assert.ok(result.json.receiptValidationDTOs.length <= size);
  assert.deepEqual(result.json.receiptValidationDTOs, result.json.gridModel);
  for (const key of ['rows', 'page', 'records', 'total', 'receiptValidationDTOs']) assert.ok(key in result.json);
}
let invalid = await send('POST', { action: 'save' });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'Please Enter Receipt Validation Code');
invalid = await send('POST', { ...config(`RV${suffix}`), percentage: '1.2.3' });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'Please Enter Valid Percentage');
invalid = await send('POST', { ...config(`RV${suffix}`), marginVarianceAllowed: 'abc' });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'Margin Variance Allowed for Margin must be numeric.');
invalid = await send('POST', { ...config(`RV${suffix}`), shortReceivingTolerance: '101' });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'Less Receiving Tolerance Percentage must be between 0 and 100.');
invalid = await send('POST', { ...config(`RV${suffix}`), isDefault: 'false' });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'isDefault must be true or false.');
const first = await send('POST', { ...config(`RVA${suffix}`), isDefault: true });
assert.equal(first.response.status, 201);
assert.equal(first.json.row.created_by, testUsername);
const second = await send('POST', config(`RVB${suffix}`));
assert.equal(second.response.status, 201);
invalid = await send('POST', config(`RVB${suffix}`));
assert.equal(invalid.response.status, 409);
invalid = await send('PUT', { ...config(`RVX${suffix}`), id: Number.MAX_SAFE_INTEGER });
assert.equal(invalid.response.status, 404);
const updateFirst = await send('PUT', { ...config(`RVA${suffix}`, `Edited ${suffix}`), id: first.json.row.id, isDefault: true });
assert.equal(updateFirst.response.status, 200);
assert.equal(updateFirst.json.row.modified_by, testUsername);
let rows = await send('POST', query());
assert.equal(rows.json.records, 2);
assert.equal(rows.json.receiptValidationDTOs.filter((row) => row.isDefault).length, 1);
assert.equal(rows.json.receiptValidationDTOs.find((row) => row.receivingValidationCode === `RVA${suffix}`).description, `Edited ${suffix}`);
const filtered = await send('POST', query({ receivingValidationCode: `RVA${suffix}` }));
assert.equal(filtered.json.records, 1);
assert.deepEqual(await inventoryEvents(), eventsBefore);

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(base);
  await page.getByLabel('Login Id').fill(testUsername);
  await page.getByLabel('Password').fill(testPassword);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/wms/receipt-validation`);
  await page.getByRole('status').getByText('PO receipt processing does not enforce these options', { exact: false }).waitFor();
  for (const heading of ['Receiving Validation Code', 'Description', 'Default', 'Receive More Than Doc', 'Invoice Amount Validation', 'Less Receiving Tolerance']) await page.getByRole('columnheader', { name: heading, exact: true }).waitFor();
  for (const label of ['Receiving Validation Code*', 'Description*', 'Percentage', 'Receive More Than Doc', 'Invoice Amount Validation', 'Variance Allowed', 'Lottable01 MRP Validation', 'MRP Variance allowed(%)', 'Margin Tolerance', 'Margin Variance Allowed(%)', 'w/o Margin Tolerance', 'Without Margin Variance Allowed(%)', 'Restrict Less Than Doc Qty', 'Less Receiving Tolerance']) await page.getByLabel(label, { exact: true }).waitFor();
  for (const size of ['20', '50', '100', '200']) await page.getByLabel('Records per Page').selectOption(size);
  await page.getByLabel('Invoice Amount Validation', { exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Please Enter Receipt Validation Code', { exact: true }).waitFor();
  const code = `RVC${suffix}`;
  await page.getByLabel('Receiving Validation Code*', { exact: true }).fill(code);
  await page.getByLabel('Description*', { exact: true }).fill(`UI Receipt ${suffix}`);
  await page.getByLabel('Percentage', { exact: true }).fill('12.5');
  await page.getByLabel('Receive More Than Doc', { exact: true }).check();
  await page.getByLabel('Invoice Amount Validation', { exact: true }).check();
  await page.getByLabel('Variance Allowed', { exact: true }).fill('5');
  await page.getByLabel('Lottable01 MRP Validation', { exact: true }).check();
  await page.getByLabel('MRP Variance allowed(%)', { exact: true }).fill('10');
  await page.getByLabel('Margin Tolerance', { exact: true }).check();
  await page.getByLabel('Margin Variance Allowed(%)', { exact: true }).fill('1.25');
  await page.getByLabel('w/o Margin Tolerance', { exact: true }).check();
  await page.getByLabel('Without Margin Variance Allowed(%)', { exact: true }).fill('2.5');
  await page.getByLabel('Restrict Less Than Doc Qty', { exact: true }).check();
  await page.getByLabel('Less Receiving Tolerance', { exact: true }).fill('25');
  const saveResponse = page.waitForResponse((response) => response.url().endsWith('/api/receipt-validations') && response.request().method() === 'POST' && response.status() === 201);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const uiCreated = await (await saveResponse).json();
  assert.equal(uiCreated.row.receivingValidationCode, code);
  assert.equal(uiCreated.row.created_by, testUsername);
  await page.getByRole('button', { name: code, exact: true }).waitFor();
  const readback = await send('POST', query({ receivingValidationCode: code }));
  assert.equal(readback.json.records, 1);
  assert.equal(readback.json.receiptValidationDTOs[0].marginVarianceAllowed, '1.25');
  await page.getByRole('button', { name: code, exact: true }).click();
  await page.getByLabel('Description*', { exact: true }).fill(`UI Receipt Edited ${suffix}`);
  const editResponse = page.waitForResponse((response) => response.url().endsWith('/api/receipt-validations') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal((await editResponse).status(), 200);
  const edited = await send('POST', query({ receivingValidationCode: code }));
  assert.equal(edited.json.receiptValidationDTOs[0].description, `UI Receipt Edited ${suffix}`);
  assert.equal(edited.json.receiptValidationDTOs[0].modified_by, testUsername);
  const exportWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await exportWait;
  assert.equal(download.suggestedFilename(), 'receipt-validation.csv');
  let csv = '';
  for await (const chunk of await download.createReadStream()) csv += chunk.toString();
  assert.ok(csv.includes(code));
  assert.deepEqual(errors, []);
  assert.deepEqual(await inventoryEvents(), eventsBefore);
  console.log('PASS Receipt Validation: signed-in config create/edit/readback, conditional numeric validation, default exclusivity, filter/paging/export, actor attribution, and no Central Inventory events. The saved policy is not enforced by PO receiving.');
} finally {
  await browser.close();
}
