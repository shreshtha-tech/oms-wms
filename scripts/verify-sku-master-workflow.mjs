import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const skuCode = `QA-SKU-${suffix}`;
const masterSkuCode = `QA-MASTER-${suffix}`;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

assert.ok(username && password, 'SKU Master verification requires an isolated administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'SKU Master test must use a generated codexqa MongoDB database.');
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
  const missingSku = await send('/api/skus', 'POST', { sku_code: ' ', name: 'invalid' });
  assert.equal(missingSku.response.status, 400);
  const negativePrice = await send('/api/skus', 'POST', { sku_code: `BAD-${suffix}`, name: 'Invalid price', mrp: -1 });
  assert.equal(negativePrice.response.status, 400);
  const invalidStatus = await send('/api/skus', 'POST', { sku_code: `BADSTATUS-${suffix}`, name: 'Invalid status', status: 'Deleted' });
  assert.equal(invalidStatus.response.status, 400);

  await page.goto(base);
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const initialSearchPromise = page.waitForResponse((response) => response.url().endsWith('/api/skus') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.goto(`${base}/app/skus`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'SKU Enquiry', exact: true }).waitFor();
  const initialSearch = await initialSearchPromise;
  assert.equal(initialSearch.status(), 200);
  const initialRows = await initialSearch.json();
  assert.equal(initialRows.records, await db.collection('skus').countDocuments(), 'The initial enquiry reflects every record already created in the isolated collection.');
  assert.equal((await send('/api/skus', 'POST', { REQ_SEARCH_FLAG: true, sku: skuCode, rows: 50, page: 1 })).json.records, 0, 'The generated SKU is absent before this workflow creates it.');
  assert.equal(await page.getByRole('button', { name: 'MetaData Export', exact: true }).isDisabled(), true);

  await page.getByRole('button', { name: 'Add New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add New SKU' });
  await dialog.getByRole('button', { name: 'Create SKU', exact: true }).click();
  await dialog.getByRole('alert').getByText('Please Enter SKU Code', { exact: true }).waitFor();
  await dialog.getByLabel('Master SKU Code').fill(masterSkuCode);
  await dialog.getByLabel('SKU Code', { exact: true }).fill(skuCode);
  await dialog.getByLabel('SKU Name').fill(`Verified SKU ${suffix}`);
  await dialog.getByLabel('SKU Classification').fill('QA verified');
  await dialog.getByLabel('Category', { exact: true }).selectOption('Apparel');
  await dialog.getByLabel('Portal / Brand').fill('QA brand');
  await dialog.getByLabel('UOM').selectOption('PCS');
  await dialog.getByLabel('MRP').fill('125');
  await dialog.getByLabel('Cost Price').fill('50');
  await dialog.getByLabel('Sale Price').fill('99');
  const createPromise = page.waitForResponse((response) => response.url().endsWith('/api/skus') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG !== true);
  await dialog.getByRole('button', { name: 'Create SKU', exact: true }).click();
  const createResponse = await createPromise;
  assert.equal(createResponse.status(), 201, JSON.stringify(await createResponse.json()));
  const created = await createResponse.json();
  assert.equal(created.sku_code, skuCode);
  assert.equal(created.master_sku_code, masterSkuCode);
  assert.equal(created.mrp, 125);
  assert.equal(created.created_by, username);
  const pageOne = await send('/api/skus', 'POST', { REQ_SEARCH_FLAG: true, sku: skuCode, rows: 50, page: 1, sidx: 'sku', sord: 'asc' });
  assert.equal(pageOne.response.status, 200);
  assert.equal(pageOne.json.records, 1);
  assert.equal(pageOne.json.total, 1);
  assert.equal(pageOne.json.gridModel[0].id, created.id);
  assert.deepEqual(pageOne.json.rows, pageOne.json.gridModel);
  const pageTwo = await send('/api/skus', 'POST', { REQ_SEARCH_FLAG: true, sku: skuCode, rows: 50, page: 2, sidx: 'sku', sord: 'asc' });
  assert.equal(pageTwo.response.status, 200);
  assert.equal(pageTwo.json.page, 2);
  assert.equal(pageTwo.json.records, 1);
  assert.equal(pageTwo.json.gridModel.length, 0);
  const stored = await db.collection('skus').findOne({ id: created.id });
  assert.equal(stored.name, `Verified SKU ${suffix}`);
  assert.equal(stored.cost_price, 50);

  const duplicate = await send('/api/skus', 'POST', { ...created, sku_code: skuCode.toLowerCase() });
  assert.equal(duplicate.response.status, 409);
  const staleUpdate = await send('/api/skus', 'PUT', { ...created, id: Number.MAX_SAFE_INTEGER });
  assert.equal(staleUpdate.response.status, 404);
  const deleteBlocked = await send('/api/skus', 'DELETE', { id: created.id });
  assert.equal(deleteBlocked.response.status, 409);

  const editRow = page.locator('tbody tr').filter({ hasText: skuCode });
  await editRow.waitFor();
  await editRow.getByRole('button', { name: `Edit SKU ${skuCode}` }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit SKU' });
  await editDialog.getByLabel('SKU Name').fill(`Updated SKU ${suffix}`);
  await editDialog.getByLabel('Sale Price').fill('89');
  await editDialog.getByLabel('Status').selectOption('Inactive');
  const updatePromise = page.waitForResponse((response) => response.url().endsWith('/api/skus') && response.request().method() === 'PUT');
  await editDialog.getByRole('button', { name: 'Update SKU', exact: true }).click();
  const updateResponse = await updatePromise;
  assert.equal(updateResponse.status(), 200, JSON.stringify(await updateResponse.json()));
  const updated = await updateResponse.json();
  assert.equal(updated.sku_code, skuCode, 'The existing SKU code and Master SKU contract remain unchanged during a descriptive edit.');
  assert.equal(updated.sale_price, 89);
  assert.equal(updated.status, 'Inactive');
  assert.equal(updated.updated_by, username);
  assert.equal((await db.collection('skus').findOne({ id: created.id })).name, `Updated SKU ${suffix}`);

  await page.getByRole('button', { name: 'Advance Search', exact: true }).click();
  await page.getByRole('button', { name: 'Filter Status' }).click();
  await page.getByRole('button', { name: 'Inactive', exact: true }).click();
  const filteredPromise = page.waitForResponse((response) => response.url().endsWith('/api/skus') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true)
    .then((response) => ({ response }), (error) => ({ error }));
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  const filteredResult = await filteredPromise;
  if (filteredResult.error) throw new Error(`SKU status filter request did not complete: ${filteredResult.error.message}; page=${page.url()}; visible=${(await page.locator('body').innerText().catch(() => '')).slice(0, 1600)}; errors=${errors.join(' | ')}`);
  assert.equal(filteredResult.response.status(), 200);
  assert.equal(await page.locator('tbody tr').filter({ hasText: skuCode }).count(), 1);
  const resetPromise = page.waitForResponse((response) => response.url().endsWith('/api/skus') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal((await resetPromise).status(), 200);
  assert.equal(await page.locator('tbody tr').filter({ hasText: skuCode }).count(), 1);

  const globalSearchInput = page.getByLabel('Search SKU code, style, SKU name, classification, brand');
  await globalSearchInput.fill(`Updated SKU ${suffix}`);
  const globalSearchPromise = page.waitForResponse((response) => response.url().endsWith('/api/skus') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true && response.request().postDataJSON()?.globalSearch === `Updated SKU ${suffix}`);
  await globalSearchInput.press('Enter');
  assert.equal((await globalSearchPromise).status(), 200);
  assert.equal(await page.locator('tbody tr').filter({ hasText: skuCode }).count(), 1, 'Global search finds SKU Name while the exact SKU Code filter remains empty.');
  const finalResetPromise = page.waitForResponse((response) => response.url().endsWith('/api/skus') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal((await finalResetPromise).status(), 200);

  await page.getByRole('button', { name: 'Import', exact: true }).first().click();
  await page.waitForURL('**/app/sku-import');
  await page.locator('input[type="file"][accept=".csv"]').waitFor();
  assert.deepEqual(await centralEvents(), eventsBefore);
  assert.deepEqual(errors, []);
  console.log('PASS SKU Master: signed create/edit/search/reset, initial load, page contract, global search by SKU Name, validation, duplicate/stale/delete guards, actor attribution, Mongo readback, Import routes to the real CSV workflow, metadata-export duplicate is blocked, and Central Inventory remains unchanged.');
} catch (error) {
  console.error('SKU Master browser state at failure:', { url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
