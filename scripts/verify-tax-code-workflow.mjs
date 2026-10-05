import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const today = new Date().toISOString().slice(0, 10);
const taxCode = `QAC${suffix}`;
const groupCode = `QACG${suffix}`;

assert.ok(username && password, 'Tax Code verification requires an isolated administrator.');
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200);
const cookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(cookie, /^dmills_session=[a-f0-9]{64}$/);
const send = async (path, method = 'GET', body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json;
  try { json = await response.json(); } catch { json = null; }
  return { response, json };
};
const centralEvents = async () => {
  const result = await send('/api/inventory-sync/central/events');
  assert.equal(result.response.status, 200);
  return result.json.map((event) => event.event_key).sort();
};
const eventsBefore = await centralEvents();
const payload = {
  tax_code: taxCode, tax_code_type: 'GST', tax_nature: 'Central Cess', start_date: today,
  percentage: 7.5, description: `QA Tax Code ${suffix}`, is_active: 'Active',
};

let invalid = await send('/api/taxcodes', 'POST', { ...payload, tax_code: 'BAD-CODE' });
assert.equal(invalid.response.status, 400, 'Tax Codes allow only alphanumeric characters.');
invalid = await send('/api/taxcodes', 'POST', { ...payload, tax_nature: 'Unknown Nature' });
assert.equal(invalid.response.status, 400);
invalid = await send('/api/taxcodes', 'POST', { ...payload, start_date: '2026-02-30' });
assert.equal(invalid.response.status, 400, 'Invalid calendar dates must fail validation.');
invalid = await send('/api/taxcodes', 'POST', { ...payload, percentage: '' });
assert.equal(invalid.response.status, 400, 'Blank percentages must not be normalized to zero.');
invalid = await send('/api/taxcodes', 'POST', { ...payload, percentage: 100.01 });
assert.equal(invalid.response.status, 400);
invalid = await send('/api/taxcodes', 'POST', { ...payload, is_active: 'Enabled' });
assert.equal(invalid.response.status, 400);

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'Tax Code test must use a generated codexqa MongoDB database.');
const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.setDefaultTimeout(12_000);

try {
  await page.goto(base);
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const initialSearchPromise = page.waitForResponse((response) => response.url().endsWith('/api/taxcodes') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.goto(`${base}/app/tax-code`, { waitUntil: 'domcontentloaded' });
  const screen = page.locator('[data-screen-frame][aria-hidden="false"] main');
  await screen.getByRole('button', { name: 'Add New', exact: true }).waitFor();
  assert.equal((await initialSearchPromise).status(), 200);
  assert.deepEqual(await screen.getByRole('combobox', { name: 'Records per Page' }).locator('option').allTextContents(), ['20', '50', '100', '200']);

  await screen.getByRole('button', { name: 'Add New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add New Tax Code' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.getByText('Please Enter Tax Code', { exact: true }).waitFor();
  await dialog.getByLabel('Tax Code', { exact: true }).fill(taxCode);
  await dialog.getByLabel('Tax Code Type').selectOption('GST');
  await dialog.getByLabel('Tax Nature').selectOption('Central Cess');
  await dialog.getByLabel('Start Date').fill(today);
  await dialog.getByLabel('Percentage (%)').fill('7.5');
  await dialog.getByLabel('Description').fill(payload.description);
  const createPromise = page.waitForResponse((response) => response.url().endsWith('/api/taxcodes') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG !== true);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createPromise;
  assert.equal(createResponse.status(), 201, JSON.stringify(await createResponse.json()));
  const created = await createResponse.json();
  assert.equal(created.tax_code, taxCode);
  assert.equal(created.percentage, 7.5);
  assert.equal((await db.collection('tax_codes').findOne({ id: created.id })).tax_nature, 'Central Cess');

  const duplicate = await send('/api/taxcodes', 'POST', { ...payload, tax_code: taxCode.toLowerCase() });
  assert.equal(duplicate.response.status, 409, 'Tax Code uniqueness is case-insensitive.');
  const group = await send('/api/tax-groups', 'POST', {
    code: groupCode, name: `QA Tax Code Group ${suffix}`, applied_on: 'Cost', start_date: today, status: 'Active',
    tax_codes: [{ tax_code_id: created.id, tax_level: '1' }],
  });
  assert.equal(group.response.status, 201, JSON.stringify(group.json));

  const editRow = screen.locator('tbody tr').filter({ hasText: taxCode });
  await editRow.waitFor();
  await editRow.getByTitle('Edit').click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Tax Code' });
  await editDialog.getByLabel('Percentage (%)').fill('12.5');
  await editDialog.getByLabel('Description').fill(`Updated ${suffix}`);
  const updatePromise = page.waitForResponse((response) => response.url().endsWith('/api/taxcodes') && response.request().method() === 'PUT');
  await editDialog.getByRole('button', { name: 'Update', exact: true }).click();
  const updateResponse = await updatePromise;
  assert.equal(updateResponse.status(), 200, JSON.stringify(await updateResponse.json()));
  const updated = await updateResponse.json();
  assert.equal(updated.percentage, 12.5);
  assert.equal(updated.description, `Updated ${suffix}`);
  assert.deepEqual((await db.collection('tax_codes').findOne({ id: created.id })).percentage, 12.5);
  const groupAfterRateEdit = await send('/api/tax-groups');
  assert.equal(groupAfterRateEdit.json.find((row) => row.id === group.json.id).total_rate, 12.5, 'Tax Group rate readback must reflect its referenced Tax Code rate.');

  const searchBox = screen.locator('thead tr').nth(1).locator('input').first();
  await searchBox.fill(taxCode);
  const filteredPromise = page.waitForResponse((response) => response.url().endsWith('/api/taxcodes') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await screen.getByRole('button', { name: 'Search', exact: true }).click();
  assert.equal((await filteredPromise).status(), 200);
  assert.equal(await screen.locator('tbody tr').filter({ hasText: taxCode }).count(), 1);

  const staleUpdate = await send('/api/taxcodes', 'PUT', { ...payload, id: Number.MAX_SAFE_INTEGER });
  assert.equal(staleUpdate.response.status, 404);
  const deleteBlocked = await send('/api/taxcodes', 'DELETE', { id: created.id });
  assert.equal(deleteBlocked.response.status, 409);
  const systemCode = await send('/api/taxcodes', 'POST', { ...payload, tax_code: 'VINCCNA' });
  assert.equal(systemCode.response.status, 201);
  const systemEdit = await send('/api/taxcodes', 'PUT', { ...systemCode.json, tax_code: systemCode.json.tax_code, percentage: 1 });
  assert.equal(systemEdit.response.status, 403, 'System-defined tax codes cannot be edited.');

  assert.deepEqual(await centralEvents(), eventsBefore);
  assert.deepEqual(errors, []);
  console.log('PASS Tax Code: signed create/edit/search, date/nature/rate/status validation, duplicate/stale/system-code/delete guards, Mongo readback, Tax Group rate propagation, and no Central Inventory changes.');
} finally {
  await browser.close();
  await mongo.close();
}
