import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const skuCode = `QA-IMPORTED-${suffix}`;
const filename = `qa-sku-import-${suffix}.csv`;
const attributeSetName = `QA SKU Import ${suffix}`;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

assert.ok(username && password, 'SKU Import verification requires an isolated administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'SKU Import test must use a generated codexqa MongoDB database.');
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
  const attributeSet = await send('/api/generic', 'POST', {
    module: 'attribute-set', code: `QA-AS-${suffix}`, name: attributeSetName,
    description: attributeSetName, status: 'Active', extra: { external_code: `QA-${suffix}` },
  });
  assert.equal(attributeSet.response.status, 201);
  const invalidHistory = await send('/api/sku-imports', 'POST', {
    import_type: 'CreateUpdate', attribute_set: attributeSetName, file_name: filename,
    success_records: 0, failed_records: 0,
  });
  assert.equal(invalidHistory.response.status, 400, 'An empty import result cannot be recorded.');

  await page.goto(base);
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/sku-import`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Import Type').waitFor();
  await page.getByLabel('Attribute Set *').selectOption({ label: attributeSetName });
  const fileInput = page.locator('input[type="file"][accept=".csv"]');
  const csv = [
    'sku_code,name,master_sku_code,category,brand,uom,mrp,cost_price,sale_price,status',
    `${skuCode},"Imported, SKU ${suffix}",QA-MASTER-${suffix},Apparel,QA brand,PCS,321,110,250,Active`,
    `${skuCode},Duplicate SKU row,QA-MASTER-${suffix},Apparel,QA brand,PCS,321,110,250,Active`,
    `QA-IMPORT-BLANK-${suffix},,QA-MASTER-${suffix},Apparel,QA brand,PCS,321,110,250,Active`,
  ].join('\n');
  await fileInput.setInputFiles({ name: filename, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const historyPromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-imports') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG !== true);
  await page.getByRole('button', { name: 'Import', exact: true }).first().click();
  const historyResponse = await historyPromise;
  assert.equal(historyResponse.status(), 201, JSON.stringify(await historyResponse.json()));
  const history = await historyResponse.json();
  assert.equal(history.status, 'Completed With Errors');
  assert.equal(history.success_records, 1);
  assert.equal(history.failed_records, 2);
  assert.equal(history.upload_by, username, 'Import actor is the authenticated user.');
  assert.equal(history.attribute_set, attributeSetName);

  const sku = await db.collection('skus').findOne({ sku_code: skuCode });
  assert.equal(sku.name, `Imported, SKU ${suffix}`, 'Quoted CSV commas are parsed as part of the SKU name.');
  assert.equal(sku.master_sku_code, `QA-MASTER-${suffix}`);
  assert.equal(sku.attribute_set, attributeSetName);
  assert.equal(sku.created_by, username);
  assert.equal(await db.collection('skus').countDocuments({ sku_code: `QA-IMPORT-BLANK-${suffix}` }), 0);
  assert.equal(await db.collection('generic_records').countDocuments({ module: 'sku-import', code: history.code }), 1);
  await page.getByText('Import completed: 1 successful, 2 failed', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const searchPromise = page.waitForResponse((response) => response.url().endsWith('/api/sku-imports') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  assert.equal((await searchPromise).status(), 200);
  const historyRow = page.locator('tbody tr').filter({ hasText: filename });
  await historyRow.getByRole('cell', { name: 'Completed With Errors', exact: true }).waitFor();

  const noCentralChanges = await send('/api/inventory-sync/central/events');
  assert.equal(noCentralChanges.response.status, 200);
  assert.deepEqual(noCentralChanges.json.map((event) => event.event_key).sort(), eventsBefore.json.map((event) => event.event_key).sort());
  assert.deepEqual(errors, []);
  console.log('PASS SKU Import: authenticated CSV upload, quoted-field parsing, successful SKU Mongo readback, duplicate/required-field row failures, accurate import history and actor, history enquiry, and no Central Inventory changes.');
} catch (error) {
  console.error('SKU Import browser state at failure:', { url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
