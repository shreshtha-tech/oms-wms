import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const companyCode = `QA-SCL-C-${suffix}`;
const locationCode = `QA-SCL-L-${suffix}`;
const inactiveLocationCode = `QA-SCL-OFF-${suffix}`;
const skuCode = `QA-SCL-SKU-${suffix}`;
const inactiveSkuCode = `QA-SCL-OFFSKU-${suffix}`;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

assert.ok(username && password, 'SKU Company Link verification requires an isolated signed-in administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'SKU Company Link test must use a generated codexqa MongoDB database.');

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

const companyResult = await send('/api/org-hierarchy', 'POST', {
  code: companyCode,
  name: `QA Link Company ${suffix}`,
  description: `Isolated SKU Company Link test ${suffix}`,
  hierarchy_type: 'Company',
  org_country: 'India',
});
assert.equal(companyResult.response.status, 201, JSON.stringify(companyResult.json));

const locationResult = await send('/api/locations', 'POST', {
  location_code: locationCode,
  location_name: `QA Link Location ${suffix}`,
  location_short_name: `SCL${suffix.slice(-5)}`,
  location_type: 'Store',
  hierarchy_code: companyCode,
  hierarchy_type: 'Company',
  status: 'Active',
});
assert.equal(locationResult.response.status, 201, JSON.stringify(locationResult.json));

const inactiveLocationResult = await send('/api/locations', 'POST', {
  location_code: inactiveLocationCode,
  location_name: `QA Inactive Link Location ${suffix}`,
  location_short_name: `OFF${suffix.slice(-5)}`,
  location_type: 'Store',
  hierarchy_code: companyCode,
  hierarchy_type: 'Company',
  status: 'InActive',
});
assert.equal(inactiveLocationResult.response.status, 201, JSON.stringify(inactiveLocationResult.json));

const unrelatedReference = await send('/api/generic', 'POST', { module: 'qa-unrelated', code: `QA-REFERENCE-${suffix}`, name: 'Unrelated metadata' });
assert.equal(unrelatedReference.response.status, 201);
for (const [module, id] of [
  ['org-hierarchy', companyResult.json.id],
  ['location', locationResult.json.id],
]) {
  const createBypass = await send('/api/generic', 'POST', { module, code: `BYPASS-${suffix}`, name: 'Invalid reference' });
  assert.equal(createBypass.response.status, 501);
  const editBypass = await send('/api/generic', 'PUT', { id, name: 'Bypassed edit' });
  assert.equal(editBypass.response.status, 501);
  const deleteBypass = await send('/api/generic', 'DELETE', { id });
  assert.equal(deleteBypass.response.status, 501);
  const migrationBypass = await send('/api/generic', 'PUT', { id: unrelatedReference.json.id, module });
  assert.equal(migrationBypass.response.status, 501);
}

const createSku = async (code, name, status = 'Active') => send('/api/skus', 'POST', {
  master_sku_code: `QA-MASTER-${suffix}`,
  sku_code: code,
  name,
  category: 'Apparel',
  brand: 'QA',
  uom: 'Each',
  mrp: 99,
  cost_price: 50,
  status,
});
const activeSkuResult = await createSku(skuCode, `Company Link Product ${suffix}`);
assert.equal(activeSkuResult.response.status, 201, JSON.stringify(activeSkuResult.json));
const inactiveSkuResult = await createSku(inactiveSkuCode, `Inactive Link Product ${suffix}`, 'Inactive');
assert.equal(inactiveSkuResult.response.status, 201, JSON.stringify(inactiveSkuResult.json));

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
  const metadata = await send('/api/sku-company-links');
  assert.equal(metadata.response.status, 200);
  assert.ok(metadata.json.companies.some((row) => row.code === companyCode));
  assert.ok(metadata.json.locations.some((row) => (row.location_code || row.code) === locationCode));

  const invalidCompany = await send('/api/sku-company-links', 'POST', {
    action: 'search', company: 'QA-MISSING-COMPANY', location: locationCode,
  });
  assert.equal(invalidCompany.response.status, 400);
  const invalidLocation = await send('/api/sku-company-links', 'POST', {
    action: 'search', company: companyCode, location: 'QA-MISSING-LOCATION',
  });
  assert.equal(invalidLocation.response.status, 400);
  const missingSkuCodes = await send('/api/sku-company-links', 'POST', {
    action: 'add', company: companyCode, location: locationCode, skuCodes: [],
  });
  assert.equal(missingSkuCodes.response.status, 400);
  const duplicateRequestCodes = await send('/api/sku-company-links', 'POST', {
    action: 'add', company: companyCode, location: locationCode, skuCodes: [skuCode, skuCode.toLowerCase()],
  });
  assert.equal(duplicateRequestCodes.response.status, 400);
  const unknownSku = await send('/api/sku-company-links', 'POST', {
    action: 'add', company: companyCode, location: locationCode, skuCodes: [`QA-NOT-A-MASTER-SKU-${suffix}`],
  });
  assert.equal(unknownSku.response.status, 400);
  const inactiveSku = await send('/api/sku-company-links', 'POST', {
    action: 'add', company: companyCode, location: locationCode, skuCodes: [inactiveSkuCode],
  });
  assert.equal(inactiveSku.response.status, 400);
  const inactiveLocation = await send('/api/sku-company-links', 'POST', {
    action: 'add', company: companyCode, location: inactiveLocationCode, skuCodes: [skuCode],
  });
  assert.equal(inactiveLocation.response.status, 400);
  const noOpRemove = await send('/api/sku-company-links', 'POST', {
    action: 'remove', company: companyCode, location: locationCode, skuCodes: [skuCode],
  });
  assert.equal(noOpRemove.response.status, 200);
  assert.equal(noOpRemove.json.removed, 0, 'Removing a SKU that is not linked reports zero changes.');

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');

  await page.goto(`${base}/app/m/org-hierarchy`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Organisation Hierarchy' }).waitFor();
  await page.getByRole('button', { name: `QA Link Company ${suffix}` }).click();
  const orgCodeInput = page.getByRole('textbox', { name: /^Hierarchy Code/ });
  assert.equal(await orgCodeInput.inputValue(), companyCode);
  assert.equal(await orgCodeInput.isDisabled(), true);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await orgCodeInput.inputValue(), '');

  await page.goto(`${base}/app/m/location`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.getByText('Location Tag', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Advance Search', exact: true }).click();
  await page.getByText('Location Tag', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  const locationRow = page.locator('tbody tr').filter({ hasText: locationCode });
  await locationRow.waitFor();
  await locationRow.getByTitle('Edit').click();
  await page.waitForURL('**/app/m/location-create?id=*');
  assert.equal(await page.getByLabel('Location Code *').inputValue(), locationCode);
  await page.getByLabel('Location Name *').fill(`QA Updated Link Location ${suffix}`);
  const locationUpdate = page.waitForResponse(response => response.url().endsWith('/api/locations') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal((await locationUpdate).status(), 200);
  assert.equal((await db.collection('generic_records').findOne({ module: 'location', location_code: locationCode })).location_name, `QA Updated Link Location ${suffix}`);
  assert.equal(await page.getByRole('button', { name: 'Audit unavailable' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Location Tags', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Add Tags unavailable' }).isDisabled(), true);
  assert.equal(await page.getByText('Vishal Raj product Team', { exact: true }).count(), 0);

  const initialMetaPromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-company-links') && response.request().method() === 'GET');
  await page.goto(`${base}/app/sku-company-link`, { waitUntil: 'domcontentloaded' });
  assert.equal((await initialMetaPromise).status(), 200);

  const company = page.getByLabel('Company', { exact: true });
  const location = page.getByLabel('Location', { exact: true });
  await company.selectOption(companyCode);
  await location.selectOption(locationCode);
  const codeCheckbox = page.getByLabel(`Select ${skuCode}`, { exact: true }).first();
  await codeCheckbox.waitFor();
  const skuNameFilter = page.getByLabel('SKU Name', { exact: true });
  const noMatchPromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-company-links')
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.skuName === `missing-${suffix}`);
  await skuNameFilter.fill(`missing-${suffix}`);
  assert.equal((await noMatchPromise).status(), 200);
  assert.equal(await page.getByLabel(`Select ${skuCode}`, { exact: true }).count(), 0);
  const matchingPromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-company-links')
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.skuName === `Company Link Product ${suffix}`);
  await skuNameFilter.fill(`Company Link Product ${suffix}`);
  assert.equal((await matchingPromise).status(), 200);
  await page.getByRole('columnheader', { name: 'SKU Code', exact: true }).first().waitFor();
  for (const heading of ['SKU Code', 'Display SKU', 'SKU Desc', 'MFG SKU Code', 'Brand', 'Status']) {
    await page.getByRole('columnheader', { name: heading, exact: true }).nth(1).waitFor();
  }
  for (const size of ['20', '50', '100', '200']) {
    await page.getByLabel('Non Range Products records per page', { exact: true }).selectOption(size);
  }

  await page.getByLabel('Add', { exact: true }).check();
  await page.getByLabel(`Select ${skuCode}`, { exact: true }).check();
  const addResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-company-links')
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.action === 'add');
  await page.getByRole('button', { name: 'Add selected', exact: true }).click();
  const addResponse = await addResponsePromise;
  assert.equal(addResponse.status(), 200, JSON.stringify(await addResponse.json()));
  assert.deepEqual(await addResponse.json(), { added: 1 });
  await page.getByLabel(`Select ${skuCode}`, { exact: true }).waitFor();
  assert.equal(await page.getByLabel(`Select ${skuCode}`, { exact: true }).count(), 1, 'The new link moves to the linked grid.');

  const storedLink = await db.collection('generic_records').findOne({
    module: 'sku-company-link', company_location: `${companyCode}:${locationCode}`, sku_code: skuCode,
  });
  assert.ok(storedLink);
  assert.equal(storedLink.company, companyCode);
  assert.equal(storedLink.location, locationCode);
  assert.equal(storedLink.created_by, username);
  assert.equal(storedLink.modified_by, username);
  assert.ok(storedLink.created_date);
  assert.ok(storedLink.modified_date);

  const genericCreate = await send('/api/generic', 'POST', {
    module: 'sku-company-link', company_location: `${companyCode}:${locationCode}`,
    sku_code: 'NONEXISTENT-SKU', code: `BYPASS-${suffix}`, name: 'Bypassed link',
  });
  assert.equal(genericCreate.response.status, 501);
  const genericEdit = await send('/api/generic', 'PUT', { id: storedLink.id, sku_code: 'NONEXISTENT-SKU' });
  assert.equal(genericEdit.response.status, 501);
  const genericDelete = await send('/api/generic', 'DELETE', { id: storedLink.id });
  assert.equal(genericDelete.response.status, 501);
  const unrelated = await send('/api/generic', 'POST', { module: 'qa-unrelated', code: `QA-${suffix}`, name: 'Unrelated metadata' });
  assert.equal(unrelated.response.status, 201);
  const genericMigration = await send('/api/generic', 'PUT', { id: unrelated.json.id, module: 'sku-company-link' });
  assert.equal(genericMigration.response.status, 501);
  assert.equal((await db.collection('generic_records').findOne({ id: storedLink.id })).sku_code, skuCode);
  assert.equal((await db.collection('generic_records').findOne({ id: unrelated.json.id })).module, 'qa-unrelated');

  const duplicateLink = await send('/api/sku-company-links', 'POST', {
    action: 'add', company: companyCode, location: locationCode, skuCodes: [skuCode.toLowerCase()],
  });
  assert.equal(duplicateLink.response.status, 200);
  assert.equal(duplicateLink.json.added, 0, 'An idempotent retry reports zero newly added rows.');
  assert.equal(await db.collection('generic_records').countDocuments({
    module: 'sku-company-link', company_location: `${companyCode}:${locationCode}`, sku_code: skuCode,
  }), 1);
  const filteredResult = await send('/api/sku-company-links', 'POST', {
    action: 'search', company: companyCode, location: locationCode, skuCode, skuName: '',
  });
  assert.equal(filteredResult.response.status, 200);
  assert.equal(filteredResult.json.availableRecords, 0);
  assert.equal(filteredResult.json.linkedRecords, 1);
  assert.equal(filteredResult.json.linked[0].sku_code, skuCode);

  await page.getByLabel('Remove', { exact: true }).check();
  await page.getByLabel(`Select ${skuCode}`, { exact: true }).check();
  const removeResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-company-links')
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.action === 'remove');
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
  const removeResponse = await removeResponsePromise;
  assert.equal(removeResponse.status(), 200, JSON.stringify(await removeResponse.json()));
  assert.deepEqual(await removeResponse.json(), { removed: 1 });
  await page.getByLabel(`Select ${skuCode}`, { exact: true }).waitFor();
  assert.equal(await db.collection('generic_records').countDocuments({
    module: 'sku-company-link', company_location: `${companyCode}:${locationCode}`, sku_code: skuCode,
  }), 0);
  const repeatedRemove = await send('/api/sku-company-links', 'POST', {
    action: 'remove', company: companyCode, location: locationCode, skuCodes: [skuCode],
  });
  assert.equal(repeatedRemove.response.status, 200);
  assert.equal(repeatedRemove.json.removed, 0);

  const raceResults = await Promise.all(Array.from({ length: 8 }, (_, index) => send('/api/sku-company-links', 'POST', {
    action: 'add', company: companyCode, location: locationCode,
    skuCodes: [index % 2 ? skuCode.toLowerCase() : skuCode],
  })));
  assert.ok(raceResults.every(result => result.response.status === 200), JSON.stringify(raceResults.map(result => [result.response.status, result.json])));
  assert.equal(raceResults.reduce((sum, result) => sum + result.json.added, 0), 1);
  assert.equal(await db.collection('generic_records').countDocuments({ module: 'sku-company-link', company_location: `${companyCode}:${locationCode}`, sku_code: skuCode }), 1);
  const linkIndex = (await db.collection('generic_records').listIndexes().toArray()).find(index => index.name === 'uq_sku_company_link');
  assert.equal(linkIndex?.unique, true);
  assert.equal(linkIndex?.partialFilterExpression?.module, 'sku-company-link');
  const removeRace = await Promise.all(Array.from({ length: 8 }, () => send('/api/sku-company-links', 'POST', {
    action: 'remove', company: companyCode, location: locationCode, skuCodes: [skuCode],
  })));
  assert.ok(removeRace.every(result => result.response.status === 200));
  assert.equal(removeRace.reduce((sum, result) => sum + result.json.removed, 0), 1);
  assert.equal(await db.collection('generic_records').countDocuments({ module: 'sku-company-link', company_location: `${companyCode}:${locationCode}`, sku_code: skuCode }), 0);

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await company.inputValue(), '');
  assert.equal(await location.inputValue(), '');
  assert.equal(await page.getByLabel('SKU Code', { exact: true }).inputValue(), '');
  assert.equal(await skuNameFilter.inputValue(), '');
  assert.equal(await page.getByLabel('View', { exact: true }).isChecked(), true);

  const eventsAfter = await send('/api/inventory-sync/central/events');
  assert.equal(eventsAfter.response.status, 200);
  assert.deepEqual(eventsAfter.json.map((event) => event.event_key).sort(), eventsBefore.json.map((event) => event.event_key).sort());
  assert.deepEqual(errors, []);
  console.log('PASS SKU Company Link: authenticated company/location/SKU references, searchable dual grids, selected add/remove actions, active reference guards, accurate idempotent counts, actor/date Mongo readback, reset, and unchanged Central Inventory events.');
} catch (error) {
  console.error('SKU Company Link browser state at failure:', {
    url: page.url(),
    visible: await page.locator('body').innerText().catch(() => ''),
    errors,
  });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
