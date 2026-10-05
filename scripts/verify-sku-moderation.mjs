import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || '';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
assert.ok(username && password, 'SKU Moderation verification requires the generated administrator login.');
assert.ok(/^codexqa_[a-z0-9_]+$/i.test(dbName), 'SKU Moderation verification requires a generated codexqa MongoDB database.');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname), 'SKU Moderation verification requires a local app.');
const mongoUrl = new URL(mongoUri);
assert.ok(['mongodb:', 'mongodb+srv:'].includes(mongoUrl.protocol)
  && ['localhost', '127.0.0.1', '::1'].includes(mongoUrl.hostname),
'SKU Moderation verification only permits a loopback MongoDB server.');

const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
const channelA = `QA-MOD-A-${suffix}`;
const channelB = `QA-MOD-B-${suffix}`;
const skuCode = `QA-MOD-SKU-${suffix}`;
const secondSkuCode = `QA-MOD-ALT-${suffix}`;
const manualSellerSku = `QA-MANUAL-${suffix}`;
const importSellerSku = `QA-IMPORT-${suffix}`;
const wrongChannelSellerSku = `QA-WRONG-CHANNEL-${suffix}`;
const importProductId = `QA,PRODUCT-${suffix}`;
const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
page.setDefaultTimeout(12000);
const main = () => page.locator('[data-screen-frame]:not([aria-hidden="true"]) main').last();
const addUnmappedFixture = async ({ channelCode, sellerSku, productId }) => {
  const counter = await db.collection('_counters').findOneAndUpdate(
    { _id: 'sku_channel_links' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' },
  );
  const id = (counter.value || counter).seq;
  await db.collection('sku_channel_links').insertOne({
    id, channel_code: channelCode, channel_sku_code: sellerSku, seller_sku: sellerSku,
    channel_product_id: productId, product_id: productId, sku_code: '', eretail_sku: '',
    sku_name: `Moderation listing ${suffix}`, status: 'Active', pricing: 79, mrp: 100,
    created_date: new Date().toISOString(),
  });
  return id;
};
const eventKeys = async () => {
  const response = await page.request.get(`${base}/api/inventory-sync/central/events`);
  assert.equal(response.status(), 200);
  return (await response.json()).map(event => event.event_key).sort();
};

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const eventsBefore = await eventKeys();

  for (const [code, name] of [[channelA, `QA Moderation ${suffix}`], [channelB, `QA Other Channel ${suffix}`]]) {
    const response = await page.request.post(`${base}/api/channels`, { data: { channel_code: code, channel_name: name, channel_type: 'Marketplace', status: 'Active' } });
    assert.equal(response.status(), 201, JSON.stringify(await response.json()));
  }
  for (const [code, name] of [[skuCode, `Moderation SKU ${suffix}`], [secondSkuCode, `Alternate Moderation SKU ${suffix}`]]) {
    const response = await page.request.post(`${base}/api/skus`, { data: { sku_code: code, name, description: name, status: 'Active' } });
    assert.equal(response.status(), 201, JSON.stringify(await response.json()));
  }

  const metaResponse = await page.request.get(`${base}/api/sku-moderation?meta=1`);
  assert.equal(metaResponse.status(), 200);
  const meta = await metaResponse.json();
  assert.deepEqual(meta.pageSizes, [50, 100, 200]);
  assert.equal(meta.maxImportRows, 5000);
  assert.ok(meta.channels.some(row => row.value === channelA));
  assert.ok(meta.channels.some(row => row.value === channelB));
  const templateResponse = await page.request.get(`${base}/api/sku-moderation?template=1`);
  assert.equal(templateResponse.status(), 200);
  assert.match(templateResponse.headers()['content-type'], /spreadsheetml/);
  const templateBook = new ExcelJS.Workbook();
  await templateBook.xlsx.load(await templateResponse.body());
  assert.deepEqual(templateBook.worksheets[0].getRow(1).values.slice(1), ['SKU Code', 'Channel SKU Code', 'Product ID', 'Channel']);

  const search = async (linkedUnlinkedFlag, rows = 50, filters = {}) => page.request.post(`${base}/api/sku-moderation`, { data: {
    rows, page: 1, sidx: '', sord: 'desc', linkedUnlinkedFlag, REQ_SEARCH_FLAG: true, doFetchCount: true,
    skuName: '', locCode: '', channelSkuCode: '', channelProductId: '', ...filters,
  } });
  for (const mode of [0, 1]) for (const size of [50, 100, 200]) {
    const response = await search(mode, size);
    assert.equal(response.status(), 200);
    const body = await response.json();
    for (const key of ['gridModel', 'rows', 'page', 'records', 'total']) assert.ok(key in body);
    assert.equal(body.linkedUnlinkedFlag, mode);
    assert.equal(body.doFetchCount, true);
  }
  const emptyNameSearch = await search(0, 50, { locCode: channelA });
  assert.equal(emptyNameSearch.status(), 200);

  const manualFixtureId = await addUnmappedFixture({ channelCode: channelA, sellerSku: manualSellerSku, productId: `MANUAL-PRODUCT-${suffix}` });
  const importFixtureId = await addUnmappedFixture({ channelCode: channelA, sellerSku: importSellerSku, productId: importProductId });
  await addUnmappedFixture({ channelCode: channelB, sellerSku: wrongChannelSellerSku, productId: `WRONG-PRODUCT-${suffix}` });

  const missingLink = await page.request.put(`${base}/api/sku-moderation`, { data: { linkedSkuCode: '' } });
  assert.equal(missingLink.status(), 400);
  assert.equal((await missingLink.json()).error, 'Search SKU to link.');
  const invalidSkuLink = await page.request.put(`${base}/api/sku-moderation`, { data: { id: manualFixtureId, linkedSkuCode: `MISSING-${suffix}` } });
  assert.equal(invalidSkuLink.status(), 400);
  const invalidActionCode = await page.request.put(`${base}/api/sku-moderation`, { data: { id: manualFixtureId, linkedSkuCode: skuCode, actionCode: 9 } });
  assert.equal(invalidActionCode.status(), 400);
  const staleLink = await page.request.put(`${base}/api/sku-moderation`, { data: { id: Number.MAX_SAFE_INTEGER, linkedSkuCode: skuCode } });
  assert.equal(staleLink.status(), 404);
  const emptyImport = await page.request.post(`${base}/api/sku-moderation`, { data: { action: 'import', fileName: 'empty.csv', rows: [] } });
  assert.equal(emptyImport.status(), 400);
  const oversizedImport = await page.request.post(`${base}/api/sku-moderation`, { data: { action: 'import', fileName: 'too-many.csv', rows: Array.from({ length: 5001 }, () => ({})) } });
  assert.equal(oversizedImport.status(), 400);

  await page.goto(`${base}/app/sku-moderation`, { waitUntil: 'domcontentloaded' });
  await main().getByRole('button', { name: 'Enquiry/Create', exact: true }).waitFor();
  await main().getByRole('button', { name: 'Import', exact: true }).first().waitFor();
  for (const mode of ['Unlinked', 'Linked']) await main().getByLabel(mode, { exact: true }).waitFor();
  for (const heading of ['Image', 'SKU Name', 'Channel', 'Seller SKU', 'ERetail Sku', 'Product ID', 'Pricing', 'Other Info', 'Action']) await main().getByRole('columnheader', { name: heading, exact: true }).waitFor();
  assert.deepEqual((await main().getByLabel('Page size').locator('option').allTextContents()).map(value => value.trim()), ['50', '100', '200']);
  const channelFilter = main().getByLabel('Channel', { exact: true });
  await page.waitForFunction((value) => [...document.querySelectorAll('[data-screen-frame]:not([aria-hidden="true"]) main select[aria-label="Channel"]')]
    .some(select => [...select.options].some(option => option.value === value)), channelA);
  assert.ok((await channelFilter.locator('option').evaluateAll(options => options.map(option => option.value))).includes(channelA));
  await channelFilter.selectOption(channelA);
  await main().getByLabel('Seller SKU', { exact: true }).fill(manualSellerSku);
  const enquirySearchPromise = page.waitForResponse(response => response.url().endsWith('/api/sku-moderation') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await main().getByRole('button', { name: 'Search', exact: true }).click();
  assert.equal((await (await enquirySearchPromise).json()).records, 1);
  const manualRow = main().locator('tbody tr').filter({ hasText: manualSellerSku });
  await manualRow.getByRole('button', { name: /Link/ }).click();
  const modal = page.getByRole('dialog', { name: 'Product Link' });
  await modal.getByLabel('Search Item to link').fill(skuCode);
  const candidateResponse = await page.waitForResponse(response => response.url().includes('/api/sku-moderation?q=') && response.status() === 200);
  assert.ok((await candidateResponse.json()).some(row => row.sku_code === skuCode));
  const candidateButton = modal.getByRole('button').filter({ hasText: skuCode }).first();
  await candidateButton.waitFor();
  await candidateButton.click();
  const linkResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/sku-moderation') && response.request().method() === 'PUT');
  await modal.getByRole('button', { name: 'Link Now', exact: true }).click();
  const linkResponse = await linkResponsePromise;
  assert.equal(linkResponse.status(), 200, JSON.stringify(await linkResponse.json()));
  await page.getByText('Data saved successfully.', { exact: true }).waitFor();
  const manuallyLinked = await db.collection('sku_channel_links').findOne({ id: manualFixtureId });
  assert.equal(manuallyLinked.sku_code, skuCode);
  assert.equal(manuallyLinked.eretail_sku, skuCode);
  assert.equal(manuallyLinked.updated_by, username);
  assert.ok(manuallyLinked.linked_at && manuallyLinked.updated_date);

  const linkedModeSearch = page.waitForResponse(response => response.url().endsWith('/api/sku-moderation') && response.request().method() === 'POST');
  await main().getByLabel('Linked', { exact: true }).check();
  const linkedResult = await (await linkedModeSearch).json();
  assert.ok(linkedResult.gridModel.some(row => row.id === manualFixtureId));
  await main().locator('tbody tr').filter({ hasText: manualSellerSku }).getByText(skuCode, { exact: true }).waitFor();

  const downloadPromise = page.waitForEvent('download');
  await main().getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'SKU_Moderation.xlsx');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exportBook = new ExcelJS.Workbook();
  await exportBook.xlsx.load(Buffer.concat(chunks));
  const exportedRows = exportBook.worksheets[0].getSheetValues();
  assert.ok(exportedRows.some(row => Array.isArray(row) && row.includes(manualSellerSku) && row.includes(skuCode)));

  await main().getByRole('button', { name: 'Import', exact: true }).first().click();
  await main().getByLabel('Upload Template', { exact: true }).waitFor();
  await main().getByRole('link', { name: 'Download Template', exact: true }).waitFor();
  await main().getByText('**Note: Max 5000 lines are allowed at a time.', { exact: true }).waitFor();
  const csv = [
    'SKU Code,Channel SKU Code,Product ID,Channel',
    `${skuCode},${importSellerSku},"${importProductId}",${channelA}`,
    `MISSING-${suffix},${manualSellerSku},MANUAL-PRODUCT-${suffix},${channelA}`,
    `${secondSkuCode},${wrongChannelSellerSku},WRONG-PRODUCT-${suffix},${channelA}`,
    `${secondSkuCode},${importSellerSku},"${importProductId}",${channelA}`,
  ].join('\n');
  await main().getByLabel('Upload Template', { exact: true }).setInputFiles({ name: 'moderation-mappings.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await main().getByRole('button', { name: 'Import', exact: true }).last().click();
  await main().getByText('Invalid SKU Code', { exact: true }).waitFor();
  await main().getByText('Unmapped SKU was not found.', { exact: true }).waitFor();
  await main().getByText('Channel SKU is already linked.', { exact: true }).waitFor();
  const batchId = await main().getByLabel('Import Batch No', { exact: true }).inputValue();
  assert.match(batchId, /^SKUMOD\d+-[A-F0-9]{6}$/);
  await main().getByText('Total Delivery Import:4 Successful:1 Failed:3 In Process:0', { exact: true }).waitFor();
  assert.equal(await db.collection('sku_channel_links').findOne({ id: importFixtureId }).then(row => row.eretail_sku), skuCode);
  const otherChannelListing = await db.collection('sku_channel_links').findOne({ channel_sku_code: wrongChannelSellerSku });
  assert.equal(otherChannelListing.eretail_sku, '', 'A row from another channel must not be mapped by a matching seller SKU alone.');
  const batch = await db.collection('generic_records').findOne({ module: 'sku-moderation-import', batch_id: batchId });
  assert.equal(batch.created_by, username);
  assert.ok(batch.created_date);
  assert.equal(batch.results.length, 4);
  assert.equal(batch.results.filter(row => !row.remarks).length, 1);
  assert.deepEqual(batch.results.map(row => row.remarks), ['', 'Invalid SKU Code', 'Unmapped SKU was not found.', 'Channel SKU is already linked.']);

  await main().getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await main().getByLabel('Import Batch No', { exact: true }).inputValue(), '');
  assert.equal(await main().getByLabel('Upload Template', { exact: true }).inputValue(), '');
  assert.equal(await db.collection('generic_records').countDocuments({ module: 'sku-moderation-import', batch_id: batchId }), 1,
    'Reset clears the screen draft but leaves the saved import batch and row outcomes durable.');
  assert.deepEqual(await eventKeys(), eventsBefore, 'Mapping seller listings must not mutate Central Inventory stock.');
  assert.deepEqual(errors, [], `Unexpected browser/API errors: ${errors.join(' | ')}`);
  console.log('PASS SKU Moderation: signed-in generated MongoDB workflow, channel-scoped seller linking, linked/unlinked enquiry, candidate lookup, XLSX export/template, quoted CSV import, row-level errors and durable batch actor/results, 5000-row guard, atomic map protection, and unchanged Central Inventory events.');
} catch (error) {
  console.error('SKU Moderation browser state at failure:', { url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
