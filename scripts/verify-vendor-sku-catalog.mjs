import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const vendorCode = `QA-VSC-V-${suffix}`;
const skuCode = `QA-VSC-S-${suffix}`;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

assert.ok(username && password, 'Vendor SKU Catalog verification requires a signed-in isolated administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'Vendor SKU Catalog test must use a generated codexqa MongoDB database.');

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200);
const cookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(cookie, /^dmills_session=[a-f0-9]{64}$/);

const send = async (path, method = 'GET', body, authenticated = true) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(authenticated ? { cookie } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json;
  try { json = await response.json(); } catch { json = null; }
  return { response, json };
};

const eventsBefore = await send('/api/inventory-sync/central/events');
assert.equal(eventsBefore.response.status, 200);
assert.equal((await send('/api/vendor-sku-catalog', 'GET', undefined, false)).response.status, 401);

const vendor = await send('/api/vendors', 'POST', { vendor_code: vendorCode, vendor_name: `Vendor ${suffix}`, status: 'Confirmed' });
assert.equal(vendor.response.status, 201, JSON.stringify(vendor.json));
const sku = await send('/api/skus', 'POST', { sku_code: skuCode, name: `Catalog SKU ${suffix}`, status: 'Active' });
assert.equal(sku.response.status, 201, JSON.stringify(sku.json));

const getCatalog = await send('/api/vendor-sku-catalog');
assert.equal(getCatalog.response.status, 200);
assert.ok(getCatalog.json.vendors.some((row) => row.vendor_code === vendorCode));
assert.ok(getCatalog.json.skus.some((row) => row.sku_code === skuCode));
for (const body of [
  {},
  { vendor: `UNKNOWN-${suffix}`, sku: skuCode },
  { vendor: vendorCode, sku: `UNKNOWN-${suffix}` },
  { vendor: vendorCode, sku: skuCode, cost: '-1' },
  { vendor: vendorCode, sku: skuCode, minOrder: '10', maxOrder: '2' },
]) {
  const result = await send('/api/vendor-sku-catalog', 'POST', body);
  assert.equal(result.response.status, 400, JSON.stringify(result.json));
}

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(12_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const loadPromise = page.waitForResponse((response) => response.url().endsWith('/api/vendor-sku-catalog')
    && response.request().method() === 'GET');
  await page.goto(`${base}/app/m/vendor-sku-catalog`, { waitUntil: 'domcontentloaded' });
  assert.equal((await loadPromise).status(), 200);
  await page.getByLabel('Vendor', { exact: true }).selectOption(vendorCode);
  await page.getByLabel('SKU', { exact: true }).selectOption(skuCode);
  await page.getByLabel('Cost', { exact: true }).fill('30.5');
  await page.getByLabel('SKU MRP', { exact: true }).fill('120');
  await page.getByLabel('Margin Perc', { exact: true }).fill('25');
  await page.getByLabel('Maximum Order Qty', { exact: true }).fill('50');
  await page.getByLabel('Minimum Order Qty', { exact: true }).fill('5');
  await page.getByLabel('Lead Time (Days)', { exact: true }).fill('7');
  const createPromise = page.waitForResponse((response) => response.url().endsWith('/api/vendor-sku-catalog')
    && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createPromise;
  assert.equal(createResponse.status(), 201, await createResponse.text());
  const created = await createResponse.json();
  assert.equal(created.module, 'vendor-sku-catalog');
  assert.equal(created.code, `${vendorCode}:${skuCode}`);
  assert.deepEqual(created.extra, { vendor: vendorCode, sku: skuCode, cost: 30.5, mrp: 120, margin: 25, maxOrder: 50, minOrder: 5, leadTime: 7 });
  assert.equal(created.created_by, username);
  assert.equal(created.updated_by, username);
  assert.match(created.created_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(await db.collection('generic_records').findOne({ module: 'vendor-sku-catalog', id: created.id, code: created.code }));
  await page.getByRole('cell', { name: vendorCode, exact: true }).waitFor();
  assert.equal(await page.getByLabel('Vendor', { exact: true }).inputValue(), '');

  const duplicate = await send('/api/vendor-sku-catalog', 'POST', { vendor: vendorCode, sku: skuCode });
  assert.equal(duplicate.response.status, 409);
  await page.getByPlaceholder('Vendor or SKU', { exact: true }).fill(skuCode.toLowerCase());
  await page.getByRole('cell', { name: vendorCode, exact: true }).waitFor();
  await page.getByPlaceholder('Vendor or SKU', { exact: true }).fill(`NO-MATCH-${suffix}`);
  await page.getByRole('cell', { name: 'No records to view', exact: true }).waitFor();
  const eventsAfter = await send('/api/inventory-sync/central/events');
  assert.equal(eventsAfter.response.status, 200);
  assert.deepEqual(eventsAfter.json.map((event) => event.event_key).sort(), eventsBefore.json.map((event) => event.event_key).sort());
  assert.deepEqual(errors, []);
  console.log('PASS Vendor SKU Catalog: signed reference-backed create, active vendor/SKU options, numeric and min/max guards, duplicate protection, actor/date Mongo readback, case-insensitive search, and unchanged Central Inventory events. Update is not exposed.');
} catch (error) {
  console.error('Vendor SKU Catalog browser state at failure:', {
    url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors,
  });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
