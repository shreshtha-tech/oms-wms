import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
assert.ok(username && password, 'Manage Channels verification requires the isolated administrator login.');
assert.ok(/^codexqa_[a-z0-9_]+$/i.test(dbName), 'Manage Channels verification requires a generated codexqa MongoDB database.');
const mongoUrl = new URL(mongoUri);
assert.ok(['mongodb:', 'mongodb+srv:'].includes(mongoUrl.protocol)
  && ['localhost', '127.0.0.1', '::1'].includes(mongoUrl.hostname),
'Manage Channels verification only permits a loopback MongoDB server.');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname), 'Manage Channels verification requires a local app.');

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', (response) => { if (response.url().includes('/api/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
page.setDefaultTimeout(12000);
const main = () => page.locator('[data-screen-frame]:not([aria-hidden="true"]) main').last();
const channelCode = `QA-CHANNEL-${Date.now().toString(36).toUpperCase()}`;

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/channels`, { waitUntil: 'domcontentloaded' });
  await main().getByRole('button', { name: 'Search', exact: true }).waitFor();

  assert.deepEqual((await main().getByRole('combobox', { name: 'Records per Page' }).locator('option').allTextContents()).map((value) => value.trim()), ['20', '50', '100', '200']);
  for (const [name, hint] of [
    ['Reconcile Inv', 'No verified provider inventory readback job is connected'],
    ['Synchronize 0 Inv', 'No verified provider inventory sync job is connected'],
  ]) {
    const action = main().getByRole('button', { name, exact: true });
    assert.equal(await action.isDisabled(), true, `${name} cannot report a job that does not exist.`);
    assert.equal(await action.getAttribute('title'), hint);
  }
  await main().getByRole('status').getByText('Channel records store ERP metadata.', { exact: false }).waitFor();

  const initialChannelsResponse = await page.request.get(`${base}/api/channels`);
  assert.equal(initialChannelsResponse.status(), 200);
  assert.ok(Array.isArray(await initialChannelsResponse.json()));
  const channelCountBefore = await db.collection('channels').countDocuments();
  const missingRequired = await page.request.post(`${base}/api/channels`, { data: { channel_code: '', channel_name: '' } });
  assert.equal(missingRequired.status(), 400);
  const tooLarge = await page.request.post(`${base}/api/channels`, { data: { channel_code: 'BAD-PERCENT', channel_name: 'Bad Percentage', inventory_percentage: 101 } });
  assert.equal(tooLarge.status(), 400);
  const notNumeric = await page.request.post(`${base}/api/channels`, { data: { channel_code: 'BAD-NUMBER', channel_name: 'Bad Number', inventory_percentage: 'not-a-number' } });
  assert.equal(notNumeric.status(), 400);
  assert.equal(await db.collection('channels').countDocuments(), channelCountBefore, 'Rejected channel records are not persisted.');

  await main().getByRole('button', { name: 'Add New', exact: true }).click();
  const marketplace = page.getByRole('dialog').last();
  for (const heading of ['Select Marketplace to Integrate', 'Select Cart to Integrate', 'Select International Marketplace to Integrate']) await marketplace.getByText(heading, { exact: true }).waitFor();
  await page.getByRole('button', { name: /Custom Channel/ }).first().click();
  await page.getByText('Channel Maintenance', { exact: true }).last().waitFor();
  const editor = page.locator('[role="dialog"][aria-modal="true"]').last();
  for (const label of ['User Defined Field', 'Configure Interface', 'Channel SLA', 'Order Sync', 'Return Order Sync', 'Mark Ready To Ship At']) await editor.getByText(label, { exact: true }).waitFor();
  assert.deepEqual((await editor.locator('.lbl').filter({ hasText: /^Status$/ }).locator('..').getByRole('combobox').locator('option').allTextContents()).map((value) => value.trim()), ['Active', 'InActive']);
  const configuredSelect = editor.locator('.lbl').filter({ hasText: /^Channel Configured$/ }).locator('..').getByRole('combobox');
  assert.equal(await configuredSelect.isDisabled(), true, 'An unverified provider cannot be marked configured manually.');
  await editor.getByText('This changes only after seller access and inventory readback are verified in Seller Connections.', { exact: true }).waitFor();
  const codeInput = editor.locator('.lbl').filter({ hasText: /^Channel Code$/ }).locator('..').locator('input');
  const nameInput = editor.locator('.lbl').filter({ hasText: /^Channel Name$/ }).locator('..').locator('input');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Channel Code and Channel Name are required', { exact: true }).waitFor();
  await codeInput.fill(channelCode);
  await nameInput.fill('QA Channel Metadata');
  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/channels') && response.request().method() === 'POST' && response.status() === 201);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createResponsePromise;
  const saved = await createResponse.json();
  assert.equal(saved.channel_code, channelCode);
  assert.equal(saved.channel_name, 'QA Channel Metadata');
  assert.equal(saved.channel_configured, 'No', 'Saving ERP channel metadata does not assert live integration.');
  assert.equal(saved.created_by, username);
  assert.equal(saved.updated_by, username);
  assert.ok(saved.created_date && saved.updated_date && saved.registration_date);
  const persisted = await db.collection('channels').findOne({ id: saved.id });
  delete persisted._id;
  assert.deepEqual(persisted, saved, 'MongoDB readback matches the saved channel record.');

  const duplicate = await page.request.post(`${base}/api/channels`, { data: { channel_code: channelCode.toLowerCase(), channel_name: 'Duplicate Channel' } });
  assert.equal(duplicate.status(), 409, 'Channel code uniqueness ignores case.');
  const secondResponse = await page.request.post(`${base}/api/channels`, { data: { channel_code: `${channelCode}-SECOND`, channel_name: 'Second QA Channel', channel_configured: 'Yes' } });
  assert.equal(secondResponse.status(), 201);
  const second = await secondResponse.json();
  assert.equal(second.channel_configured, 'No', 'The channel API ignores unverified configured-state claims.');
  const duplicateUpdate = await page.request.put(`${base}/api/channels`, { data: { id: saved.id, channel_code: second.channel_code, created_by: 'forged-user' } });
  assert.equal(duplicateUpdate.status(), 409, 'An update cannot take another channel code.');
  const unverifiedConfiguredUpdate = await page.request.put(`${base}/api/channels`, { data: { id: second.id, channel_configured: 'Yes' } });
  assert.equal(unverifiedConfiguredUpdate.status(), 409, 'An API edit cannot bypass seller connection verification.');
  const stale = await page.request.put(`${base}/api/channels`, { data: { id: 900000001, channel_name: 'Stale channel' } });
  assert.equal(stale.status(), 404, 'A stale channel ID is not reported as a successful update.');
  const updatedResponse = await page.request.put(`${base}/api/channels`, { data: { id: saved.id, status: 'InActive', created_by: 'forged-user', updated_by: 'forged-user' } });
  assert.equal(updatedResponse.status(), 200);
  const updated = await updatedResponse.json();
  assert.equal(updated.status, 'InActive');
  assert.equal(updated.created_by, username);
  assert.equal(updated.updated_by, username);

  const searchForm = main().locator('div.rounded-lg.border').first();
  await searchForm.getByText('Channel Code', { exact: true }).locator('..').locator('input').fill(channelCode);
  await searchForm.getByText('Status', { exact: true }).locator('..').getByRole('combobox').selectOption('InActive');
  const searchRequestPromise = page.waitForRequest((request) => request.url().endsWith('/api/channels') && request.method() === 'POST' && request.postDataJSON()?.REQ_SEARCH_FLAG === true);
  await main().getByRole('button', { name: 'Search', exact: true }).click();
  const searchRequest = await searchRequestPromise;
  const searchPayload = searchRequest.postDataJSON();
  const searchResult = await searchRequest.response().then((response) => response.json());
  assert.equal(JSON.parse(searchPayload.vnfDataString).param4, '0');
  assert.equal(searchResult.records, 1, '`InActive` search returns the saved inactive row.');
  assert.equal(searchResult.gridModel[0].id, saved.id);
  await main().locator('table').filter({ hasText: 'Channel Code' }).getByText(channelCode, { exact: true }).waitFor();

  if (errors.length) throw new Error(`Browser/API errors: ${errors.join(' | ')}`);
  console.log('PASS Manage Channels: signed create, case-insensitive duplicate/stale guards, numeric percentage validation, actor/date and MongoDB readback, InActive search, and truthful disabled sync actions.');
} finally {
  await browser.close();
  await mongo.close();
}
