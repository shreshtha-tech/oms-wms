import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const attributeCode = `QA-ATTR-${suffix}`;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

assert.ok(username && password, 'Manage Attribute verification requires an isolated signed-in administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'Manage Attribute test must use a generated codexqa MongoDB database.');

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200);
const cookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(cookie, /^dmills_session=[a-f0-9]{64}$/);

const send = async (path, method = 'GET', body, authenticated = true) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { cookie } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json;
  try { json = await response.json(); } catch { json = null; }
  return { response, json };
};

const queryBody = (overrides = {}) => ({
  rows: 20, page: 1, sidx: 'attrPK.atribCode', sord: 'desc',
  pick_sku: '', attributeDescription: '', mandatory1: '-1', visible1: '-1',
  scope1: '-1', searchable1: '-1', active: '-1', REQ_SEARCH_FLAG: true,
  ...overrides,
});
const createBody = (code, overrides = {}) => ({
  code, description: `Manage Attribute test ${suffix}`, mandatory: false,
  visible: true, scope: 'C', searchable: false, isActive: true, inputType: 'Text',
  ...overrides,
});
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const unauthenticated = await send('/api/manage-attributes', 'GET', undefined, false);
assert.equal(unauthenticated.response.status, 401, 'Manage Attribute data must require a signed-in session.');
const eventsBefore = await send('/api/inventory-sync/central/events');
assert.equal(eventsBefore.response.status, 200);

const initial = await send('/api/manage-attributes');
assert.equal(initial.response.status, 200);
assert.ok(Array.isArray(initial.json.rows));

