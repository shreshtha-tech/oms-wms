import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const skuCode = `QA-BC-SKU-${suffix}`;
const barcode = `QA-BARCODE-${suffix}`;
const importedBarcode = `QA,IMPORTED-${suffix}`;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

assert.ok(username && password, 'SKU Barcode verification requires an isolated administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'SKU Barcode test must use a generated codexqa MongoDB database.');
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
const eventsBefore = await send('/api/inventory-sync/central/events');
assert.equal(eventsBefore.response.status, 200);
const masterResponse = await send('/api/skus', 'POST', {
  master_sku_code: `QA-MASTER-${suffix}`, sku_code: skuCode, name: `Barcode Product ${suffix}`,
  category: 'Apparel', brand: 'QA', uom: 'Each', mrp: 99, cost_price: 50, status: 'Active',
});
assert.equal(masterResponse.response.status, 201);
const masterSku = masterResponse.json;

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const expectedConflicts = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  if (/Failed to load resource: the server responded with a status of 409 \(Conflict\)/.test(message.text())) expectedConflicts.push(message.text());
  else errors.push(message.text());
});
page.setDefaultTimeout(12_000);

try {
  const existingBarcodeCount = await db.collection('sku_barcode').countDocuments();
  const invalidMaster = await send('/api/skubarcode', 'POST', { sku_code: `MISSING-${suffix}`, sku_barcode: `BAD-${suffix}` });
  assert.equal(invalidMaster.response.status, 400);
  const missingBarcode = await send('/api/skubarcode', 'POST', { sku_code: skuCode, sku_barcode: ' ' });
  assert.equal(missingBarcode.response.status, 400);
  const invalidCase = await send('/api/skubarcode', 'POST', { sku_code: skuCode, sku_barcode: `BADCASE-${suffix}`, case_size: 0 });
  assert.equal(invalidCase.response.status, 400);

  await page.goto(base);
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const initialSearchPromise = page.waitForResponse((response) => response.url().endsWith('/api/skubarcode') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.goto(`${base}/app/sku-barcode`, { waitUntil: 'domcontentloaded' });
  const initialSearch = await initialSearchPromise;
  assert.equal(initialSearch.status(), 200);
  const initialResult = await initialSearch.json();
  assert.equal(initialResult.records, existingBarcodeCount);

  await page.getByRole('button', { name: 'Add New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add New SKU Barcode' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Please fill all the mandatory fields', { exact: true }).waitFor();
  await dialog.getByLabel('SKU Code').fill(skuCode);
  await dialog.getByLabel('SKU Barcode').fill(barcode);
  await dialog.getByLabel('Case Size').fill('1');
  await dialog.getByLabel('Sale Price').fill('99');
  assert.equal(await dialog.getByLabel('SKU Name').inputValue(), masterSku.name);
  const createPromise = page.waitForResponse((response) => response.url().endsWith('/api/skubarcode') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG !== true);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createPromise;
  assert.equal(createResponse.status(), 201, JSON.stringify(await createResponse.json()));
  const created = await createResponse.json();
  assert.equal(created.sku_code, skuCode);
  assert.equal(created.sku_name, masterSku.name);
  assert.equal(created.sku_barcode, barcode);
  assert.equal(created.created_by, username);
  assert.equal((await db.collection('sku_barcode').findOne({ id: created.id })).sku_code, skuCode);

  const duplicateBarcode = await send('/api/skubarcode', 'POST', { sku_code: skuCode, sku_barcode: barcode.toLowerCase() });
  assert.equal(duplicateBarcode.response.status, 409);
  const staleUpdate = await send('/api/skubarcode', 'PUT', { id: Number.MAX_SAFE_INTEGER, sku_code: skuCode, sku_barcode: `STALE-${suffix}` });
  assert.equal(staleUpdate.response.status, 404);
  const staleDelete = await send('/api/skubarcode', 'DELETE', { id: Number.MAX_SAFE_INTEGER });
  assert.equal(staleDelete.response.status, 404);

  const createdRow = page.locator('tbody tr').filter({ hasText: barcode });
  await createdRow.waitFor();
  await createdRow.locator('button[title="Edit"]').click();
  const editDialog = page.getByRole('dialog', { name: 'Edit SKU Barcode' });
  await editDialog.getByLabel('Sale Price').fill('88');
  const updatePromise = page.waitForResponse((response) => response.url().endsWith('/api/skubarcode') && response.request().method() === 'PUT');
  await editDialog.getByRole('button', { name: 'Update', exact: true }).click();
  const updateResponse = await updatePromise;
  assert.equal(updateResponse.status(), 200, JSON.stringify(await updateResponse.json()));
  const updated = await updateResponse.json();
  assert.equal(updated.id, created.id);
  assert.equal(updated.sku_code, skuCode);
  assert.equal(updated.sku_barcode, barcode);
  assert.equal(updated.sale_price, 88);
  assert.equal(updated.modified_by, username);
  assert.equal((await db.collection('sku_barcode').findOne({ id: created.id })).sale_price, 88);

  await page.getByLabel('Filter SKU Code').fill(skuCode);
  const searchPromise = page.waitForResponse((response) => response.url().endsWith('/api/skubarcode') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  assert.equal((await searchPromise).status(), 200);
  assert.equal(await page.locator('tbody tr').filter({ hasText: barcode }).count(), 1);
  const resetPromise = page.waitForResponse((response) => response.url().endsWith('/api/skubarcode') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.getByRole('button', { name: 'Reset', exact: true }).last().click();
  assert.equal((await resetPromise).status(), 200);
  assert.equal(await page.locator('tbody tr').filter({ hasText: barcode }).count(), 1, 'Reset reloads rows using the default filter state.');

  await page.getByRole('button', { name: 'SKU BarCode Import', exact: true }).click();
  const templateDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'BarCode_Template.csv', exact: true }).click();
  assert.equal((await templateDownload).suggestedFilename(), 'BarCode_Template.csv');
  const fileInput = page.getByLabel('Upload Barcode Template');
  const importCsv = [
    'sku_barcode,sku_code,barcode_type,is_active,is_default,uom,case_size,sale_price,is_purchasable,is_saleable',
    `"${importedBarcode}",${skuCode},Default,Active,No,Each,1,78,Yes,Yes`,
    `"${importedBarcode}",${skuCode},Default,Active,No,Each,1,78,Yes,Yes`,
    `QA-INVALID-REFERENCE-${suffix},MISSING-${suffix},Default,Active,No,Each,1,78,Yes,Yes`,
  ].join('\n');
  await fileInput.setInputFiles({ name: `barcode-${suffix}.csv`, mimeType: 'text/csv', buffer: Buffer.from(importCsv) });
  await page.getByRole('button', { name: 'Import', exact: true }).last().click();
  await page.getByText('Import completed: 1 successful, 2 failed', { exact: true }).waitFor();
  const batch = await page.getByLabel('Import Batch No').inputValue();
  assert.match(batch, /^BC-\d+$/);
  const imported = await db.collection('sku_barcode').findOne({ sku_barcode: importedBarcode });
  assert.equal(imported.sku_code, skuCode);
  assert.equal(imported.import_batch_no, batch, 'Successful barcode rows retain the batch identifier shown to the operator.');
  assert.equal(await db.collection('sku_barcode').countDocuments({ sku_barcode: `QA-INVALID-REFERENCE-${suffix}` }), 0);
  const previewRows = await page.locator('table tbody tr').count();
  assert.equal(previewRows, 3);

  const eventsAfter = await send('/api/inventory-sync/central/events');
  assert.equal(eventsAfter.response.status, 200);
  assert.deepEqual(eventsAfter.json.map((event) => event.event_key).sort(), eventsBefore.json.map((event) => event.event_key).sort());
  assert.equal(expectedConflicts.length, 1, 'The duplicate import row is rejected once with HTTP 409.');
  assert.deepEqual(errors, []);
  console.log('PASS SKU Barcode: initial enquiry, signed create/edit, Master SKU reference validation, case-insensitive duplicate guard, audit attribution, server search/reset reload, honest CSV template, quoted CSV row outcomes, persisted successful-row batch ID, Mongo readback, and no Central Inventory changes.');
} catch (error) {
  console.error('SKU Barcode browser state at failure:', { url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors, expectedConflicts });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
