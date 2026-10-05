import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const categoryCode = `QAA${suffix}`;
const groupCode = `QATG${suffix}`;
const zoneName = `QA Tax Application Zone ${suffix}`;
const taxCode = `QAT${suffix}`;

assert.ok(username && password, 'Tax Application verification requires an isolated administrator.');
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

const categoryResult = await send('/api/tax-categories', 'POST', { code: categoryCode, name: `QA Tax Application Category ${suffix}`, type: 'HSN (Goods)' });
assert.equal(categoryResult.response.status, 201, JSON.stringify(categoryResult.json));
const zoneResult = await send('/api/tax-zones', 'POST', {
  code: '0', name: zoneName, country: 'INDIA', states: ['Delhi'], status: 'Active', description: 'Tax Application isolated fixture',
});
assert.equal(zoneResult.response.status, 201, JSON.stringify(zoneResult.json));
const taxCodeResult = await send('/api/taxcodes', 'POST', {
  tax_code: taxCode, tax_code_type: 'GST', tax_nature: 'Central Cess', start_date: today,
  percentage: 5, description: `Tax Application test ${suffix}`, is_active: 'Active',
});
assert.equal(taxCodeResult.response.status, 201, JSON.stringify(taxCodeResult.json));
const groupResult = await send('/api/tax-groups', 'POST', {
  code: groupCode, name: `QA Tax Application Group ${suffix}`, applied_on: 'Cost', start_date: today, status: 'Active',
  tax_codes: [{ tax_code_id: taxCodeResult.json.id, tax_level: '1' }],
});
assert.equal(groupResult.response.status, 201, JSON.stringify(groupResult.json));

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'Tax Application test must use a generated codexqa MongoDB database.');
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
  const initialSearchPromise = page.waitForResponse((response) => response.url().endsWith('/api/taxapp') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.goto(`${base}/app/tax-application`, { waitUntil: 'domcontentloaded' });
  const screen = page.locator('[data-screen-frame][aria-hidden="false"] main');
  await screen.getByRole('button', { name: 'Add New', exact: true }).waitFor();
  assert.equal((await initialSearchPromise).status(), 200);

  await screen.getByRole('button', { name: 'Add New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add New Tax Application' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.getByText('Tax Category is required', { exact: true }).waitFor();
  await dialog.getByText('Please Select a valid Start Date', { exact: true }).waitFor();

  await dialog.getByLabel('Tax Category').selectOption(categoryCode);
  await dialog.getByLabel('Tax Type').selectOption('Sales');
  await dialog.getByLabel('Tax Group Code').selectOption(groupCode);
  await dialog.getByLabel('Goods Direction').selectOption('IN');
  await dialog.getByLabel('Tax Authority').fill(`QA Authority ${suffix}`);
  await dialog.getByLabel('Tax Zone').selectOption(String(zoneResult.json.code));
  await dialog.getByLabel('Start Date').fill(today);
  await dialog.getByLabel('From MRP').fill('0');
  await dialog.getByLabel('To MRP').fill('500');
  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/taxapp') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG !== true);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createResponsePromise;
  assert.equal(createResponse.status(), 201, JSON.stringify(await createResponse.json()));
  const created = await createResponse.json();
  assert.equal(created.tax_category, categoryCode);
  assert.equal(created.tax_group_code, groupCode);
  assert.equal(created.tax_zone, String(zoneResult.json.code));
  assert.equal(created.from_mrp, 0);
  assert.equal(created.to_mrp, 500);
  assert.equal((await db.collection('tax_application').findOne({ id: created.id })).tax_authority, `QA Authority ${suffix}`);

  const malformedDate = await send('/api/taxapp', 'POST', { ...created, id: undefined, start_date: '2026-99-99' });
  assert.equal(malformedDate.response.status, 400, 'Invalid calendar dates must fail validation.');
  const missingMpr = await send('/api/taxapp', 'POST', { ...created, id: undefined, from_mrp: '' });
  assert.equal(missingMpr.response.status, 400, 'Blank From MRP must not be normalized to zero.');
  const missingGroup = await send('/api/taxapp', 'POST', { ...created, id: undefined, tax_group_code: '' });
  assert.equal(missingGroup.response.status, 400, 'Tax Group is required for new rules.');
  const duplicate = await send('/api/taxapp', 'POST', { ...created, id: undefined });
  assert.equal(duplicate.response.status, 409);

  const searchRow = screen.locator('tbody tr').filter({ hasText: categoryCode });
  await searchRow.waitFor();
  const categoryFilter = screen.locator('thead tr').nth(1).locator('select').first();
  await categoryFilter.selectOption(categoryCode);
  const filterPromise = page.waitForResponse((response) => response.url().endsWith('/api/taxapp') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await screen.getByRole('button', { name: 'Search', exact: true }).click();
  assert.equal((await filterPromise).status(), 200);
  assert.equal(await screen.locator('tbody tr').filter({ hasText: categoryCode }).count(), 1);

  const editRow = screen.locator('tbody tr').filter({ hasText: categoryCode });
  const editButton = editRow.getByTitle('Edit');
  await editButton.click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Tax Application' });
  await editDialog.getByLabel('Tax Authority').fill(`QA Authority Updated ${suffix}`);
  const updatePromise = page.waitForResponse((response) => response.url().endsWith('/api/taxapp') && response.request().method() === 'PUT');
  await editDialog.getByRole('button', { name: 'Update', exact: true }).click();
  const updateResponse = await updatePromise;
  assert.equal(updateResponse.status(), 200, JSON.stringify(await updateResponse.json()));
  const updated = await updateResponse.json();
  assert.equal(updated.tax_authority, `QA Authority Updated ${suffix}`);
  assert.equal((await db.collection('tax_application').findOne({ id: created.id })).tax_authority, `QA Authority Updated ${suffix}`);

  const resolve = () => send(`/api/taxapp?resolve=true&tax_category=${encodeURIComponent(categoryCode)}&tax_type=Sales&goods_direction=IN&tax_zone=${encodeURIComponent(zoneResult.json.code)}&mrp=100`);
  const resolved = await resolve();
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.json.match?.id, created.id);
  const future = await send('/api/taxapp', 'POST', { ...updated, id: undefined, start_date: tomorrow });
  assert.equal(future.response.status, 201, JSON.stringify(future.json));
  const afterFuture = await resolve();
  assert.equal(afterFuture.json.match?.id, created.id, 'A future-dated rule must not replace the currently effective rule.');

  const staleUpdate = await send('/api/taxapp', 'PUT', { ...updated, id: Number.MAX_SAFE_INTEGER });
  assert.equal(staleUpdate.response.status, 404);
  const deleteBlocked = await send('/api/taxapp', 'DELETE', { id: created.id });
  assert.equal(deleteBlocked.response.status, 409);
  const deactivateGroup = await send('/api/tax-groups', 'PUT', {
    ...groupResult.json, id: groupResult.json.id, status: 'Inactive',
    tax_codes: groupResult.json.components.map((item) => ({ tax_code_id: item.tax_code_id, tax_level: item.tax_level })),
  });
  assert.equal(deactivateGroup.response.status, 200, JSON.stringify(deactivateGroup.json));
  assert.deepEqual((await resolve()).json, { match: null, candidates: [] }, 'Rules with inactive Tax Groups must not resolve.');
  const inactiveGroupCreate = await send('/api/taxapp', 'POST', { ...updated, id: undefined, tax_type: 'Purchase' });
  assert.equal(inactiveGroupCreate.response.status, 400);

  assert.deepEqual(await centralEvents(), eventsBefore);
  assert.deepEqual(errors, []);
  console.log('PASS Tax Application: signed create/edit/search, required-field validation, date and numeric guards, duplicate/stale/delete checks, Mongo readback, effective-date resolution, inactive-group guard, and no Central Inventory changes.');
} finally {
  await browser.close();
  await mongo.close();
}
