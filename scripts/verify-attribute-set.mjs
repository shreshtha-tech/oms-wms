import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const description = `QA Attribute Set ${suffix}`;
const externalCode = `EXT-AS-${suffix}`;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

assert.ok(username && password, 'Attribute Set verification requires an isolated signed-in administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'Attribute Set test must use a generated codexqa MongoDB database.');

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200);
const cookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(cookie, /^dmills_session=[a-f0-9]{64}$/);

const send = async (path, method = 'GET', body, authenticated = true) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(authenticated ? { cookie } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json;
  try { json = await response.json(); } catch { json = null; }
  return { response, json };
};

const unauthenticated = await send('/api/attribute-sets', 'GET', undefined, false);
assert.equal(unauthenticated.response.status, 401);
const eventsBefore = await send('/api/inventory-sync/central/events');
assert.equal(eventsBefore.response.status, 200);
const initial = await send('/api/attribute-sets');
assert.equal(initial.response.status, 200);
assert.ok(Array.isArray(initial.json.rows));
const initialIds = initial.json.rows.map((row) => row.id).sort((left, right) => left - right);
assert.equal((await send('/api/attribute-sets', 'POST', { description: '   ' })).response.status, 400);
assert.equal((await send('/api/attribute-sets', 'POST', { description: 'Invalid active flag', active: 'false' })).response.status, 400);
assert.equal((await send('/api/attribute-sets', 'DELETE', { id: 'invalid' })).response.status, 400);

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(12_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('status of 400 (Bad Request)')) errors.push(message.text()); });

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const loadPromise = page.waitForResponse((response) => response.url().endsWith('/api/attribute-sets')
    && response.request().method() === 'GET');
  await page.goto(`${base}/app/m/attribute-set`, { waitUntil: 'domcontentloaded' });
  assert.equal((await loadPromise).status(), 200);
  await page.getByRole('columnheader', { name: 'Attribute Set Description', exact: true }).waitFor();
  await page.getByRole('main').getByRole('button', { name: 'Add New', exact: true }).waitFor();

  await page.getByRole('main').getByRole('button', { name: 'Add New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Attribute Set' });
  await dialog.waitFor();
  const invalidSavePromise = page.waitForResponse((response) => response.url().endsWith('/api/attribute-sets')
    && response.request().method() === 'POST' && response.status() === 400);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal((await invalidSavePromise).status(), 400);
  await page.getByText('Attribute Set Description is mandatory.', { exact: true }).waitFor();

  await dialog.getByLabel('Attribute Set Description', { exact: true }).fill(description);
  await dialog.getByLabel('Ext Attribute Set Code', { exact: true }).fill(externalCode);
  const createPromise = page.waitForResponse((response) => response.url().endsWith('/api/attribute-sets')
    && response.request().method() === 'POST' && response.status() === 201);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createPromise;
  const created = await createResponse.json();
  assert.equal(created.module, 'attribute-set');
  assert.equal(created.name, description);
  assert.equal(created.description, description);
  assert.equal(created.status, 'Active');
  assert.equal(created.extra.external_code, externalCode);
  assert.match(created.code, /^AS[A-Z0-9]+$/);
  assert.equal(created.created_by, username);
  assert.equal(created.updated_by, username);
  assert.match(created.created_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(created.updated_date, /^\d{4}-\d{2}-\d{2}$/);
  const stored = await db.collection('generic_records').findOne({ id: created.id, module: 'attribute-set' });
  assert.equal(stored.extra.external_code, externalCode);
  assert.equal(stored.created_by, username);

  const skuImportCatalog = await send('/api/sku-imports');
  assert.equal(skuImportCatalog.response.status, 200);
  assert.ok(skuImportCatalog.json.attributeSets.includes(description), 'The active Attribute Set is available to SKU Import.');

  const inactiveDescription = `Inactive Attribute Set ${suffix}`;
  const inactive = await send('/api/attribute-sets', 'POST', { description: inactiveDescription, active: false });
  assert.equal(inactive.response.status, 201);
  assert.equal(inactive.json.status, 'Inactive');
  const inactiveCatalog = await send('/api/sku-imports');
  assert.equal(inactiveCatalog.response.status, 200);
  assert.ok(!inactiveCatalog.json.attributeSets.includes(inactiveDescription), 'Inactive Attribute Sets are excluded from SKU Import options.');
  const inactiveDelete = await send('/api/attribute-sets', 'DELETE', { id: inactive.json.id });
  assert.equal(inactiveDelete.response.status, 200);

  await page.getByLabel('Attribute Set search', { exact: true }).fill(description);
  await page.getByText(description, { exact: true }).waitFor();
  await page.getByLabel('Attribute Set search', { exact: true }).fill(externalCode);
  await page.getByText(description, { exact: true }).waitFor();
  await page.getByLabel('Attribute Set search', { exact: true }).fill('no matching attribute set');
  await page.getByRole('cell', { name: 'No records to view', exact: true }).waitFor();
  await page.getByRole('main').getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await page.getByLabel('Attribute Set search', { exact: true }).inputValue(), '');
  await page.getByText(description, { exact: true }).waitFor();

  const unrelated = await send('/api/generic', 'POST', {
    module: 'qa-unrelated', code: `QA-UNRELATED-${suffix}`, name: `Unrelated ${suffix}`, description: `Unrelated ${suffix}`,
  });
  assert.equal(unrelated.response.status, 201);
  const crossModuleDelete = await send('/api/attribute-sets', 'DELETE', { id: unrelated.json.id });
  assert.equal(crossModuleDelete.response.status, 404);
  assert.ok(await db.collection('generic_records').findOne({ id: unrelated.json.id, module: 'qa-unrelated' }));

  const deletePromise = page.waitForResponse((response) => response.url().endsWith('/api/attribute-sets')
    && response.request().method() === 'DELETE' && response.status() === 200);
  await page.getByRole('row').filter({ hasText: description }).getByRole('button', { name: 'Delete', exact: true }).click();
  assert.deepEqual(await deletePromise.then((response) => response.json()), { ok: true, id: created.id });
  await page.getByText(description, { exact: true }).waitFor({ state: 'detached' });
  assert.equal(await db.collection('generic_records').findOne({ id: created.id, module: 'attribute-set' }), null);
  const afterDeleteCatalog = await send('/api/sku-imports');
  assert.equal(afterDeleteCatalog.response.status, 200);
  assert.ok(!afterDeleteCatalog.json.attributeSets.includes(description));

  const finalRows = await send('/api/attribute-sets');
  assert.equal(finalRows.response.status, 200);
  assert.deepEqual(finalRows.json.rows.map((row) => row.id).sort((left, right) => left - right), initialIds);
  const eventsAfter = await send('/api/inventory-sync/central/events');
  assert.equal(eventsAfter.response.status, 200);
  assert.deepEqual(eventsAfter.json.map((event) => event.event_key).sort(), eventsBefore.json.map((event) => event.event_key).sort());
  assert.deepEqual(errors, []);
  console.log('PASS Attribute Set: authenticated CRUD, required and strict status validation, module-scoped delete, Mongo audit fields, search by name/external code, Reset, active/inactive SKU Import catalog behavior, and unchanged Central Inventory events. Edit and referenced-record delete policy remain unverified.');
} catch (error) {
  console.error('Attribute Set browser state at failure:', {
    url: page.url(),
    visible: await page.locator('body').innerText().catch(() => ''),
    errors,
  });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
