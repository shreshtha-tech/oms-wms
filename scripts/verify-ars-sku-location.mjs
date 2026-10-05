import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

assert.ok(username && password, 'ARS SKU-Location verification requires a signed-in isolated administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'ARS SKU-Location verification must use a generated codexqa MongoDB database.');

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const errors = [];
const downloadTrace = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', (response) => { if (response.url().includes('/api/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
page.on('request', (request) => { if (request.url().endsWith('/api/downloads')) downloadTrace.push(`request ${request.method()}`); });
page.on('response', (response) => { if (response.url().endsWith('/api/downloads')) downloadTrace.push(`response ${response.status()}`); });
page.on('download', (download) => downloadTrace.push(`download ${download.suggestedFilename()}`));
page.setDefaultTimeout(12_000);
const responseJson = async (response) => {
  const body = await response.json().catch(() => null);
  return { status: response.status(), body };
};
const open = async () => {
  await page.goto(`${base}/app/procurement/ars/sku-location`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add New', exact: true }).waitFor();
};
const moduleMain = () => page.locator('[data-screen-frame]:not([aria-hidden="true"]) main').last();
const grid = () => moduleMain().locator('table').filter({ hasText: 'Fullfillment Method' }).first();
const search = async () => {
  const request = page.waitForRequest((item) => item.url().endsWith('/api/fetchArsAttributes'));
  await moduleMain().getByRole('button', { name: 'Search', exact: true }).click();
  const pending = await request;
  const result = await responseJson(await pending.response());
  assert.equal(result.status, 200);
  return { request: pending, result: result.body };
};

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');

  const centralEvents = async () => {
    const response = await page.request.get(`${base}/api/inventory-sync/central/events`);
    assert.equal(response.status(), 200);
    return (await response.json()).map((event) => event.event_key).sort();
  };
  const eventsBefore = await centralEvents();
  const skuResponse = await page.request.get(`${base}/api/skus`);
  const locationResponse = await page.request.get(`${base}/api/locations`);
  const linksResponse = await page.request.get(`${base}/api/ars?entity=links`);
  assert.equal(skuResponse.status(), 200);
  assert.equal(locationResponse.status(), 200);
  assert.equal(linksResponse.status(), 200);
  const skus = await skuResponse.json();
  const locationRows = (await locationResponse.json()).rows;
  const existing = await linksResponse.json();
  const location = locationRows.find((row) => !row.status || row.status.toLowerCase() === 'active');
  assert.ok(location, 'The isolated tenant must contain at least one active location.');
  const locationCode = location.location_code || location.code;
  const locationName = location.location_name || location.name;
  const sku = skus.find((candidate) => candidate.sku_code && !existing.some((row) => row.sku_code === candidate.sku_code
    && (row.location_id === locationCode || row.location === locationName || row.location === locationCode)));
  assert.ok(sku, 'The isolated tenant must contain an SKU not already linked to the selected location.');

  await open();
  const expectedHeaders = ['Location', 'SKU', 'Category', 'Brand', 'Primary Vendor', 'Fullfillment Method', 'Fullfillment WH', 'WH Lead Time', 'Stock cover days', 'Minimum Transfer Qty', 'Transfer Unit Factor', 'ARS Flag', '', 'Maximum SKU Qty'];
  const headers = (await grid().locator('thead tr').first().locator('th').allTextContents()).map((value) => value.trim());
  assert.deepEqual(headers, expectedHeaders);
  assert.deepEqual((await moduleMain().getByLabel('Records per Page').locator('option').allTextContents()).map((value) => value.trim()), ['20', '50', '100', '200']);

  await grid().getByLabel('Location search').selectOption([locationName]);
  const initialSearch = await search();
  const initialPayload = initialSearch.request.postDataJSON();
  assert.equal(initialPayload.location, locationName);
  assert.equal(initialPayload.rows, 20);
  assert.equal(initialPayload.page, 1);
  assert.equal(initialPayload.clientId, '0');
  assert.equal(initialPayload.REQ_SEARCH_FLAG, true);
  assert.ok(Array.isArray(initialSearch.result.gridModel));
  assert.ok('records' in initialSearch.result && 'total' in initialSearch.result);

  await moduleMain().getByRole('button', { name: 'Advance Search', exact: true }).click();
  await moduleMain().getByLabel('SKU Name search').fill(`reset-${suffix}`);
  await moduleMain().getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await moduleMain().getByLabel('SKU Name search').count(), 0, 'Reset closes and clears the advanced filter.');

  await moduleMain().getByRole('button', { name: 'Add New', exact: true }).click();
  await moduleMain().getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('SkuCode is mandatory', { exact: true }).waitFor();
  await moduleMain().getByLabel('SKU', { exact: true }).fill(sku.sku_code);
  await moduleMain().getByLabel('Location', { exact: true }).selectOption(locationName);
  await moduleMain().getByLabel('Fullfillment Method', { exact: true }).selectOption('Distribution Center');
  await moduleMain().getByLabel('ARS Flag', { exact: true }).selectOption('1');
  await moduleMain().getByLabel('Stock cover days', { exact: true }).fill('8');
  const createRequest = page.waitForRequest((request) => request.url().endsWith('/api/addAndUpdateArsAttributes'));
  const createResponse = page.waitForResponse((response) => response.url().endsWith('/api/addAndUpdateArsAttributes'));
  await moduleMain().getByRole('button', { name: 'Save', exact: true }).click();
  const [addRequest, addResult] = await Promise.all([createRequest, createResponse.then(responseJson)]);
  assert.equal(addResult.status, 200, JSON.stringify(addResult.body));
  const addPayload = addRequest.postDataJSON();
  assert.equal(addPayload.skuCode, sku.sku_code);
  assert.equal(addPayload.location, locationName);
  assert.equal(addPayload.arsFlag, '1');
  assert.equal(addPayload.minimumTransferQty, '1.00');
  assert.equal(addPayload.transferUnitFactor, '1.00');
  const created = addResult.body.skuLocLinkDTO;
  assert.equal(created.sku_code, sku.sku_code);
  assert.equal(created.location_id, locationCode);
  assert.equal(created.stock_cover_days, 8);
  assert.equal(created.created_by, username);
  assert.equal(created.updated_by, username);
  assert.ok(created.created_date && created.updated_date);

  const duplicateResponse = await page.request.post(`${base}/api/addAndUpdateArsAttributes`, { data: addPayload });
  assert.equal(duplicateResponse.status(), 409);
  const malformedNumber = await page.request.post(`${base}/api/addAndUpdateArsAttributes`, { data: { ...addPayload, stockCoverDays: 'Infinity' } });
  assert.equal(malformedNumber.status(), 400);
  assert.match((await malformedNumber.json()).error, /Stock Cover Days/);
  const mongoCreated = await db.collection('ars_sku_links').findOne({ id: created.id });
  assert.equal(mongoCreated.sku_code, sku.sku_code);
  assert.equal(mongoCreated.location_id, locationCode);
  assert.equal(mongoCreated.stock_cover_days, 8);
  assert.equal(mongoCreated.created_by, username);

  await moduleMain().getByRole('button', { name: 'Reset', exact: true }).click();
  await grid().getByLabel('SKU search').fill(sku.sku_code);
  await search();
  const row = grid().locator('tbody tr').filter({ hasText: sku.sku_code }).first();
  await row.waitFor();
  await row.locator('button').click();
  await moduleMain().getByLabel('Stock cover days', { exact: true }).fill('9');
  const updateRequest = page.waitForRequest((request) => request.url().endsWith('/api/addAndUpdateArsAttributes'));
  const updateResponse = page.waitForResponse((response) => response.url().endsWith('/api/addAndUpdateArsAttributes'));
  await moduleMain().getByRole('button', { name: 'Save', exact: true }).click();
  const [editRequest, editResult] = await Promise.all([updateRequest, updateResponse.then(responseJson)]);
  assert.equal(editResult.status, 200, JSON.stringify(editResult.body));
  assert.equal(editRequest.postDataJSON().id, created.id);
  assert.equal(editResult.body.skuLocLinkDTO.stock_cover_days, 9);
  assert.equal(editResult.body.skuLocLinkDTO.updated_by, username);
  assert.equal((await db.collection('ars_sku_links').findOne({ id: created.id })).stock_cover_days, 9);
  assert.equal((await db.collection('ars_sku_links').findOne({ id: created.id })).updated_by, username);
  await page.getByText('Data Updated successfully.', { exact: true }).waitFor();

  await moduleMain().getByRole('button', { name: 'Bulk Update', exact: true }).click();
  await moduleMain().getByRole('button', { name: 'Update', exact: true }).click();
  await page.getByText('Location Type is mandatory', { exact: true }).waitFor();
  await moduleMain().getByLabel('Location Type').selectOption('2');
  await moduleMain().getByRole('button', { name: 'Update', exact: true }).click();
  await page.getByText('Select at least one attribute to update', { exact: true }).waitFor();
  await moduleMain().getByLabel('Update Stock Cover Days', { exact: true }).check();
  const bulkFilterSku = moduleMain().getByText('Update Filter', { exact: true }).locator('xpath=following::label[normalize-space(.)="SKU"][1]//input');
  await bulkFilterSku.fill(sku.sku_code);
  const bulkFilterValue = moduleMain().getByText('Update Filter', { exact: true }).locator('xpath=following::label[normalize-space(.)="Stock Cover Days"][1]//input');
  await bulkFilterValue.last().fill('10');
  const bulkRequest = page.waitForRequest((request) => request.url().endsWith('/api/bulkUpdateArsAttributes'));
  const bulkResponse = page.waitForResponse((response) => response.url().endsWith('/api/bulkUpdateArsAttributes'));
  await moduleMain().getByRole('button', { name: 'Update', exact: true }).click();
  const [bulkPayloadRequest, bulkResult] = await Promise.all([bulkRequest, bulkResponse.then(responseJson)]);
  assert.equal(bulkResult.status, 200, JSON.stringify(bulkResult.body));
  const bulkPayload = bulkPayloadRequest.postDataJSON();
  assert.equal(bulkPayload.locationType_bulk, '2');
  assert.equal(bulkPayload.stockCoverDaysCheckBox, true);
  assert.equal(bulkPayload.stockCoverDays_bulk, '10');
  assert.equal(bulkPayload.sku_bulk, sku.sku_code);
  assert.equal(bulkResult.body.skuLocLinkDTO.updatedRowCount, 1);
  await page.getByText('ARS Location Link updated successfully.', { exact: false }).waitFor();
  await moduleMain().getByRole('button', { name: 'Close', exact: true }).click();
  const bulkPersisted = await db.collection('ars_sku_links').findOne({ id: created.id });
  assert.equal(bulkPersisted.stock_cover_days, 10);
  assert.equal(bulkPersisted.updated_by, username);

  await moduleMain().getByRole('button', { name: 'Reset', exact: true }).click();
  await grid().getByLabel('SKU search').fill(sku.sku_code);
  await search();
  await grid().locator('tbody tr').filter({ hasText: sku.sku_code }).filter({ hasText: '10' }).waitFor();
  await moduleMain().getByRole('button', { name: 'Download visible rows', exact: true }).click();
  await page.getByText('Choose export format', { exact: true }).waitFor();
  await page.getByText('Exporting ARS SKU-Location Link', { exact: false }).waitFor();
  const downloadPromise = page.waitForEvent('download', { timeout: 8000 }).then((download) => ({ download }), (error) => ({ error }));
  const [, downloadResult] = await Promise.all([
    page.getByRole('button', { name: /Comma-separated values/ }).click(),
    downloadPromise,
  ]);
  if (downloadResult.error) throw new Error(`CSV browser download was not emitted: ${downloadResult.error.message}; trace=${downloadTrace.join(', ')}; body=${(await page.locator('body').innerText()).slice(0, 1800)}`);
  const download = downloadResult.download;
  assert.match(download.suggestedFilename(), /ars-sku-location-page-1-.*\.csv$/);
  const downloadedCsv = await readFile(await download.path(), 'utf8');
  assert.match(downloadedCsv, new RegExp(sku.sku_code));
  assert.match(downloadedCsv, /Stock Cover Days/);
  await open();
  await moduleMain().getByRole('button', { name: 'Bulk Import', exact: true }).click();
  await page.waitForURL(/common-import\?externalImportType=33/);
  assert.deepEqual(await centralEvents(), eventsBefore, 'ARS link configuration does not mutate Central Inventory.');
  assert.deepEqual(errors, []);
  console.log('PASS ARS SKU-Location Link: signed create/edit/bulk update, field validation and duplicate guard, authenticated audit fields, MongoDB readback, search/reset/paging contract, real CSV download, import routing, and unchanged Central Inventory events. Full export jobs, duplicate races, live parity, and downstream replenishment remain unverified.');
} catch (error) {
  console.error('ARS SKU-Location browser state at failure:', { url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
