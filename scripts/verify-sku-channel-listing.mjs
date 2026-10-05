import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || '';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
assert.ok(username && password, 'SKU Channel Listing verification requires the generated administrator login.');
assert.ok(/^codexqa_[a-z0-9_]+$/i.test(dbName), 'SKU Channel Listing verification requires a generated codexqa MongoDB database.');
const appUrl = new URL(base);
assert.ok(['localhost', '127.0.0.1', '::1'].includes(appUrl.hostname), 'SKU Channel Listing verification requires a local app.');
const mongoUrl = new URL(mongoUri);
assert.ok(['mongodb:', 'mongodb+srv:'].includes(mongoUrl.protocol)
  && ['localhost', '127.0.0.1', '::1'].includes(mongoUrl.hostname),
'SKU Channel Listing verification only permits a loopback MongoDB server.');

const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
const channelCode = `QA-SCL-${suffix}`;
const skuCode = `QA-SCL-SKU-${suffix}`;
const clientId = `9${String(Date.now()).slice(-8)}`;
const channelSku = `QA-SELLER-${suffix}`;
const importChannelSku = `QA-IMPORT-${suffix}`;
const unmappedSellerSku = `QA-UNMAPPED-${suffix}`;
const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
let expectedImportFailure = false;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !(expectedImportFailure && /^Failed to load resource:.*\b400\b/.test(message.text()))) errors.push(message.text());
});
page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
page.setDefaultTimeout(12000);
const main = () => page.locator('[data-screen-frame]:not([aria-hidden="true"]) main').last();
const readEvents = async () => {
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
  const eventsBefore = await readEvents();

  const channelResponse = await page.request.post(`${base}/api/channels`, { data: {
    channel_code: channelCode, channel_name: `QA Listing ${suffix}`, channel_type: 'Marketplace', status: 'Active',
  } });
  assert.equal(channelResponse.status(), 201, JSON.stringify(await channelResponse.json()));
  const skuResponse = await page.request.post(`${base}/api/skus`, { data: {
    sku_code: skuCode, name: `QA Listing SKU ${suffix}`, description: `SKU Description ${suffix}`, status: 'Active',
  } });
  assert.equal(skuResponse.status(), 201, JSON.stringify(await skuResponse.json()));
  const secondSkuCode = `QA-SCL-ALT-${suffix}`;
  const secondSkuResponse = await page.request.post(`${base}/api/skus`, { data: {
    sku_code: secondSkuCode, name: `QA Alternate Listing SKU ${suffix}`, status: 'Active',
  } });
  assert.equal(secondSkuResponse.status(), 201, JSON.stringify(await secondSkuResponse.json()));
  const clientResponse = await page.request.post(`${base}/api/clients`, { data: {
    client_id: clientId, client_name: `QA Listing Client ${suffix}`, client_short_name: `SCL${suffix.slice(-5)}`,
    client_currency: 'Indian Rupee', status: '1', address1: '1 Isolated Test Street', phone: '9999999999',
    email: `scl-${suffix}@example.test`, country: 'INDIA', state: 'Delhi', city: 'New Delhi', pincode: '110001',
  } });
  assert.equal(clientResponse.status(), 201, JSON.stringify(await clientResponse.json()));

  await page.goto(`${base}/app/sku-channel-listing`, { waitUntil: 'domcontentloaded' });
  await main().getByText('No SKU channel links to view.', { exact: false }).waitFor();
  await main().getByRole('button', { name: 'Add new', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Sku Channel Link' });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Channel is Mandatory.', { exact: true }).waitFor();
  await editor.locator('label').filter({ hasText: /^Channel/ }).locator('select').first().selectOption(channelCode);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('ERetail Sku is Mandatory.', { exact: true }).waitFor();
  await editor.getByLabel('SKU', { exact: true }).fill(skuCode);
  await editor.locator('label').filter({ hasText: /^Client/ }).getByRole('combobox').selectOption(clientId);
  await editor.getByLabel('SKU Description', { exact: true }).fill(`Listing description ${suffix}`);
  await editor.getByLabel('Channel SKU', { exact: true }).fill(channelSku);
  await editor.getByLabel('Channel Product Id', { exact: true }).fill(`PRODUCT-${suffix}`);
  await editor.getByLabel('Back Order Qty', { exact: true }).fill('4');
  await editor.getByLabel('Channel Price', { exact: true }).fill('125.50');
  await editor.getByLabel('Maximum SKU Qty', { exact: true }).fill('25');
  await editor.locator('label').filter({ hasText: /^Picking Instructions/ }).getByRole('combobox').selectOption('Premium Box');
  const createPromise = page.waitForResponse(response => response.url().endsWith('/api/sku-channel-links') && response.request().method() === 'POST' && response.status() === 201);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const createdResponse = await createPromise;
  const created = await createdResponse.json();
  assert.equal(created.channel_code, channelCode);
  assert.equal(created.channel_type, 'Marketplace');
  assert.equal(created.sku_code, skuCode);
  assert.equal(created.client_id, clientId);
  assert.equal(created.channel_price, 125.5);
  assert.equal(created.back_order_qty, 4);
  assert.equal(created.maximum_sku_qty, 25);
  assert.equal(created.created_by, username);
  assert.equal(created.updated_by, username);
  assert.ok(created.created_date && created.updated_date);
  assert.deepEqual(await db.collection('sku_channel_links').findOne({ id: created.id }).then(({ _id, ...row }) => row), created,
    'MongoDB readback must match the authenticated create response.');

  for (const [label, value] of [['Back Order Qty', '-1'], ['Channel Price', 'not-a-number'], ['Maximum SKU Qty', 'Infinity']]) {
    const invalid = await page.request.post(`${base}/api/sku-channel-links`, { data: {
      channel_code: channelCode, sku_code: skuCode, channel_sku_code: `BAD-${label.replaceAll(' ', '-')}-${suffix}`,
      status: 'Active', [label === 'Back Order Qty' ? 'back_order_qty' : label === 'Channel Price' ? 'channel_price' : 'maximum_sku_qty']: value,
    } });
    assert.equal(invalid.status(), 400, `${label} rejects negative and non-finite values.`);
  }
  const invalidStatus = await page.request.post(`${base}/api/sku-channel-links`, { data: {
    channel_code: channelCode, sku_code: skuCode, channel_sku_code: `BAD-STATUS-${suffix}`, status: 'Deleted',
  } });
  assert.equal(invalidStatus.status(), 400);
  const invalidChannel = await page.request.post(`${base}/api/sku-channel-links`, { data: {
    channel_code: `MISSING-${suffix}`, sku_code: skuCode, channel_sku_code: `BAD-CHANNEL-${suffix}`, status: 'Active',
  } });
  assert.equal(invalidChannel.status(), 400);
  const invalidSku = await page.request.post(`${base}/api/sku-channel-links`, { data: {
    channel_code: channelCode, sku_code: `MISSING-${suffix}`, channel_sku_code: `BAD-SKU-${suffix}`, status: 'Active',
  } });
  assert.equal(invalidSku.status(), 400);
  const invalidClient = await page.request.post(`${base}/api/sku-channel-links`, { data: {
    channel_code: channelCode, sku_code: skuCode, client_id: `MISSING-${suffix}`, channel_sku_code: `BAD-CLIENT-${suffix}`, status: 'Active',
  } });
  assert.equal(invalidClient.status(), 400);
  const duplicate = await page.request.post(`${base}/api/sku-channel-links`, { data: {
    channel_code: channelCode, sku_code: skuCode, channel_sku_code: channelSku, status: 'Active',
  } });
  assert.equal(duplicate.status(), 409);
  const staleUpdate = await page.request.put(`${base}/api/sku-channel-links`, { data: { id: Number.MAX_SAFE_INTEGER, channel_price: 1 } });
  assert.equal(staleUpdate.status(), 404);
  const rejectedUpdate = await page.request.put(`${base}/api/sku-channel-links`, { data: { id: created.id, channel_price: -1, updated_by: 'forged-user' } });
  assert.equal(rejectedUpdate.status(), 400);
  assert.equal((await db.collection('sku_channel_links').findOne({ id: created.id })).channel_price, 125.5,
    'Rejected updates leave the saved listing unchanged.');

  await main().getByRole('combobox').first().selectOption(channelCode);
  await main().getByLabel('Channel SKU', { exact: true }).fill(channelSku);
  const searchPromise = page.waitForResponse(response => response.url().endsWith('/api/sku-channel-links') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await main().getByRole('button', { name: 'Search', exact: true }).click();
  const searchResponse = await searchPromise;
  assert.equal(searchResponse.status(), 200);
  const searchResult = await searchResponse.json();
  assert.equal(searchResult.records, 1);
  assert.equal(searchResult.gridModel[0].id, created.id);
  assert.equal(await main().locator('tbody tr').filter({ hasText: channelSku }).count(), 1);

  await main().getByRole('button', { name: 'Update', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Sku Channel Link' });
  await edit.getByLabel('Channel Price', { exact: true }).fill('130.75');
  await edit.locator('label').filter({ hasText: /^Status/ }).getByRole('combobox').selectOption('InActive');
  const updatePromise = page.waitForResponse(response => response.url().endsWith('/api/sku-channel-links') && response.request().method() === 'PUT' && response.status() === 200);
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  const updated = await (await updatePromise).json();
  assert.equal(updated.id, created.id);
  assert.equal(updated.channel_price, 130.75);
  assert.equal(updated.status, 'InActive');
  assert.equal(updated.created_by, username);
  assert.equal(updated.updated_by, username);
  assert.equal((await db.collection('sku_channel_links').findOne({ id: created.id })).channel_price, 130.75);

  await main().getByRole('button', { name: 'Advance Search', exact: true }).click();
  await main().locator('label').filter({ hasText: /^Status/ }).getByRole('combobox').selectOption('InActive');
  const advancedClient = main().locator('label').filter({ hasText: /^Client/ }).getByRole('combobox');
  assert.ok((await advancedClient.locator('option').allTextContents()).some(option => option.includes(clientId)));
  await advancedClient.selectOption(clientId);
  const clientSearchPromise = page.waitForResponse(response => response.url().endsWith('/api/sku-channel-links') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await main().getByRole('button', { name: 'Search', exact: true }).click();
  assert.equal((await (await clientSearchPromise).json()).records, 1);
  await main().getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByText('Choose export format', { exact: true }).waitFor();
  await page.getByText('Choose export format', { exact: true }).locator('..').getByRole('button').click();

  await main().getByRole('button', { name: 'SKU/Channel Link Import', exact: true }).click();
  const csv = [
    'channel_code,sku_code,sku_description,channel_sku_code,channel_product_id,back_order_qty,channel_price,status,client_id',
    `${channelCode},${skuCode},"Formal, long sleeve shirt",${importChannelSku},IMPORT-PRODUCT-${suffix},2,99.95,Active,${clientId}`,
    `${channelCode},MISSING-${suffix},Rejected row,QA-IMPORT-INVALID-${suffix},INVALID-PRODUCT,0,10,Active,${clientId}`,
  ].join('\n');
  await main().locator('input[type="file"]').setInputFiles({ name: 'sku-channel-links.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await main().getByText('Formal, long sleeve shirt', { exact: true }).waitFor();
  expectedImportFailure = true;
  await main().getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Import completed: 1 successful, 1 failed.', { exact: true }).waitFor();
  expectedImportFailure = false;
  assert.equal(await main().locator('tbody tr').filter({ hasText: importChannelSku }).getByText('Success', { exact: true }).count(), 1);
  assert.equal(await main().locator('tbody tr').filter({ hasText: `MISSING-${suffix}` }).getByText('Error', { exact: true }).count(), 1);
  const imported = await db.collection('sku_channel_links').findOne({ channel_sku_code: importChannelSku });
  assert.equal(imported.sku_code, skuCode);
  assert.equal(imported.sku_description, 'Formal, long sleeve shirt', 'CSV quoted commas remain in the description field.');
  assert.equal(imported.updated_by, username);
  assert.equal(await db.collection('sku_channel_links').countDocuments({ channel_sku_code: `QA-IMPORT-INVALID-${suffix}` }), 0,
    'A rejected CSV row must not be written to MongoDB.');

  const addUnmappedFixture = async (sellerSku, linkedProductId) => {
    const counterResult = await db.collection('_counters').findOneAndUpdate(
      { _id: 'sku_channel_links' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' },
    );
    const id = (counterResult.value || counterResult).seq;
    await db.collection('sku_channel_links').insertOne({
      id, channel_code: channelCode, channel_type: 'Marketplace', client_id: clientId,
      channel_sku_code: sellerSku, seller_sku: sellerSku,
      channel_product_id: linkedProductId, product_id: linkedProductId,
      sku_code: '', eretail_sku: '', sku_name: `Unmapped listing ${suffix}`, status: 'Active',
      pricing: 88, created_date: new Date().toISOString(),
    });
    return id;
  };
  const competingFixtureId = await addUnmappedFixture(`QA-RACE-${suffix}`, `RACE-PRODUCT-${suffix}`);
  const competingLinks = await Promise.all([
    page.request.put(`${base}/api/sku-moderation`, { data: { id: competingFixtureId, linkedSkuCode: skuCode } }),
    page.request.put(`${base}/api/sku-moderation`, { data: { id: competingFixtureId, linkedSkuCode: secondSkuCode } }),
  ]);
  assert.deepEqual(competingLinks.map(response => response.status()).sort(), [200, 409],
    'Concurrent mappings must atomically allow one SKU assignment and reject the other.');
  assert.ok([skuCode, secondSkuCode].includes((await db.collection('sku_channel_links').findOne({ id: competingFixtureId })).eretail_sku));

  const fixtureId = await addUnmappedFixture(unmappedSellerSku, `UNMAPPED-PRODUCT-${suffix}`);
  await main().getByRole('button', { name: 'Unmapped SKU', exact: true }).click();
  const unmappedSearchPromise = page.waitForResponse(response => response.url().endsWith('/api/sku-moderation') && response.request().method() === 'POST');
  await main().getByRole('button', { name: 'Search', exact: true }).click();
  assert.equal((await unmappedSearchPromise).status(), 200);
  await main().getByText(unmappedSellerSku, { exact: true }).waitFor();
  const invalidMapping = await page.request.put(`${base}/api/sku-moderation`, { data: { id: fixtureId, linkedSkuCode: `MISSING-${suffix}` } });
  assert.equal(invalidMapping.status(), 400);
  await main().locator('tbody tr').filter({ hasText: unmappedSellerSku }).getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByRole('dialog', { name: 'Link Unmapped SKU' }).getByRole('combobox').selectOption(skuCode);
  const linkPromise = page.waitForResponse(response => response.url().endsWith('/api/sku-moderation') && response.request().method() === 'PUT' && response.status() === 200);
  await page.getByRole('button', { name: 'Save Link', exact: true }).click();
  const linkResponse = await (await linkPromise).json();
  assert.equal(linkResponse.row.eRetailSku, skuCode);
  await page.getByText('SKU linked successfully.', { exact: true }).waitFor();
  const linked = await db.collection('sku_channel_links').findOne({ id: fixtureId });
  assert.equal(linked.sku_code, skuCode);
  assert.equal(linked.eretail_sku, skuCode);
  assert.equal(linked.updated_by, username);
  assert.ok(linked.linked_at);
  const remap = await page.request.put(`${base}/api/sku-moderation`, { data: { id: fixtureId, linkedSkuCode: skuCode } });
  assert.equal(remap.status(), 409, 'A linked seller SKU cannot be silently reassigned through the unmapped endpoint.');
  await main().getByText('No unmapped SKUs to view.', { exact: true }).waitFor();

  assert.deepEqual(await readEvents(), eventsBefore, 'SKU channel listing and mapping metadata must not mutate Central Inventory stock.');
  assert.deepEqual(errors, [], `Unexpected browser or API errors: ${errors.join(' | ')}`);
  console.log('PASS SKU Channel Listing: signed-in generated MongoDB create/edit/search/export, client/channel/SKU references, audit actor and dates, invalid numeric/status/reference/duplicate/stale guards, quoted CSV import with accurate partial-failure results, unmapped SKU linking and remap guard, MongoDB readback, and unchanged Central Inventory events.');
} catch (error) {
  console.error('SKU Channel Listing browser state at failure:', { url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
