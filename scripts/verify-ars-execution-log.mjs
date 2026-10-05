import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
const executionId = process.env.ERETAIL_TEST_EXECUTION_ID || '';
const ruleId = process.env.ERETAIL_TEST_RULE_ID || '';
assert.ok(username && password, 'ARS Execution Log verification requires a signed-in isolated administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'ARS Execution Log verification must use a generated codexqa MongoDB database.');
assert.ok(executionId && ruleId, 'ARS Execution Log verification requires the isolated legacy-log fixture identifiers.');

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', (response) => { if (response.url().includes('/api/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
page.setDefaultTimeout(12000);
const activeMain = () => page.locator('[data-screen-frame]:not([aria-hidden="true"]) main').last();

try {
  const storedBefore = await db.collection('ars_execution_logs').findOne({ execution_id: executionId });
  assert.ok(storedBefore, 'The explicitly seeded isolated historical log fixture must exist.');
  assert.equal(String(storedBefore.rule_id), ruleId);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/procurement/ars/logs`, { waitUntil: 'domcontentloaded' });
  await activeMain().getByRole('button', { name: executionId, exact: true }).waitFor();
  assert.deepEqual((await activeMain().getByLabel('Records per Page').locator('option').allTextContents()).map((value) => value.trim()), ['20', '50', '100', '200']);

  await activeMain().getByLabel('Rule ID', { exact: true }).fill(ruleId);
  await activeMain().getByLabel('Execution ID', { exact: true }).fill(executionId);
  const searchRequest = page.waitForRequest((request) => request.url().includes('/api/ars?entity=logs') && request.method() === 'POST');
  await activeMain().getByRole('button', { name: 'Search', exact: true }).click();
  const request = await searchRequest;
  const payload = request.postDataJSON();
  const result = await request.response().then((response) => response.json());
  assert.equal(payload.entity, 'logs');
  assert.equal(payload.REQ_SEARCH_FLAG, true);
  assert.equal(payload.rows, 20);
  assert.equal(payload.page, 1);
  assert.equal(payload.ruleId, ruleId);
  assert.equal(payload.arsExecId, executionId);
  assert.ok(result.gridModel.some((row) => row.arsExecId === executionId));
  const locationFilter = activeMain().getByLabel('Location');
  await locationFilter.selectOption('QA Warehouse');
  const locationSearch = page.waitForRequest((item) => item.url().includes('/api/ars?entity=logs') && item.method() === 'POST');
  await activeMain().getByRole('button', { name: 'Search', exact: true }).click();
  assert.equal((await locationSearch).postDataJSON().location, 'QA Warehouse');

  await activeMain().getByRole('button', { name: 'Rule ID Picker' }).click();
  await page.getByText('ARS Rule Pick List', { exact: true }).waitFor();
  await page.getByRole('button', { name: new RegExp(`^${ruleId} —`) }).waitFor();
  await page.getByRole('button', { name: 'Close modal' }).click();
  await activeMain().getByRole('button', { name: 'Execution ID Picker' }).click();
  await page.getByText('ARS Execution Pick List', { exact: true }).waitFor();
  await page.getByRole('button', { name: new RegExp(`^${executionId} —`) }).waitFor();
  await page.getByRole('button', { name: 'Close modal' }).click();

  await activeMain().getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await activeMain().getByLabel('Rule ID', { exact: true }).inputValue(), '');
  assert.equal(await activeMain().getByLabel('Execution ID', { exact: true }).inputValue(), '');
  const allLogs = page.waitForRequest((request) => request.url().includes('/api/ars?entity=logs') && request.method() === 'POST');
  await activeMain().getByRole('button', { name: 'Search', exact: true }).click();
  await allLogs;
  await activeMain().getByRole('button', { name: executionId, exact: true }).click();
  await activeMain().getByRole('button', { name: 'Download visible detail', exact: true }).waitFor();
  assert.equal(await activeMain().getByRole('button', { name: 'Approve All', exact: true }).count(), 0);
  assert.equal(await activeMain().getByRole('button', { name: 'Process All', exact: true }).count(), 0);
  await page.getByText(/Approval and processing are unavailable/).waitFor();
  const skuCode = storedBefore.execution_details[0].sku_code;
  await activeMain().getByText(skuCode, { exact: true }).waitFor();
  await activeMain().getByRole('button', { name: 'Pending', exact: true }).click();
  await page.getByText('ARS Execution Status', { exact: true }).waitFor();
  await activeMain().getByRole('button', { name: 'Close modal' }).click();

  await activeMain().getByRole('button', { name: 'Download visible detail', exact: true }).click();
  await page.getByText('Choose export format', { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent('download', { timeout: 8000 }).then((download) => ({ download }), (error) => ({ error }));
  const [, downloadResult] = await Promise.all([
    page.getByRole('button', { name: /Comma-separated values/ }).click(),
    downloadPromise,
  ]);
  assert.equal(Boolean(downloadResult.error), false, downloadResult.error?.message || 'CSV download did not start.');
  const download = downloadResult.download;
  assert.equal(download.suggestedFilename().startsWith(`ars-execution-${executionId}-`), true);
  assert.equal(download.suggestedFilename().endsWith('.csv'), true);
  const csv = await readFile(await download.path(), 'utf8');
  assert.match(csv, new RegExp(skuCode));
  assert.match(csv, /ARS Approved/);
  const downloadRecord = await db.collection('downloads').findOne({ module: 'ARS Execution Detail Log', exported_by: username }, { sort: { id: -1 } });
  assert.ok(downloadRecord, 'The export should be listed in the authenticated download history.');
  assert.equal(downloadRecord.row_count, 1);

  const beforeActions = await db.collection('ars_execution_logs').findOne({ execution_id: executionId });
  const approveResponse = await page.request.post(`${base}/api/ars?entity=logs`, { data: { entity: 'logs', action: 'approve-all' } });
  const processResponse = await page.request.post(`${base}/api/ars?entity=logs`, { data: { entity: 'logs', action: 'process-all' } });
  const editResponse = await page.request.put(`${base}/api/ars?entity=logs`, { data: { entity: 'logs', id: storedBefore.id, status: 'Approved' } });
  assert.deepEqual([approveResponse.status(), processResponse.status(), editResponse.status()], [501, 501, 501]);
  const afterActions = await db.collection('ars_execution_logs').findOne({ execution_id: executionId });
  assert.deepEqual(afterActions, beforeActions, 'Unavailable processing does not change stored execution history.');
  assert.deepEqual(errors.filter((error) => !error.startsWith('501 ')), []);
  console.log('PASS ARS Execution Log: signed filter/search, location and ID pickers, reset/paging, stored legacy detail and status dialog, real CSV content/history, and no-change 501 guards for approval/edit/processing. The inserted history row is an isolated read-only fixture, not a claimed ARS execution.');
} catch (error) {
  console.error('ARS Execution Log browser state at failure:', { url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
