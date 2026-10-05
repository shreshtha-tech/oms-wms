import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const testUsername = process.env.ERETAIL_TEST_USERNAME || 'lottable';
const testPassword = process.env.ERETAIL_TEST_PASSWORD || 'local';
const suffix = Date.now().toString().slice(-8);
const labels = ['Unique Batch Nos', 'Lottable2', 'Mfg Date', 'Lottable 04', 'Batch No', 'Recv Date', 'Lottable 07'];
const freshLottables = () => labels.map((label, index) => ({ label, mandatory: false, outward: false, mask: '', length: [0, 4, 5, 6].includes(index) ? '50' : '' }));
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: testUsername, password: testPassword }),
});
assert.equal(login.status, 200, 'The isolated administrator must authenticate before calling WMS APIs.');
const sessionCookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(sessionCookie, /^dmills_session=[a-f0-9]{64}$/);
const send = async (method, body = {}) => {
  const response = await fetch(`${base}/api/lottable-validations`, {
    method,
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json() };
};
const query = (overrides = {}) => ({ action: 'search', REQ_SEARCH_FLAG: true, rows: 20, page: 1, sord: 'asc', receivingValidationCode: '', description: '', isDefault: '-1', ...overrides });
const inventoryEvents = async () => {
  const response = await fetch(`${base}/api/inventory-sync/central/events`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  return (await response.json()).map((event) => event.event_key).sort();
};
const config = (code, isDefault = false, description = `Test ${code}`) => ({
  lotValCode: code, description, isDefault,
  lottables: freshLottables(),
});

const eventsBefore = await inventoryEvents();
for (const size of [20, 50, 100, 200]) {
  const result = await send('POST', query({ rows: size }));
  assert.equal(result.response.status, 200);
  assert.equal(result.json.rows, size);
  assert.equal(result.json.lottableValidationDTOs.length, result.json.records);
  assert.deepEqual(result.json.lottableValidationDTOs, result.json.gridModel);
}
let invalid = await send('POST', config('', false));
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'Please Enter Lottable Validation Code');
invalid = await send('POST', { ...config(`LV${suffix}`), lottables: freshLottables().slice(0, 6) });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'All seven lottable definitions are required.');
const badMask = config(`MASK${suffix}`);
badMask.lottables[0].length = '3';
badMask.lottables[0].mask = 'ABCD';
invalid = await send('POST', badMask);
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'Mask1 exceeds the limit');
const first = await send('POST', config(`LVA${suffix}`, false));
assert.equal(first.response.status, 201);
assert.equal(first.json.row.created_by, testUsername);
const second = await send('POST', config(`LVB${suffix}`, true));
assert.equal(second.response.status, 201);
let defaults = await send('POST', query());
assert.equal(defaults.json.lottableValidationDTOs.filter((row) => row.isDefault).length, 1);
assert.equal(defaults.json.lottableValidationDTOs.find((row) => row.lotValCode === `LVB${suffix}`).isDefault, true);
invalid = await send('POST', config(`LVB${suffix}`, false));
assert.equal(invalid.response.status, 409);
invalid = await send('PUT', { ...config(`LVX${suffix}`), id: Number.MAX_SAFE_INTEGER });
assert.equal(invalid.response.status, 404);
const editFirst = await send('PUT', { ...config(`LVA${suffix}`, true, `Edited ${suffix}`), id: first.json.row.id });
assert.equal(editFirst.response.status, 200);
assert.equal(editFirst.json.row.modified_by, testUsername);
defaults = await send('POST', query());
assert.equal(defaults.json.lottableValidationDTOs.filter((row) => row.isDefault).length, 1);
assert.equal(defaults.json.lottableValidationDTOs.find((row) => row.lotValCode === `LVA${suffix}`).isDefault, true);
assert.equal(defaults.json.lottableValidationDTOs.find((row) => row.lotValCode === `LVB${suffix}`).isDefault, false);
assert.deepEqual(await inventoryEvents(), eventsBefore);

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
let uiCreated;
try {
  await page.goto(base);
  await page.getByLabel('Login Id').fill(testUsername);
  await page.getByLabel('Password').fill(testPassword);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/wms/lottable-validation`);
  await page.getByRole('status').getByText('inbound and outbound validation do not consume', { exact: false }).waitFor();
  for (const heading of ['Lottable Val. Code', 'isDefault', 'Description', ...labels]) await page.getByRole('columnheader', { name: heading, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  await page.getByRole('button', { name: `LVA${suffix}`, exact: true }).waitFor();
  for (const size of ['20', '50', '100', '200']) await page.getByLabel('Records per Page').selectOption(size);
  await page.getByRole('button', { name: 'Add New', exact: true }).click();
  for (const label of ['Lottable Validation Code*', 'Description*', 'isDefault', 'Unique Batch Nos Is Mandatory', 'Unique Batch Nos Mandatory for Outward', 'Unique Batch Nos Mask', 'Unique Batch Nos Length']) await page.getByLabel(label, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Please Enter Lottable Validation Code', { exact: true }).waitFor();
  const uiCode = `LVC${suffix}`;
  await page.getByLabel('Lottable Validation Code*', { exact: true }).fill(uiCode);
  await page.getByLabel('Description*', { exact: true }).fill(`UI Lottable ${suffix}`);
  await page.getByLabel('isDefault', { exact: true }).check();
  await page.getByLabel('Unique Batch Nos Is Mandatory', { exact: true }).check();
  await page.getByLabel('Unique Batch Nos Mandatory for Outward', { exact: true }).check();
  await page.getByLabel('Unique Batch Nos Length', { exact: true }).fill('3');
  await page.getByLabel('Unique Batch Nos Mask', { exact: true }).fill('LONG');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Mask1 exceeds the limit', { exact: true }).waitFor();
  errors.length = 0;
  const saveResponse = page.waitForResponse((response) => response.url().endsWith('/api/lottable-validations') && response.request().method() === 'POST' && response.status() === 201);
  await page.getByLabel('Unique Batch Nos Length', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  uiCreated = await (await saveResponse).json();
  assert.equal(uiCreated.row.lotValCode, uiCode);
  assert.equal(uiCreated.row.lottables[0].mandatory, true);
  assert.equal(uiCreated.row.lottables[0].outward, true);
  assert.equal(uiCreated.row.created_by, testUsername);
  await page.getByRole('button', { name: uiCode, exact: true }).waitFor();
  const uiReadback = await send('POST', query({ receivingValidationCode: uiCode }));
  assert.equal(uiReadback.json.records, 1);
  assert.equal(uiReadback.json.lottableValidationDTOs[0].lottables[0].mask, 'LONG');
  assert.equal(uiReadback.json.lottableValidationDTOs.filter((row) => row.isDefault).length, 1);
  assert.equal(uiReadback.json.lottableValidationDTOs[0].isDefault, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(await inventoryEvents(), eventsBefore);
  console.log('PASS Lottable Validation: signed-in configuration create/readback, seven-field shape and mask checks, one-default behavior, paging, audit actors in persisted records, and no Central Inventory event changes. Rules remain metadata; inbound/outbound enforcement is not connected.');
} finally {
  await browser.close();
}
