import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const skuCode = `QA-SKU-GROUP-A-${suffix}`;
const secondSkuCode = `QA-SKU-GROUP-B-${suffix}`;
const groupCode = `QA-GROUP-${suffix}`;
const clientId = String(Date.now()).slice(-10);
const clientName = `SKU Group Client ${suffix}`;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

assert.ok(username && password, 'Manage SKU Group verification requires an isolated signed-in administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'Manage SKU Group test must use a generated codexqa MongoDB database.');

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
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

const eventsBefore = await send('/api/inventory-sync/central/events');
assert.equal(eventsBefore.response.status, 200);

const createSku = async (code, name) => send('/api/skus', 'POST', {
  master_sku_code: `QA-MASTER-${suffix}`,
  sku_code: code,
  name,
  category: 'Apparel',
  brand: 'QA',
  uom: 'Each',
  mrp: 125,
  cost_price: 50,
  status: 'Active',
});
const firstSku = await createSku(skuCode, `SKU Group Product A ${suffix}`);
assert.equal(firstSku.response.status, 201, JSON.stringify(firstSku.json));
const secondSku = await createSku(secondSkuCode, `SKU Group Product B ${suffix}`);
assert.equal(secondSku.response.status, 201, JSON.stringify(secondSku.json));
const testClient = await send('/api/clients', 'POST', {
  client_id: clientId,
  client_name: clientName,
  client_short_name: `SG${suffix.slice(-5)}`,
  client_currency: 'INR',
  address1: '1 Isolated Test Road',
  phone: '9999999999',
  country: 'India',
  state: 'Delhi',
  city: 'Delhi',
  pincode: '110001',
  status: 'Active',
});
assert.equal(testClient.response.status, 201, JSON.stringify(testClient.json));
const clientValue = `${clientId}-${clientName}`;

const missingRequired = await send('/api/sku-groups', 'POST', { code: '', name: '' });
assert.equal(missingRequired.response.status, 400);
const unknownSku = await send('/api/sku-groups', 'POST', {
  code: `QA-INVALID-${suffix}`, name: 'Unknown SKU must not persist', skus: [`QA-NOT-MASTER-${suffix}`],
});
assert.equal(unknownSku.response.status, 400);
const duplicateSku = await send('/api/sku-groups', 'POST', {
  code: `QA-DUP-SKU-${suffix}`, name: 'Duplicate SKU must not persist', skus: [skuCode, skuCode.toLowerCase()],
});
assert.equal(duplicateSku.response.status, 400);
const unknownClient = await send('/api/sku-groups', 'POST', {
  code: `QA-CLIENT-${suffix}`, name: 'Unknown Client must not persist', client: `missing-${suffix}`,
});
assert.equal(unknownClient.response.status, 400);
const invalidStatus = await send('/api/sku-groups', 'POST', {
  code: `QA-STATUS-${suffix}`, name: 'Invalid status must not persist', status: 'Enabled',
});
assert.equal(invalidStatus.response.status, 400);

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
  const metadata = await send('/api/sku-groups');
  assert.equal(metadata.response.status, 200);
  assert.ok(metadata.json.skus.some((row) => row.sku_code === skuCode));
  assert.ok(Array.isArray(metadata.json.clients));

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const initialCatalogPromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-groups') && response.request().method() === 'GET');
  const initialSearchPromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-groups') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.goto(`${base}/app/m/sku-group`, { waitUntil: 'domcontentloaded' });
  assert.equal((await initialCatalogPromise).status(), 200);
  assert.equal((await initialSearchPromise).status(), 200);
  for (const action of ['Search', 'Reset', 'Export', 'Add New']) {
    const button = page.getByRole('button', { name: action, exact: true });
    await (action === 'Search' ? button.last() : button).waitFor();
  }
  for (const heading of ['Client', 'SKU Group code', 'SKU Group Name', 'No of SKU', 'Created By', 'Created Date', 'Updated By', 'Updated Date', 'Status', 'Actions']) {
    await page.getByRole('columnheader', { name: heading, exact: true }).waitFor();
  }

  await page.getByRole('button', { name: 'Add New', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: 'Add New SKU Group' });
  await createDialog.getByLabel('SKU Group Code *').fill(groupCode.toLowerCase());
  await createDialog.getByLabel('SKU Group Name *').fill(`Verified SKU Group ${suffix}`);
  await createDialog.getByLabel('Client', { exact: true }).selectOption(clientValue);
  await createDialog.getByLabel('Description').fill(`Isolated workflow ${suffix}`);
  await createDialog.getByLabel('SKUs').selectOption([skuCode, secondSkuCode]);
  const createPromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-groups')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG !== true);
  await createDialog.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createPromise;
  assert.equal(createResponse.status(), 201, JSON.stringify(await createResponse.json()));
  const created = await createResponse.json();
  assert.equal(created.code, groupCode);
  assert.equal(created.no_of_sku, 2);
  assert.deepEqual(created.skus, [skuCode, secondSkuCode]);
  assert.equal(created.created_by, username);
  assert.equal(created.updated_by, username);
  assert.equal(created.client, clientValue);

  const genericCreate = await send('/api/generic', 'POST', { module: 'sku-group', code: `BYPASS-${suffix}`, name: 'Bypassed group', skus: ['UNKNOWN'] });
  assert.equal(genericCreate.response.status, 501);
  const genericEdit = await send('/api/generic', 'PUT', { id: created.id, name: 'Bypassed edit' });
  assert.equal(genericEdit.response.status, 501);
  const genericDelete = await send('/api/generic', 'DELETE', { id: created.id });
  assert.equal(genericDelete.response.status, 501);
  const unrelated = await send('/api/generic', 'POST', { module: 'qa-unrelated', code: `QA-${suffix}`, name: 'Unrelated metadata' });
  assert.equal(unrelated.response.status, 201);
  const genericMigration = await send('/api/generic', 'PUT', { id: unrelated.json.id, module: 'sku-group' });
  assert.equal(genericMigration.response.status, 501);
  assert.equal((await db.collection('generic_records').findOne({ id: created.id })).name, `Verified SKU Group ${suffix}`);
  assert.equal((await db.collection('generic_records').findOne({ id: unrelated.json.id })).module, 'qa-unrelated');

  const groupRow = page.locator('tbody tr').filter({ hasText: groupCode });
  await groupRow.waitFor();
  const storedCreate = await db.collection('generic_records').findOne({ module: 'sku-group', code: groupCode });
  assert.equal(storedCreate.name, `Verified SKU Group ${suffix}`);
  assert.deepEqual(storedCreate.skus, [skuCode, secondSkuCode]);
  assert.equal(storedCreate.created_by, username);

  const duplicateGroup = await send('/api/sku-groups', 'POST', {
    code: groupCode.toLowerCase(), name: 'Duplicate group code', skus: [skuCode],
  });
  assert.equal(duplicateGroup.response.status, 409);
  const raceCode = `QA-RACE-${suffix}`;
  const raceResults = await Promise.all(Array.from({ length: 8 }, (_, index) => send('/api/sku-groups', 'POST', {
    code: index % 2 ? raceCode.toLowerCase() : raceCode,
    name: `Concurrent group ${index}`,
    client: '',
    skus: [skuCode],
  })));
  assert.equal(raceResults.filter(result => result.response.status === 201).length, 1, JSON.stringify(raceResults.map(result => [result.response.status, result.json])));
  assert.equal(raceResults.filter(result => result.response.status === 409).length, 7);
  assert.equal(await db.collection('generic_records').countDocuments({ module: 'sku-group', code: raceCode }), 1);
  const codeIndex = (await db.collection('generic_records').listIndexes().toArray()).find(index => index.name === 'uq_sku_group_code');
  assert.equal(codeIndex?.unique, true);
  assert.equal(codeIndex?.partialFilterExpression?.module, 'sku-group');
  const staleUpdate = await send('/api/sku-groups', 'PUT', { id: Number.MAX_SAFE_INTEGER, code: groupCode, name: 'Stale' });
  assert.equal(staleUpdate.response.status, 404);
  const immutableCode = await send('/api/sku-groups', 'PUT', { id: created.id, code: `${groupCode}-CHANGED`, name: 'Changed Code' });
  assert.equal(immutableCode.response.status, 400);

  const groupTable = page.getByRole('table').last();
  await groupTable.locator('thead select').first().selectOption(clientValue);
  const editResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-groups')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  const filteredGroups = await editResponsePromise;
  assert.equal(filteredGroups.status(), 200);
  assert.equal((await filteredGroups.json()).records, 1);
  await page.locator('tbody tr').filter({ hasText: groupCode }).getByTitle('Edit').click();
  const editDialog = page.getByRole('dialog', { name: 'Edit SKU Group' });
  await editDialog.getByLabel('SKU Group Name *').fill(`Updated SKU Group ${suffix}`);
  await editDialog.getByLabel('SKUs').selectOption([skuCode]);
  await editDialog.getByLabel('Status').selectOption('InActive');
  const updatePromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-groups') && response.request().method() === 'PUT');
  await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
  const updateResponse = await updatePromise;
  assert.equal(updateResponse.status(), 200, JSON.stringify(await updateResponse.json()));
  const updated = await updateResponse.json();
  assert.equal(updated.code, groupCode);
  assert.equal(updated.name, `Updated SKU Group ${suffix}`);
  assert.deepEqual(updated.skus, [skuCode]);
  assert.equal(updated.no_of_sku, 1);
  assert.equal(updated.status, 'InActive');
  assert.equal(updated.created_by, username);
  assert.equal(updated.updated_by, username);
  assert.equal((await db.collection('generic_records').findOne({ id: created.id })).name, `Updated SKU Group ${suffix}`);

  const pageOne = await send('/api/sku-groups', 'POST', {
    REQ_SEARCH_FLAG: true, clientId: clientValue, skuGrpCode: groupCode, rows: 20, page: 1, sidx: 'skuGrpCode', sord: 'desc',
  });
  assert.equal(pageOne.response.status, 200);
  assert.equal(pageOne.json.records, 1);
  assert.equal(pageOne.json.total, 1);
  assert.equal(pageOne.json.gridModel[0].id, created.id);
  assert.deepEqual(pageOne.json.rows, pageOne.json.gridModel);
  const pageTwo = await send('/api/sku-groups', 'POST', {
    REQ_SEARCH_FLAG: true, clientId: clientValue, skuGrpCode: groupCode, rows: 20, page: 2, sidx: 'skuGrpCode', sord: 'desc',
  });
  assert.equal(pageTwo.response.status, 200);
  assert.equal(pageTwo.json.page, 2);
  assert.equal(pageTwo.json.records, 1);
  assert.equal(pageTwo.json.gridModel.length, 0);
  for (const size of [20, 50, 100, 200]) {
    const response = await send('/api/sku-groups', 'POST', {
      REQ_SEARCH_FLAG: true, rows: size, page: 1, sidx: 'skuGrpCode', sord: 'desc',
    });
    assert.equal(response.response.status, 200);
    assert.ok(response.json.rows.length <= size);
  }

  const resetPromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-groups')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true
    && response.request().postDataJSON()?.skuGrpCode === '');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal((await resetPromise).status(), 200);
  await page.locator('tbody tr').filter({ hasText: groupCode }).waitFor();
  await page.getByLabel('Records per Page', { exact: true }).selectOption('50');
  await page.getByLabel('Records per Page', { exact: true }).selectOption('100');
  await page.getByLabel('Records per Page', { exact: true }).selectOption('200');

  const eventsAfter = await send('/api/inventory-sync/central/events');
  assert.equal(eventsAfter.response.status, 200);
  assert.deepEqual(eventsAfter.json.map((event) => event.event_key).sort(), eventsBefore.json.map((event) => event.event_key).sort());
  assert.deepEqual(errors, []);
  console.log('PASS Manage SKU Group: authenticated create/edit/client filtering/reset, Master SKU membership validation, duplicate/stale/immutable-code guards, status and membership persistence, actor/date attribution, API paging, Mongo readback, and unchanged Central Inventory events.');
} catch (error) {
  console.error('Manage SKU Group browser state at failure:', {
    url: page.url(),
    visible: await page.locator('body').innerText().catch(() => ''),
    errors,
  });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
