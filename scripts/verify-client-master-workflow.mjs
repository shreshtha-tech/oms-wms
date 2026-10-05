import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || 'client';
const password = process.env.ERETAIL_TEST_PASSWORD || 'local';
const suffix = Date.now().toString().slice(-8);
const clientId = String(Number(suffix) || 1).padStart(8, '0');
const clientName = `QA Client ${suffix}`;
const uiClientId = String(Number(clientId) + 1);
const uiClientName = `UI Client ${suffix}`;
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200, 'The isolated administrator must authenticate before calling Client APIs.');
const cookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(cookie, /^dmills_session=[a-f0-9]{64}$/);
const send = async (path, method = 'GET', body) => {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', cookie }, body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json;
  try { json = await response.json(); } catch { json = null; }
  return { response, json };
};
const client = (overrides = {}) => ({
  client_id: clientId, client_name: clientName, client_short_name: `QC${suffix}`, client_currency: 'Indian Rupee',
  status: '1', billing_required: false, ext_client_code: `EXT${suffix}`, address1: '1 QA Street', address2: '',
  contact_person: 'QA Contact', phone: '9999999999', email: `qa-${suffix}@example.test`, country: 'INDIA', state: 'Delhi',
  city: 'New Delhi', pincode: '110001', udf1: '', udf2: '', udf3: '', udf4: '', udf5: '',
  invoice_report: '-1', label_report: '-1', total_shelf_life: '', shelf_life_receiving: '', shelf_life_picking: '', ...overrides,
});
const events = async () => {
  const result = await send('/api/inventory-sync/central/events');
  assert.equal(result.response.status, 200);
  return result.json.map(event => event.event_key).sort();
};
const eventsBefore = await events();

let invalid = await send('/api/clients', 'POST', client({ client_id: 'not-numeric' }));
assert.equal(invalid.response.status, 400);
invalid = await send('/api/clients', 'POST', client({ email: 'bad-email' }));
assert.equal(invalid.response.status, 400);
invalid = await send('/api/clients', 'POST', client({ status: '-1' }));
assert.equal(invalid.response.status, 400);

