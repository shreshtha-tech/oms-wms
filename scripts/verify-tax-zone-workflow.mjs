import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const zoneName = `QA Tax Zone ${suffix}`;
const updatedName = `QA Tax Zone Updated ${suffix}`;

assert.ok(username && password, 'Tax Zone verification requires an isolated administrator.');
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
const taxCategory = await send('/api/tax-categories', 'POST', { code: `TZCAT${suffix}`, name: `QA Tax Zone Category ${suffix}`, type: 'HSN (Goods)' });
assert.equal(taxCategory.response.status, 201, JSON.stringify(taxCategory.json));
const taxCode = await send('/api/taxcodes', 'POST', {
  tax_code: `TZ${suffix}`, tax_code_type: 'GST', tax_nature: 'Central Cess', start_date: '2026-09-30',
  percentage: 5, description: `Tax Zone test ${suffix}`, is_active: 'Active',
});
assert.equal(taxCode.response.status, 201, JSON.stringify(taxCode.json));
const taxGroup = await send('/api/tax-groups', 'POST', {
  code: `TZG${suffix}`, name: `QA Tax Zone Group ${suffix}`, applied_on: 'Cost', start_date: '2026-09-30', status: 'Active',
  tax_codes: [{ tax_code_id: taxCode.json.id, tax_level: '1' }],
});
assert.equal(taxGroup.response.status, 201, JSON.stringify(taxGroup.json));

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'Tax Zone test must use a generated codexqa MongoDB database.');
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
  const initialList = page.waitForResponse((response) => response.url().endsWith('/api/tax-zones') && response.request().method() === 'GET');
  await page.goto(`${base}/app/tax-zones`, { waitUntil: 'domcontentloaded' });
  const screen = page.locator('[data-screen-frame][aria-hidden="false"] main');
  assert.equal((await initialList).status(), 200);
  for (const action of ['Search', 'Reset', 'Add New']) await screen.getByRole('button', { name: action, exact: true }).waitFor();

  await screen.getByRole('button', { name: 'Add New', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Tax Zone Create/Edit' });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('alert').getByText('Please Enter Tax Zone Name', { exact: true }).waitFor();
  await editor.getByLabel('Tax Zone Name *').fill(zoneName);
  await editor.getByLabel('Country').selectOption('INDIA');
  await editor.getByLabel('State').selectOption(['Maharashtra', 'Goa']);
  await editor.locator('#tax-zone-udf-1').fill('QA metadata');
  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/tax-zones') && response.request().method() === 'POST');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createResponsePromise;
  assert.equal(createResponse.status(), 201, JSON.stringify(await createResponse.json()));
  const zone = await createResponse.json();
  assert.match(zone.code, /^\d+$/);
  assert.equal(zone.name, zoneName);
  assert.equal(zone.no_of_states, 2);
  assert.deepEqual(zone.states, ['Maharashtra', 'Goa']);
  assert.equal(zone.udf1, 'QA metadata');
  assert.equal((await db.collection('generic_records').findOne({ id: zone.id, module: 'tax-zone' })).status, 'Active');
  assert.equal((await db.collection('tax_zone_states').find({ zone_id: zone.id }).toArray()).length, 2);

  let invalid = await send('/api/tax-zones', 'POST', { code: '0', name: zoneName, country: 'INDIA', states: ['Delhi'], status: 'Active' });
  assert.equal(invalid.response.status, 409, 'Tax Zone names must be unique without regard to case.');
  invalid = await send('/api/tax-zones', 'POST', { code: zone.code, name: `Other ${suffix}`, country: 'INDIA', states: ['Delhi'], status: 'Active' });
  assert.equal(invalid.response.status, 409, 'Tax Zone codes must be unique.');
  invalid = await send('/api/tax-zones', 'POST', { code: '0', name: `Bad State ${suffix}`, country: 'INDIA', states: ['Delhi', ' delhi '], status: 'Active' });
  assert.equal(invalid.response.status, 400);

  await page.getByLabel('Tax Zone Name filter').fill(zoneName);
  const searchResponsePromise = page.waitForResponse((response) => response.url().startsWith(`${base}/api/tax-zones?`) && response.request().method() === 'GET');
  await screen.getByRole('button', { name: 'Search', exact: true }).click();
  const searchResponse = await searchResponsePromise;
  assert.equal(searchResponse.status(), 200);
  const searchRows = await searchResponse.json();
  assert.equal(searchRows.length, 1);
  assert.equal(searchRows[0].code, zone.code);
  const row = screen.locator('tbody tr').filter({ hasText: zoneName });
  await row.getByRole('button', { name: `Edit Tax Zone ${zone.code}` }).click();
  const editDialog = page.getByRole('dialog', { name: 'Tax Zone Create/Edit' });
  await editDialog.getByLabel('Tax Zone Name *').fill(updatedName);
  await editDialog.getByLabel('Tax Zone Description').fill('Updated description');
  await editDialog.getByLabel('State').selectOption(['Goa']);
  await editDialog.locator('#tax-zone-udf-1').fill('Updated QA metadata');

  const applicationResponse = await send('/api/taxapp', 'POST', {
    tax_category: taxCategory.json.code, tax_type: 'Sales', tax_group_code: taxGroup.json.code, goods_direction: 'ALL',
    tax_zone: zone.code, start_date: '2026-09-30', tax_authority: '', is_form_c_tax: false,
    is_form_h_tax: false, is_active: 'Active', from_mrp: 0, to_mrp: 0,
  });
  assert.equal(applicationResponse.response.status, 201, JSON.stringify(applicationResponse.json));
  const resolvedBefore = await send(`/api/taxapp?resolve=true&tax_category=${encodeURIComponent(taxCategory.json.code)}&tax_type=Sales&goods_direction=IN&tax_zone=${encodeURIComponent(zone.code)}&mrp=100`);
  assert.equal(resolvedBefore.json.match?.tax_zone, zone.code);

  const renameUsedZone = await send('/api/tax-zones', 'PUT', { ...zone, code: String(Number(zone.code) + 100000), states: ['Goa'] });
  assert.equal(renameUsedZone.response.status, 409, 'Tax Zone code cannot change while a Tax Application references it.');
  const updateResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/tax-zones') && response.request().method() === 'PUT');
  await editDialog.getByRole('button', { name: 'Update', exact: true }).click();
  const updateResponse = await updateResponsePromise;
  assert.equal(updateResponse.status(), 200, JSON.stringify(await updateResponse.json()));
  const updated = await updateResponse.json();
  assert.equal(updated.name, updatedName);
  assert.equal(updated.description, 'Updated description');
  assert.deepEqual(updated.states, ['Goa']);
  assert.equal(updated.udf1, 'Updated QA metadata');

  const duplicateEdit = await send('/api/tax-zones', 'PUT', { ...updated, id: zone.id, name: updatedName.toLowerCase(), states: ['Goa'] });
  assert.equal(duplicateEdit.response.status, 200, 'A case-only edit of the current name is allowed.');
  const missingEdit = await send('/api/tax-zones', 'PUT', { ...updated, id: Number.MAX_SAFE_INTEGER });
  assert.equal(missingEdit.response.status, 404);
  const deleteBlocked = await send('/api/tax-zones', 'DELETE', { id: zone.id });
  assert.equal(deleteBlocked.response.status, 409);

  const inactiveUpdate = await send('/api/tax-zones', 'PUT', { ...updated, id: zone.id, name: updatedName, status: 'Inactive', states: ['Goa'] });
  assert.equal(inactiveUpdate.response.status, 200);
  const newRule = await send('/api/taxapp', 'POST', {
    tax_category: taxCategory.json.code, tax_type: 'Purchase', tax_group_code: taxGroup.json.code, goods_direction: 'ALL',
    tax_zone: zone.code, start_date: '2026-09-30', is_active: 'Active', from_mrp: 0, to_mrp: 0,
  });
  assert.equal(newRule.response.status, 400, 'Inactive Tax Zones cannot be assigned to new Tax Applications.');
  const resolvedInactive = await send(`/api/taxapp?resolve=true&tax_category=${encodeURIComponent(taxCategory.json.code)}&tax_type=Sales&goods_direction=IN&tax_zone=${encodeURIComponent(zone.code)}&mrp=100`);
  assert.deepEqual(resolvedInactive.json, { match: null, candidates: [] });
  assert.deepEqual(await centralEvents(), eventsBefore);
  assert.deepEqual(errors, []);
  console.log('PASS Tax Zone: signed create/search/edit, generated numeric code, multi-state persistence, duplicate/state validation, Tax Application code-reference guard, inactive-zone assignment/resolution guards, UDF readback, and no Central Inventory changes.');
} finally {
  await browser.close();
  await mongo.close();
}
