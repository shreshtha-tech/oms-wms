import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || '';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
assert.ok(username && password, 'PO Enquiry verification requires the generated administrator login.');
assert.ok(/^codexqa_[a-z0-9_]+$/i.test(dbName), 'PO Enquiry verification requires a generated codexqa MongoDB database.');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname), 'PO Enquiry verification only permits a local app.');
const mongoUrl = new URL(mongoUri);
assert.equal(mongoUrl.protocol, 'mongodb:');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(mongoUrl.hostname), 'PO Enquiry verification only permits a loopback MongoDB server.');

const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const poNo = `QA-PO-ENQ-${suffix}`;
const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const anonymous = await browser.newContext();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
page.setDefaultTimeout(12000);
const main = () => page.locator('[data-screen-frame]:not([aria-hidden="true"]) main').last();
const events = async () => {
  const response = await page.request.get(`${base}/api/inventory-sync/central/events`);
  assert.equal(response.status(), 200);
  return (await response.json()).map(event => event.event_key).sort();
};

try {
  const countBeforeAnonymousWrite = await db.collection('purchase_orders').countDocuments({ po_no: poNo });
  assert.equal((await anonymous.request.get(`${base}/api/purchase-orders`)).status(), 401, 'Purchase-order API must require a session.');
  const anonymousCreate = await anonymous.request.post(`${base}/api/purchase-orders`, { data: { po_no: poNo } });
  assert.equal(anonymousCreate.status(), 401, JSON.stringify(await anonymousCreate.json()));
  assert.equal(await db.collection('purchase_orders').countDocuments({ po_no: poNo }), countBeforeAnonymousWrite, 'Unauthenticated create must not persist a PO.');

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const eventKeysBefore = await events();

  const createdResponse = await page.request.post(`${base}/api/purchase-orders`, { data: {
    po_no: poNo, vendor: `QA Vendor ${suffix}`, vendor_code: `QA-V-${suffix}`, warehouse: `QA-WH-${suffix}`,
    source_location: `QA-SOURCE-${suffix}`, po_date: '2026-09-30', expected_date: '2026-10-07',
    items: 1, qty: 3, amount: 450, buyer_name: `QA Buyer ${suffix}`, recv_validation_code: 'Standard',
    po_type: 'Outright', po_mode: 'Manual', po_method: 'Single Location',
    line_items: [{ sku_code: `QA-SKU-${suffix}`, po_qty: 3 }], status: 'Released',
  } });
  assert.equal(createdResponse.status(), 201, JSON.stringify(await createdResponse.json()));
  let po = await createdResponse.json();
  assert.equal(po.status, 'Pending Confirmation', 'The server must own initial PO status.');
  for (const [action, expectedStatus] of [['confirm', 'Confirmed'], ['release', 'Released'], ['reopen', 'ReOpen']]) {
    const response = await page.request.put(`${base}/api/purchase-orders`, { data: { id: po.id, action } });
    assert.equal(response.status(), 200, JSON.stringify(await response.json()));
    po = await response.json();
    assert.equal(po.status, expectedStatus);
  }
  const saved = await db.collection('purchase_orders').findOne({ po_no: poNo });
  assert.equal(saved?.status, 'ReOpen');
  assert.equal(saved?.revision_no, 0);

  await page.goto(`${base}/app/procurement/po-enquiry`, { waitUntil: 'domcontentloaded' });
  await main().getByRole('button', { name: 'Search', exact: true }).waitFor();
  assert.deepEqual(await main().getByLabel('Rows per page').locator('option').allTextContents(), ['20', '50', '100', '200']);
  const status = main().getByLabel('Status', { exact: true });
  const statusLabels = await status.locator('option').allTextContents();
  assert.ok(statusLabels.includes('ReOpen'), `PO status options did not include persisted lifecycle value: ${statusLabels.join(', ')}`);
  await main().getByLabel('PO Code', { exact: true }).fill(poNo);
  await status.selectOption('ReOpen');
  await main().getByRole('button', { name: 'Search', exact: true }).click();
  const row = main().getByRole('row').filter({ hasText: poNo });
  await row.waitFor();
  assert.match(await row.innerText(), /ReOpen/);
  assert.match(await row.innerText(), /QA Vendor/);

  await status.selectOption('Confirmed');
  await main().getByRole('button', { name: 'Search', exact: true }).click();
  await main().getByText('No records to view', { exact: true }).waitFor();
  await main().getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await main().getByLabel('PO Code', { exact: true }).inputValue(), '');
  assert.deepEqual(await events(), eventKeysBefore, 'PO lifecycle changes must not adjust Central Inventory stock.');
  assert.deepEqual(errors, [], `Unexpected browser/API errors: ${errors.join(' | ')}`);
  console.log('PASS PO Enquiry: generated-admin session, anonymous read/write rejection, persisted Confirm → Release → ReOpen lifecycle, exact ReOpen filter, search/reset/paging, MongoDB readback, and no Central Inventory events.');
} finally {
  await anonymous.close();
  await browser.close();
  await mongo.close();
}
