import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const categoryCode = `QA${suffix}`;
const categoryName = `QA HSN ${suffix}`;
const renamedCategory = `QA HSN Updated ${suffix}`;
const skuCategoryCode = `QB${suffix}`;
const skuCategoryName = `QA SKU HSN ${suffix}`;

assert.ok(username && password, 'Tax Category verification requires an isolated administrator.');
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

const invalidCategory = await send('/api/tax-categories', 'POST', { code: '', name: 'Missing code' });
assert.equal(invalidCategory.response.status, 400);
const invalidDescription = await send('/api/tax-categories', 'POST', { code: `QI${suffix}`, name: ' ' });
assert.equal(invalidDescription.response.status, 400);

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
assert.ok(mongoUri && dbName, 'Tax Category test must use the generated isolated MongoDB database.');
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
  const initialRequestPromise = page.waitForRequest((request) => request.url().endsWith('/api/tax-categories') && request.method() === 'POST' && request.postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.goto(`${base}/app/tax-categories`, { waitUntil: 'domcontentloaded' });
  const screen = page.locator('[data-screen-frame][aria-hidden="false"] main');
  const initialRequest = await initialRequestPromise;
  assert.deepEqual(
    (({ rows, page: pageNumber, sidx, sord }) => ({ rows, page: pageNumber, sidx, sord }))(initialRequest.postDataJSON()),
    { rows: 20, page: 1, sidx: '', sord: 'asc' },
  );
  assert.deepEqual(await screen.getByLabel('Records per Page').locator('option').allTextContents(), ['20', '50', '100', '200']);

  await screen.getByRole('button', { name: 'Add New', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Tax Category Create/Edit' });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('alert').getByText('Please Enter Tax Category Name', { exact: true }).waitFor();
  await editor.getByLabel('Tax Category (HSN/SAC)').fill(categoryCode);
  await editor.getByLabel('Description').fill(categoryName);
  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/tax-categories') && response.request().method() === 'POST' && response.status() === 201);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createResponsePromise;
  const category = await createResponse.json();
  assert.equal(category.code, categoryCode);
  assert.equal(category.name, categoryName);
  assert.equal(category.type, 'HSN (Goods)');
  const persistedCategory = await db.collection('generic_records').findOne({ id: category.id, module: 'tax-category' });
  assert.equal(persistedCategory.status, 'Active');

  let duplicate = await send('/api/tax-categories', 'POST', { code: categoryCode.toLowerCase(), name: `Another ${suffix}` });
  assert.equal(duplicate.response.status, 409);
  duplicate = await send('/api/tax-categories', 'POST', { code: `QC${suffix}`, name: categoryName.toLowerCase() });
  assert.equal(duplicate.response.status, 409);
  const staleEdit = await send('/api/tax-categories', 'PUT', { id: Number.MAX_SAFE_INTEGER, code: categoryCode, name: categoryName, status: 'Active' });
  assert.equal(staleEdit.response.status, 404);

  const zoneResponse = await send('/api/tax-zones', 'POST', {
    code: '0', name: `QA Tax Zone ${suffix}`, country: 'INDIA', states: ['Delhi'], status: 'Active', description: 'Isolated tax category dependency',
  });
  assert.equal(zoneResponse.response.status, 201, JSON.stringify(zoneResponse.json));
  const taxCodeResponse = await send('/api/taxcodes', 'POST', {
    tax_code: `TC${suffix}`, tax_code_type: 'GST', tax_nature: 'Central Cess', start_date: '2026-09-30',
    percentage: 5, description: `Tax Category test ${suffix}`, is_active: 'Active',
  });
  assert.equal(taxCodeResponse.response.status, 201, JSON.stringify(taxCodeResponse.json));
  const taxGroupResponse = await send('/api/tax-groups', 'POST', {
    code: `TCG${suffix}`, name: `QA Tax Category Group ${suffix}`, applied_on: 'Cost', start_date: '2026-09-30', status: 'Active',
    tax_codes: [{ tax_code_id: taxCodeResponse.json.id, tax_level: '1' }],
  });
  assert.equal(taxGroupResponse.response.status, 201, JSON.stringify(taxGroupResponse.json));
  const taxApplicationResponse = await send('/api/taxapp', 'POST', {
    tax_category: categoryCode, tax_type: 'Sales', tax_group_code: taxGroupResponse.json.code, goods_direction: 'ALL',
    tax_zone: zoneResponse.json.code, start_date: '2026-09-30', tax_authority: '',
    is_form_c_tax: false, is_form_h_tax: false, is_active: 'Active', from_mrp: 0, to_mrp: 0,
  });
  assert.equal(taxApplicationResponse.response.status, 201, JSON.stringify(taxApplicationResponse.json));
  const resolvedBefore = await send(`/api/taxapp?resolve=true&tax_category=${encodeURIComponent(categoryCode)}&tax_type=Sales&goods_direction=IN&tax_zone=${encodeURIComponent(zoneResponse.json.code)}&mrp=100`);
  assert.equal(resolvedBefore.response.status, 200);
  assert.equal(resolvedBefore.json.match?.tax_category, categoryCode);

  const renameUsedCategory = await send('/api/tax-categories', 'PUT', { id: category.id, code: `${categoryCode}X`, name: categoryName, status: 'Active' });
  assert.equal(renameUsedCategory.response.status, 409, 'A category referenced by a Tax Application must keep its code.');
  const whitespaceSameCode = await send('/api/tax-categories', 'PUT', { id: category.id, code: ` ${categoryCode} `, name: categoryName, status: 'Active' });
  assert.equal(whitespaceSameCode.response.status, 200);
  assert.equal(whitespaceSameCode.json.type, 'HSN (Goods)', 'An edit must preserve the type not shown in the editor.');

  await screen.locator('thead input').first().fill(categoryCode);
  const filterRequestPromise = page.waitForRequest((request) => request.url().endsWith('/api/tax-categories') && request.method() === 'POST' && request.postDataJSON()?.REQ_SEARCH_FLAG === true);
  await screen.getByRole('button', { name: 'Search', exact: true }).click();
  const filterRequest = await filterRequestPromise;
  assert.equal(filterRequest.postDataJSON().taxCatName, categoryCode);
  await screen.locator('tbody tr').filter({ hasText: categoryCode }).locator('button[title="Edit"]').click();
  const editDialog = page.getByRole('dialog', { name: new RegExp(`Tax Category Create/Edit.*${categoryCode}`) });
  await editDialog.getByLabel('Description').fill(renamedCategory);
  await editDialog.getByLabel('Status').selectOption('Inactive');
  const editResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/tax-categories') && response.request().method() === 'PUT');
  await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
  const editResponse = await editResponsePromise;
  assert.equal(editResponse.status(), 200, JSON.stringify(await editResponse.json()));
  const editedCategory = await editResponse.json();
  assert.equal(editedCategory.code, categoryCode);
  assert.equal(editedCategory.name, renamedCategory);
  assert.equal(editedCategory.status, 'Inactive');
  assert.equal(editedCategory.type, 'HSN (Goods)');

  const inactiveFilter = await send('/api/tax-categories', 'POST', {
    REQ_SEARCH_FLAG: true, rows: 20, page: 1, sidx: '', sord: 'asc', taxCatName: categoryCode,
    taxCatdesc: renamedCategory, displayIsActive: 'Inactive',
  });
  assert.equal(inactiveFilter.response.status, 200);
  assert.equal(inactiveFilter.json.records, 1);
  const inactiveApplication = await send('/api/taxapp', 'POST', {
    tax_category: categoryCode, tax_type: 'Purchase', tax_group_code: taxGroupResponse.json.code, goods_direction: 'ALL',
    tax_zone: zoneResponse.json.code, start_date: '2026-09-30', is_active: 'Active', from_mrp: 0, to_mrp: 0,
  });
  assert.equal(inactiveApplication.response.status, 400, 'Inactive categories cannot be assigned to a new tax rule.');
  const resolvedInactive = await send(`/api/taxapp?resolve=true&tax_category=${encodeURIComponent(categoryCode)}&tax_type=Sales&goods_direction=IN&tax_zone=${encodeURIComponent(zoneResponse.json.code)}&mrp=100`);
  assert.deepEqual(resolvedInactive.json, { match: null, candidates: [] }, 'Inactive categories must not resolve to an active tax rule.');
  assert.equal((await send('/api/tax-categories', 'DELETE', { id: category.id })).response.status, 409);

  const skuCategoryResponse = await send('/api/tax-categories', 'POST', { code: skuCategoryCode, name: skuCategoryName });
  assert.equal(skuCategoryResponse.response.status, 201);
  const sku = await send('/api/skus', 'POST', {
    sku_code: `QA-TAX-${suffix}`, name: `QA Tax SKU ${suffix}`, hsn: skuCategoryCode, status: 'Active',
  });
  assert.equal(sku.response.status, 201, JSON.stringify(sku.json));
  const renameSkuCategory = await send('/api/tax-categories', 'PUT', {
    id: skuCategoryResponse.json.id, code: `${skuCategoryCode}X`, name: skuCategoryName, status: 'Active',
  });
  assert.equal(renameSkuCategory.response.status, 409, 'A category referenced by a SKU must keep its code.');

  assert.deepEqual(await centralEvents(), eventsBefore, 'Tax Category and tax-rule configuration must not mutate stock.');
  assert.deepEqual(errors, []);
  console.log('PASS Tax Category: signed create/edit/search/status, duplicate and stale-ID guards, HSN/SAC code dependency protection for SKU and Tax Application, Tax Application dependency validation/resolution, Mongo readback, and no Central Inventory changes.');
} finally {
  await browser.close();
  await mongo.close();
}