for (const [body, message] of [
  [{ code: '', description: '', scope: 'C', inputType: 'Text' }, /mandatory/],
  [createBody(`QA-ATTR-SCOPE-${suffix}`, { scope: 'X' }), /Scope/],
  [createBody(`QA-ATTR-TYPE-${suffix}`, { inputType: 'Currency' }), /Input Type/],
  [createBody(`QA-ATTR-BOOL-${suffix}`, { searchable: 'yes' }), /Searchable/],
]) {
  const result = await send('/api/manage-attributes', 'POST', body);
  assert.equal(result.response.status, 400, JSON.stringify(result.json));
  assert.match(result.json.error, message);
}
const unsupportedUpdate = await send('/api/manage-attributes', 'PUT', { id: 1, code: 'UNSUPPORTED' });
assert.equal(unsupportedUpdate.response.status, 405);

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
const moduleRequests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('status of 400 (Bad Request)')) errors.push(message.text()); });
page.on('request', (request) => { if (request.url().endsWith('/api/manage-attributes')) moduleRequests.push(request); });

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const manageRouteRequestCount = moduleRequests.length;
  await page.goto(`${base}/app/m/manage-attribute`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('columnheader', { name: 'Input Type', exact: true }).waitFor();
  for (const action of ['Search', 'Reset', 'Add New']) await page.getByRole('main').getByRole('button', { name: action, exact: true }).waitFor();
  for (const field of ['Attribute Code', 'Description', 'Mandatory', 'Visible', 'Scope', 'Searchable', 'isActive']) await page.getByRole('main').getByLabel(field, { exact: true }).waitFor();
  assert.equal(moduleRequests.length, manageRouteRequestCount, 'Opening the screen does not issue an unfiltered business request.');

  const emptySearchPromise = page.waitForResponse((response) => response.url().endsWith('/api/manage-attributes')
    && response.request().method() === 'POST' && response.request().postData()?.includes('REQ_SEARCH_FLAG'));
  await page.getByRole('main').getByRole('button', { name: 'Search', exact: true }).click();
  const emptySearch = await emptySearchPromise;
  assert.equal(emptySearch.status(), 200);
  assert.deepEqual((await emptySearch.json()).rows, []);

  await page.getByRole('main').getByRole('button', { name: 'Add New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Attribute' });
  await dialog.waitFor();
  const invalidSavePromise = page.waitForResponse((response) => response.url().endsWith('/api/manage-attributes')
    && response.request().method() === 'POST' && response.status() === 400);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal((await invalidSavePromise).status(), 400);
  await page.getByText('Attribute Code and Description are mandatory.', { exact: true }).waitFor();

  await dialog.getByLabel('Attribute Code', { exact: true }).fill(attributeCode.toLowerCase());
  await dialog.getByLabel('Description', { exact: true }).fill(`Browser attribute, ${suffix}`);
  await dialog.getByLabel('Input Type', { exact: true }).selectOption('List');
  await dialog.getByLabel('Scope', { exact: true }).selectOption('E');
  await dialog.getByLabel('mandatory', { exact: true }).check();
  await dialog.getByLabel('searchable', { exact: true }).check();
  const createPromise = page.waitForResponse((response) => response.url().endsWith('/api/manage-attributes')
    && response.request().method() === 'POST' && response.status() === 201);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createPromise;
  const created = await createResponse.json();
  assert.equal(created.module, 'manage-attribute');
  assert.equal(created.code, attributeCode);
  assert.equal(created.name, `Browser attribute, ${suffix}`);
  assert.deepEqual(created.extra, { mandatory: true, visible: true, scope: 'E', searchable: true, input_type: 'List' });
  assert.equal(created.status, 'Active');
  assert.equal(created.created_by, username);
  assert.equal(created.updated_by, username);
  assert.match(created.created_date, datePattern);
  assert.match(created.updated_date, datePattern);
  const stored = await db.collection('generic_records').findOne({ module: 'manage-attribute', code: attributeCode });
  assert.equal(stored.description, `Browser attribute, ${suffix}`);
  assert.deepEqual(stored.extra, created.extra);
  assert.equal(stored.created_by, username);

  const duplicate = await send('/api/manage-attributes', 'POST', createBody(attributeCode.toLowerCase()));
  assert.equal(duplicate.response.status, 409);

  const fixtureCount = 21;
  for (let index = 1; index <= fixtureCount; index++) {
    const fixture = await send('/api/manage-attributes', 'POST', createBody(
      `QA-PAGE-ATTR-${suffix}-P${String(index).padStart(2, '0')}`,
      { description: `Paging fixture ${index} ${suffix}`, scope: ['S', 'C', 'E'][index % 3], mandatory: index % 2 === 0, searchable: index % 2 === 1 },
    ));
    assert.equal(fixture.response.status, 201, JSON.stringify(fixture.json));
  }

  let firstPage;
  for (const size of [20, 50, 100, 200]) {
    const result = await send('/api/manage-attributes', 'POST', queryBody({ rows: size }));
    assert.equal(result.response.status, 200);
    assert.equal(result.json.records, fixtureCount + 1);
    assert.equal(result.json.page, 1);
    assert.equal(result.json.total, Math.ceil((fixtureCount + 1) / size));
    assert.equal(result.json.rows.length, Math.min(fixtureCount + 1, size));
    assert.deepEqual(result.json.gridModel, result.json.rows);
    if (size === 20) firstPage = result.json;
  }
  const secondPage = await send('/api/manage-attributes', 'POST', queryBody({ page: 2 }));
  assert.equal(secondPage.response.status, 200);
  assert.equal(secondPage.json.rows.length, 2);
  assert.ok(secondPage.json.rows.every((row) => row.code.localeCompare(firstPage.rows.at(-1).code, 'en') < 0));

  const matching = await send('/api/manage-attributes', 'POST', queryBody({
    pick_sku: attributeCode.toLowerCase(), attributeDescription: suffix,
    mandatory1: 'true', visible1: 'true', scope1: 'E', searchable1: 'true', active: 'true',
  }));
  assert.equal(matching.response.status, 200);
  assert.equal(matching.json.records, 1);
  assert.equal(matching.json.rows[0].code, attributeCode);

  await page.getByRole('main').getByLabel('Attribute Code', { exact: true }).fill(attributeCode);
  const filteredSearchPromise = page.waitForResponse((response) => response.url().endsWith('/api/manage-attributes')
    && response.request().method() === 'POST' && response.request().postData()?.includes(attributeCode));
  await page.getByRole('main').getByRole('button', { name: 'Search', exact: true }).click();
  const filteredSearch = await filteredSearchPromise;
  assert.equal(filteredSearch.status(), 200);
  const filterRequest = filteredSearch.request().postDataJSON();
  assert.equal(filterRequest.pick_sku, attributeCode);
  const filteredBody = await filteredSearch.json();
  assert.equal(filteredBody.records, 1, `Filtered search request ${JSON.stringify(filterRequest)} returned ${filteredBody.records} row(s).`);
  assert.equal(filteredBody.rows[0]?.code, attributeCode);
  await page.getByRole('cell', { name: attributeCode, exact: true }).waitFor();
  await page.getByRole('main').getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await page.getByRole('main').getByLabel('Attribute Code', { exact: true }).inputValue(), '');
  await page.getByRole('cell', { name: 'No records to view', exact: true }).waitFor();

  const finalRows = await send('/api/manage-attributes');
  assert.equal(finalRows.response.status, 200);
  assert.equal(finalRows.json.rows.length, fixtureCount + 1);
  const eventsAfter = await send('/api/inventory-sync/central/events');
  assert.equal(eventsAfter.response.status, 200);
  assert.deepEqual(eventsAfter.json.map((event) => event.event_key).sort(), eventsBefore.json.map((event) => event.event_key).sort());
  assert.deepEqual(errors, []);
  console.log('PASS Manage Attribute: signed-in screen/search/create, strict scope/type/boolean validation, case-insensitive duplicate guard, authenticated Mongo audit fields, all paging sizes, combined filter search, Reset, and unchanged Central Inventory events. Update is not exposed by this screen.');
} catch (error) {
  console.error('Manage Attribute browser state at failure:', {
    url: page.url(),
    visible: await page.locator('body').innerText().catch(() => ''),
    errors,
  });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