const createdResponse = await send('/api/clients', 'POST', client());
assert.equal(createdResponse.response.status, 201, JSON.stringify(createdResponse.json));
const created = createdResponse.json;
assert.equal(created.status, 'Active');
assert.equal(created.is_active, true);
assert.equal(created.created_by, username);
assert.equal(created.type, 'Client');
assert.equal(created.partner_type, 'Client');
const clientDbUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
assert.ok(clientDbUri && dbName, 'Client test must use the generated isolated MongoDB database.');
const mongo = new MongoClient(clientDbUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const persisted = await db.collection('partners').findOne({ id: created.id });
assert.equal(persisted.client_id, clientId);
assert.equal(persisted.client_currency, 'Indian Rupee');
assert.equal(persisted.created_by, username);

invalid = await send('/api/clients', 'POST', client({ client_id: `${Number(clientId) + 1}`, client_name: clientName }));
assert.equal(invalid.response.status, 409, 'Client name must be unique regardless of case.');
invalid = await send('/api/clients', 'POST', client());
assert.equal(invalid.response.status, 409, 'Client ID must be unique.');
invalid = await send('/api/clients', 'PUT', { ...client(), id: Number.MAX_SAFE_INTEGER });
assert.equal(invalid.response.status, 404, 'An unknown update must not create a client.');

const search = await send('/api/clients', 'POST', {
  REQ_SEARCH_FLAG: true, rows: 20, page: 1, sidx: 'clientId', sord: 'desc',
  clientId, clientName: '', clientShortName: '', status: 'Active', country: '', state: '-1', city: '',
});
assert.equal(search.response.status, 200);
assert.equal(search.json.records, 1);
assert.equal(search.json.gridModel[0].client_id, clientId);
for (const path of ['/api/inbound-enquiry', '/api/order-allocation']) {
  const catalog = await send(path);
  assert.equal(catalog.response.status, 200);
  assert.ok(catalog.json.clients.some(([id, name]) => id === clientId && name === clientName), `${path} must include the newly saved Client.`);
}

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(base);
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/clients`);
  await page.getByRole('button', { name: 'Add New', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Client Create/Edit' });
  await editor.getByLabel('Client Currency').selectOption({ label: 'Indian Rupee' });
  await editor.locator('[data-client-field="client_name"]').fill(uiClientName);
  await editor.locator('[data-client-field="client_id"]').fill(uiClientId);
  await editor.locator('[data-client-field="client_short_name"]').fill(`QC${suffix}`);
  await editor.locator('[data-client-field="status"]').selectOption('1');
  await editor.locator('[data-client-field="address1"]').fill('1 QA Street');
  await editor.locator('[data-client-field="phone"]').fill('9999999999');
  await editor.locator('[data-client-field="email"]').fill(`ui-${suffix}@example.test`);
  await editor.locator('[data-client-field="country"]').selectOption({ label: 'INDIA' });
  await editor.locator('[data-client-field="state"]').selectOption({ label: 'Delhi' });
  await editor.locator('[data-client-field="city"]').fill('New Delhi');
  await editor.locator('[data-client-field="pincode"]').fill('110001');

  await editor.getByRole('button', { name: 'Client Location Link', exact: true }).click();
  assert.equal(await editor.getByRole('button', { name: 'Add New Location', exact: true }).isDisabled(), true);
  assert.equal(await editor.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true, 'A child-link tab must not save the parent record as if it saved a location link.');
  await editor.getByRole('button', { name: 'User Creation', exact: true }).click();
  assert.equal(await editor.getByRole('button', { name: 'Add New', exact: true }).last().isDisabled(), true);
  await editor.getByRole('button', { name: 'Other Settings', exact: true }).click();
  assert.equal(await editor.getByLabel('Invoice Report').isDisabled(), true);
  assert.equal(await editor.getByLabel('Label Report').isDisabled(), true);
  await editor.getByRole('button', { name: 'Client Master', exact: true }).click();

  const uiCreatePromise = page.waitForResponse(response => response.url().endsWith('/api/clients') && response.request().method() === 'POST' && response.status() === 201);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const uiCreated = await (await uiCreatePromise).json();
  assert.equal(uiCreated.client_id, uiClientId);
  await page.getByRole('button', { name: uiClientId, exact: true }).waitFor();
  await page.getByRole('button', { name: uiClientId, exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Client Create/Edit' });
  assert.equal(await editDialog.locator('[data-client-field="status"]').inputValue(), '1');
  await editDialog.locator('[data-client-field="client_name"]').fill(`Edited ${uiClientName}`);
  await editDialog.locator('[data-client-field="status"]').selectOption('0');
  const uiUpdatePromise = page.waitForResponse(response => response.url().endsWith('/api/clients') && response.request().method() === 'PUT' && response.status() === 200);
  await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
  const uiUpdated = await (await uiUpdatePromise).json();
  assert.equal(uiUpdated.status, 'Inactive');
  assert.equal(uiUpdated.is_active, false);
  assert.equal(uiUpdated.modified_by, username);

  const apiUpdated = await send('/api/clients', 'PUT', { ...client({ client_name: `Edited ${clientName}`, status: '0' }), id: created.id });
  assert.equal(apiUpdated.response.status, 200);
  assert.equal(apiUpdated.json.status, 'Inactive');
  assert.equal(apiUpdated.json.is_active, false);
  const inactiveSearch = await send('/api/clients', 'POST', {
    REQ_SEARCH_FLAG: true, rows: 20, page: 1, sidx: 'clientId', sord: 'desc',
    clientId, clientName: '', clientShortName: '', status: 'Inactive', country: '', state: '-1', city: '',
  });
  assert.equal(inactiveSearch.json.records, 1);
  const deletion = await send('/api/clients', 'DELETE', { id: created.id });
  assert.equal(deletion.response.status, 409);
  assert.match(deletion.json.error, /Set Status to Inactive/);
  assert.deepEqual(errors, []);
  assert.deepEqual(await events(), eventsBefore, 'Client Master CRUD must not modify Central Inventory.');
  console.log('PASS Client Master: signed create/edit/readback, Active/Inactive normalization, duplicates/stale-ID validation, search, Inbound and allocation client catalogs, source-backed currency options, disabled unconnected child links/report selectors, and no Central Inventory changes.');
} finally {
  await browser.close();
  await mongo.close();
}
