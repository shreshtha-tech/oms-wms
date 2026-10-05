import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const testUsername = process.env.ERETAIL_TEST_USERNAME || 'label';
const testPassword = process.env.ERETAIL_TEST_PASSWORD || 'local';
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: testUsername, password: testPassword }),
});
assert.equal(login.status, 200, 'The isolated administrator must authenticate before calling WMS APIs.');
const sessionCookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(sessionCookie, /^dmills_session=[a-f0-9]{64}$/);
const print = async (body) => {
  const response = await fetch(`${base}/api/sku-label-print`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: sessionCookie }, body: JSON.stringify(body),
  });
  return { response, json: await response.json() };
};
const inventoryEvents = async () => {
  const response = await fetch(`${base}/api/inventory-sync/central/events`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  return (await response.json()).map((event) => event.event_key).sort();
};
const eventsBefore = await inventoryEvents();
let result = await print({ labelId: '-1', data: 'SKU1,1,Each,BARCODE1' });
assert.equal(result.response.status, 400);
assert.equal(result.json.error, 'Please select a Label Type');
result = await print({ labelId: '1', data: '' });
assert.equal(result.response.status, 400);
assert.equal(result.json.error, 'Please Enter Valid Data');
result = await print({ labelId: '9', data: 'SKU1,1,Each,BARCODE1' });
assert.equal(result.response.status, 400);
assert.equal(result.json.error, 'Please select a Label Type');
const validInput = 'SKU1,1,Each,BARCODE1,LOT1';
result = await print({ labelId: '1', data: validInput, pdf: true });
assert.equal(result.response.status, 501);
assert.match(result.json.error, /renderer and printer\/PDF output service are connected/);
for (const fakeOutput of ['printed', 'rows', 'failed', 'format', 'pdf']) assert.equal(fakeOutput in result.json, false);
result = await print({ labelId: '2', data: Array.from({ length: 101 }, () => validInput).join('\n') });
assert.equal(result.response.status, 400);
assert.equal(result.json.error, 'Max 100 lines are allowed at a time');
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
  await page.goto(`${base}/app/wms/sku-label-print`);
  await page.getByRole('status').getByText('Label rendering, printer output, and PDF generation are not connected', { exact: false }).waitFor();
  await page.getByLabel('Label Type', { exact: true }).selectOption('2');
  await page.getByLabel('Label Data', { exact: true }).fill(validInput);
  assert.equal(await page.getByRole('button', { name: 'Print', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'PDF', exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('Failed SKU', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await page.getByLabel('Label Data', { exact: true }).inputValue(), '');
  assert.deepEqual(errors, []);
  console.log('PASS SKU Label Print: authenticated request validation and 100-line limit; valid requests return 501 with no fabricated counts, failed rows, or PDF; UI Print/PDF disabled and Reset clears draft input.');
} finally {
  await browser.close();
}
assert.deepEqual(await inventoryEvents(), eventsBefore);
