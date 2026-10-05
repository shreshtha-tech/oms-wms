import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const codeA = `QG${suffix}A`;
const codeB = `QG${suffix}B`;
const inactiveCode = `QG${suffix}X`;
const groupCode = `QA-GROUP-${suffix}`;
const changedDate = '2026-10-01';

assert.ok(username && password, 'Tax Group verification requires an isolated administrator.');
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
const makeTaxCode = (tax_code, percentage, is_active = 'Active') => ({
  tax_code, tax_code_type: 'GST', tax_nature: 'Central Cess', start_date: '2026-09-30',
  percentage, description: `Isolated tax code ${tax_code}`, is_active,
});

const activeA = await send('/api/taxcodes', 'POST', makeTaxCode(codeA, 5));
assert.equal(activeA.response.status, 201, JSON.stringify(activeA.json));
const activeB = await send('/api/taxcodes', 'POST', makeTaxCode(codeB, 12));
assert.equal(activeB.response.status, 201, JSON.stringify(activeB.json));
const inactive = await send('/api/taxcodes', 'POST', makeTaxCode(inactiveCode, 2, 'Inactive'));
assert.equal(inactive.response.status, 201, JSON.stringify(inactive.json));

const baseGroup = {
  code: groupCode, name: groupCode, applied_on: 'Cost', start_date: '2026-09-30', status: 'Active',
  tax_codes: [{ tax_code_id: activeA.json.id, tax_level: '1' }],
};
let invalid = await send('/api/tax-groups', 'POST', { ...baseGroup, name: '' });
assert.equal(invalid.response.status, 400, 'Tax Group Name is required.');
invalid = await send('/api/tax-groups', 'POST', { ...baseGroup, start_date: '2026-99-99' });
assert.equal(invalid.response.status, 400, 'Invalid calendar dates must return validation errors, not HTTP 500.');
invalid = await send('/api/tax-groups', 'POST', { ...baseGroup, tax_codes: [{ tax_code_id: 99999999, tax_level: '1' }] });
assert.equal(invalid.response.status, 400);
invalid = await send('/api/tax-groups', 'POST', { ...baseGroup, tax_codes: [{ tax_code_id: activeA.json.id, tax_level: '7' }] });
assert.equal(invalid.response.status, 400);
invalid = await send('/api/tax-groups', 'POST', { ...baseGroup, tax_codes: [{ tax_code_id: inactive.json.id, tax_level: '1' }] });
assert.equal(invalid.response.status, 400, 'Inactive Tax Codes cannot be newly attached to a Tax Group.');

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
assert.ok(mongoUri && dbName, 'Tax Group test must use the generated isolated MongoDB database.');
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
  const initialSearchPromise = page.waitForResponse((response) => response.url().endsWith('/api/tax-groups') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.goto(`${base}/app/tax-groups`, { waitUntil: 'domcontentloaded' });
  const screen = page.locator('[data-screen-frame][aria-hidden="false"] main');
  await screen.getByRole('heading', { name: 'Tax Group Enquiry', exact: true }).waitFor();
  const initialSearch = await initialSearchPromise;
  assert.equal(initialSearch.status(), 200);
  assert.deepEqual(await screen.getByLabel('enquiry page size').locator('option').allTextContents(), ['20', '50', '100', '200']);
  assert.deepEqual(await screen.getByLabel('nested page size').locator('option').allTextContents(), ['20', '50', '100', '200']);

  await screen.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('alert').getByText('Please complete the required Tax Group fields.', { exact: true }).waitFor();
  await screen.getByLabel('Tax Group Code').fill(groupCode);
  await screen.getByLabel('Applied On').selectOption('Cost');
  await screen.getByLabel('Start Date').fill('2026-09-30');
  await screen.getByLabel('Tax Code').selectOption(String(activeA.json.id));
  await screen.getByLabel('Tax Level').selectOption('1');
  await screen.getByRole('button', { name: 'Add', exact: true }).click();
  await screen.locator('table').first().locator('tbody tr').filter({ hasText: codeA }).waitFor();
  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/tax-groups') && response.request().method() === 'POST' && response.status() !== 200 && response.request().postDataJSON()?.REQ_SEARCH_FLAG !== true);
  await screen.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createResponsePromise;
  assert.equal(createResponse.status(), 201, JSON.stringify(await createResponse.json()));
  const created = await createResponse.json();
  assert.equal(created.code, groupCode);
  assert.equal(created.applied_on, 'Cost');
  assert.equal(created.total_rate, 5);
  assert.equal(created.components[0].tax_level, '1');
  const storedMap = await db.collection('tax_group_codes').findOne({ group_id: created.id, tax_code_id: activeA.json.id });
  assert.equal(storedMap.tax_level, '1');

  let duplicate = await send('/api/tax-groups', 'POST', baseGroup);
  assert.equal(duplicate.response.status, 409);
  const duplicateName = await send('/api/tax-groups', 'POST', { ...baseGroup, code: `${groupCode}-OTHER` });
  assert.equal(duplicateName.response.status, 409);
  invalid = await send('/api/tax-groups', 'POST', { ...baseGroup, tax_codes: [{ tax_code_id: activeA.json.id, tax_level: '1' }, { tax_code_id: activeA.json.id, tax_level: '2' }] });
  assert.equal(invalid.response.status, 400);

  const row = screen.locator('tbody tr').filter({ hasText: groupCode });
  await row.getByRole('button', { name: `Edit Tax Group ${groupCode}` }).click();
  await screen.getByLabel('Applied On').selectOption('MRP');
  await screen.getByLabel('Start Date').fill(changedDate);
  await screen.locator('table').first().locator('tbody tr').filter({ hasText: codeA }).getByRole('button', { name: `Remove ${codeA}` }).click();
  await screen.getByLabel('Tax Code').selectOption(String(activeB.json.id));
  await screen.getByLabel('Tax Level').selectOption('2');
  await screen.getByRole('button', { name: 'Add', exact: true }).click();
  const updateResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/tax-groups') && response.request().method() === 'PUT');
  await screen.getByRole('button', { name: 'Update', exact: true }).click();
  const updateResponse = await updateResponsePromise;
  assert.equal(updateResponse.status(), 200, JSON.stringify(await updateResponse.json()));
  const updated = await updateResponse.json();
  assert.equal(updated.applied_on, 'MRP', 'Applied On edits must persist.');
  assert.equal(updated.start_date, changedDate, 'Start Date edits must persist.');
  assert.equal(updated.total_rate, 12);
  assert.equal(updated.components[0].tax_code_id, activeB.json.id);
  assert.equal(updated.components[0].tax_level, '2');
  assert.equal((await db.collection('tax_group_codes').find({ group_id: created.id }).toArray()).length, 1);

  const siblingGroup = await send('/api/tax-groups', 'POST', { ...baseGroup, code: `${groupCode}-OTHER`, name: `QA Sibling ${suffix}` });
  assert.equal(siblingGroup.response.status, 201);
  const staleUpdate = await send('/api/tax-groups', 'PUT', { ...baseGroup, id: Number.MAX_SAFE_INTEGER });
  assert.equal(staleUpdate.response.status, 404);
  const duplicateEdit = await send('/api/tax-groups', 'PUT', { ...baseGroup, id: created.id, code: 'OTHER', name: siblingGroup.json.name });
  assert.equal(duplicateEdit.response.status, 409);

  const deactivate = await send('/api/tax-groups', 'PUT', { ...baseGroup, id: created.id, applied_on: 'MRP', start_date: changedDate, status: 'Inactive', tax_codes: [{ tax_code_id: activeB.json.id, tax_level: '2' }] });
  assert.equal(deactivate.response.status, 200);
  assert.equal(deactivate.json.status, 'Inactive');
  const inactiveSearch = await send('/api/tax-groups', 'POST', {
    REQ_SEARCH_FLAG: true, rows: 20, page: 1, extTaxGroupCode: groupCode, appliedOn: 'MRP',
    displayStartDate: changedDate, displayIsActive: 'No',
  });
  assert.equal(inactiveSearch.response.status, 200);
  assert.equal(inactiveSearch.json.records, 1);
  assert.equal(inactiveSearch.json.gridModel[0].code, groupCode);
  assert.equal((await send('/api/tax-groups', 'DELETE', { id: created.id })).response.status, 409);
  assert.deepEqual(await centralEvents(), eventsBefore);
  assert.deepEqual(errors, []);
  console.log('PASS Tax Group: signed create/edit/search, required/date/component validation, active-code guard, duplicate/stale/delete checks, ordered Tax Code levels and rates, persisted Applied On/Start Date, Mongo readback, and no Central Inventory changes.');
} finally {
  await browser.close();
  await mongo.close();
}
