import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
assert.ok(username && password, 'ARS Rules verification requires a signed-in isolated administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'ARS Rules verification must use a generated codexqa MongoDB database.');

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
const activeMain = () => page.locator('[data-screen-frame]:not([aria-hidden="true"]) main').last();

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/procurement/ars/rules`, { waitUntil: 'domcontentloaded' });
  await activeMain().getByRole('button', { name: 'Add New', exact: true }).waitFor();

  const locationsResponse = await page.request.get(`${base}/api/locations`);
  assert.equal(locationsResponse.status(), 200);
  const activeLocation = (await locationsResponse.json()).rows.find((row) => !row.status || row.status.toLowerCase() === 'active');
  assert.ok(activeLocation, 'The isolated tenant must have an active ARS location.');
  const locationName = activeLocation.location_name || activeLocation.name;
  const pageSizes = (await activeMain().getByLabel('Records per Page').locator('option').allTextContents()).map((value) => value.trim());
  assert.deepEqual(pageSizes, ['20', '50', '100', '200']);
  await activeMain().getByLabel('Location').selectOption(locationName);
  await activeMain().getByLabel('Product Set').selectOption({ label: 'SKU' });
  const searchRequest = page.waitForRequest((request) => request.url().includes('/api/ars?entity=rules') && request.method() === 'POST');
  await activeMain().getByRole('button', { name: 'Search', exact: true }).click();
  const search = await searchRequest;
  const searchPayload = search.postDataJSON();
  const searchResult = await search.response().then((response) => response.json());
  assert.equal(searchPayload.entity, 'rules');
  assert.equal(searchPayload.REQ_SEARCH_FLAG, true);
  assert.equal(searchPayload.rows, 20);
  assert.equal(searchPayload.page, 1);
  assert.equal(searchPayload.location, locationName);
  assert.equal(searchPayload.productSet, 'SKU');
  assert.ok(Array.isArray(searchResult.gridModel));
  assert.ok('records' in searchResult && 'total' in searchResult);

  await activeMain().getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await activeMain().getByText('ROS Settings', { exact: true }).count(), 0, 'No unverified ROS Settings action is shown.');
  await activeMain().getByRole('button', { name: 'Add New', exact: true }).click();
  for (const action of ['View Log', 'Save', 'Confirm', 'Add New']) assert.equal(await activeMain().getByRole('button', { name: action, exact: true }).isEnabled(), true);
  assert.equal(await activeMain().getByRole('button', { name: 'Run Now', exact: true }).count(), 0);
  await page.getByText(/ARS Run Now is unavailable/).waitFor();
  const frequencies = (await activeMain().getByLabel('Frequency').locator('option').allTextContents()).map((value) => value.trim());
  assert.deepEqual(frequencies, ['Never', 'Bimonthly', 'Monthly', 'Biweekly', 'Weekly', 'Daily']);

  await activeMain().getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Please Enter Location.', { exact: true }).waitFor();
  errors.length = 0; // The empty-form validation response is expected and checked above.
  await activeMain().getByRole('button', { name: 'Select Location' }).click();
  const locationDialog = page.locator('.fixed').filter({ hasText: 'Location Pick List' });
  await locationDialog.locator('label').filter({ hasText: `${locationName} (${activeLocation.location_code || activeLocation.code})` }).getByRole('checkbox').check();
  await locationDialog.getByRole('button', { name: 'OK', exact: true }).click();

  await activeMain().getByRole('button', { name: /Add SKU Set/ }).click();
  await activeMain().getByLabel('SKU Set Type').selectOption({ label: 'Include' });
  await activeMain().getByLabel('SKU Set Operand').selectOption({ label: 'SKU' });
  const skuValue = activeMain().getByLabel('SKU Set Value');
  assert.ok(await skuValue.locator('option').count() > 1, 'At least one persisted ARS SKU-Location link must be available to this rule.');
  await skuValue.selectOption({ index: 1 });
  const selectedSku = await skuValue.inputValue();
  await page.locator('.fixed').filter({ hasText: 'Add SKU Set' }).getByRole('button', { name: 'OK', exact: true }).click();

  await activeMain().getByLabel('Rule Description').fill('Playwright ARS Rule');
  await activeMain().getByLabel('ARS Method').selectOption({ label: 'Min-Max' });
  await activeMain().getByRole('spinbutton', { name: 'Min *', exact: true }).fill('5');
  await activeMain().getByRole('spinbutton', { name: 'Max *', exact: true }).fill('20');
  await activeMain().getByLabel('Vendor Type').selectOption({ label: 'Primary' });
  await activeMain().getByLabel('Output Type').selectOption({ label: 'Pending' });
  await activeMain().getByLabel('Status').selectOption({ label: 'Pending' });
  await activeMain().getByLabel('Start Date').fill('2026-08-26');
  await activeMain().getByLabel('Frequency').selectOption({ label: 'Monthly' });
  assert.equal(await activeMain().getByLabel('Day').isVisible(), true);
  assert.equal(await activeMain().getByLabel('Hour').isVisible(), true);
  const createWait = page.waitForResponse((response) => response.url().includes('/api/ars?entity=rules') && response.request().method() === 'POST' && response.status() === 201);
  await activeMain().getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createWait;
  const saved = await createResponse.json();
  assert.ok(saved.rule_id);
  assert.equal(saved.frequency, 1);
  assert.equal(saved.sku_sets?.[0]?.operand, 'Include');
  assert.equal(saved.sku_sets?.[0]?.type, 'SKU');
  assert.equal(saved.sku_sets?.[0]?.value, selectedSku);
  assert.equal(saved.created_by, username);
  assert.equal(saved.updated_by, username);
  assert.ok(saved.created_date && saved.updated_date);
  const persisted = await db.collection('ars_rules').findOne({ id: saved.id });
  assert.equal(persisted.rule_id, saved.rule_id);
  assert.equal(persisted.minimum_qty, 5);
  assert.equal(persisted.maximum_qty, 20);
  assert.equal(persisted.created_by, username);
  await page.getByText('ARS Rule created/updated Successfully', { exact: true }).waitFor();
  await activeMain().getByRole('button', { name: 'Audit', exact: true }).click();
  await page.getByText(username, { exact: true }).first().waitFor();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await activeMain().getByRole('button', { name: 'Search', exact: true }).waitFor();
  await activeMain().getByLabel('Location').selectOption(locationName);
  await activeMain().getByLabel('Product Set').selectOption({ label: 'SKU' });
  const table = activeMain().locator('table').filter({ hasText: 'Rule ID' }).first();
  await table.locator('thead tr').nth(1).locator('th').nth(4).locator('select').selectOption({ label: 'Monthly' });
  const monthlyWait = page.waitForRequest((request) => request.url().includes('/api/ars?entity=rules') && request.method() === 'POST' && request.postDataJSON()?.frequency === 'Monthly');
  await activeMain().getByRole('button', { name: 'Search', exact: true }).click();
  const monthlyRequest = await monthlyWait;
  const monthlyResult = await monthlyRequest.response().then((response) => response.json());
  assert.ok(monthlyResult.gridModel.some((row) => String(row.rule_id) === String(saved.rule_id)), 'Monthly frequency filter returns the saved rule.');
  await activeMain().getByRole('button', { name: String(saved.rule_id), exact: true }).click();
  assert.equal(await activeMain().getByLabel('Rule Description').inputValue(), 'Playwright ARS Rule');

  const confirmWait = page.waitForResponse((response) => response.url().endsWith('/api/ars') && response.request().method() === 'PUT' && response.status() === 200);
  await activeMain().getByRole('button', { name: 'Confirm', exact: true }).click();
  const confirmResponse = await confirmWait;
  assert.equal(confirmResponse.request().postDataJSON().action, 'confirm');
  const confirmed = await confirmResponse.json();
  assert.equal(confirmed.status, 'Active');
  assert.equal(confirmed.updated_by, username);
  const confirmedStored = await db.collection('ars_rules').findOne({ id: saved.id });
  assert.equal(confirmedStored.status, 'Active');
  assert.equal(confirmedStored.updated_by, username);

  const beforeRun = await db.collection('ars_rules').findOne({ id: saved.id });
  const runResponse = await page.request.put(`${base}/api/ars?entity=rules`, { data: { entity: 'rules', id: saved.id, action: 'run', requestId: `qa-ars-run-${saved.id}` } });
  assert.equal(runResponse.status(), 501);
  assert.equal((await db.collection('ars_rules').findOne({ id: saved.id })).updated_date, beforeRun.updated_date);
  assert.equal((await db.collection('ars_execution_logs').countDocuments({ rule_id: String(saved.rule_id) })), 0, 'Blocked Run Now creates no false execution log.');
  assert.deepEqual(errors, []);
  console.log('PASS ARS Rules: signed create/confirm, required validation, active location and SKU-set references, authenticated actor/date MongoDB readback, Monthly filter, reload/reopen, and fail-closed Run Now with no false log.');
} catch (error) {
  console.error('ARS Rules browser state at failure:', { url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
