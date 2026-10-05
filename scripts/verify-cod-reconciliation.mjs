import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || '';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
assert.ok(username && password, 'COD Reconciliation verification requires the generated administrator login.');
assert.ok(/^codexqa_[a-z0-9_]+$/i.test(dbName), 'COD Reconciliation verification requires a generated codexqa MongoDB database.');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname), 'COD Reconciliation verification requires a local app.');
const mongoUrl = new URL(mongoUri);
assert.equal(mongoUrl.protocol, 'mongodb:');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(mongoUrl.hostname), 'COD Reconciliation verification only permits a loopback MongoDB server.');

const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
const orderNo = `QA-COD-${suffix}`;
const secondOrderNo = `QA-COD-PAID-${suffix}`;
const webOrderNo = `WEB-${suffix}`;
const secondWebOrderNo = `WEB-PAID-${suffix}`;
const trackingNo = `QA-COD-AWB-${suffix}`;
const paidTrackingNo = `QA-COD-PAID-AWB-${suffix}`;
const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const counter = await db.collection('_counters').findOneAndUpdate(
  { _id: 'sale_orders' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' },
);
const startId = (counter.value || counter).seq;
const fixtureRows = [
  { id: startId, order_no: orderNo, ext_order_no: webOrderNo, delivery_no: `DEL-${suffix}`, order_date: '2026-09-25', ship_date: '2026-09-25', tracking_no: trackingNo, transporter_name: 'Delhivery', collectable_amount: 149.5, collected_amount: 0, received_amount: 0, cash: 0, credit_card: 0, coupon: 0, payment_reconciled: false, status: 'Shipped', source: 'QA fixture' },
  { id: startId + 1, order_no: secondOrderNo, ext_order_no: secondWebOrderNo, delivery_no: `DEL-PAID-${suffix}`, order_date: '2026-09-26', ship_date: '2026-09-26', tracking_no: paidTrackingNo, transporter_name: 'Delhivery', collectable_amount: 299, collected_amount: 299, received_amount: 299, cash: 299, credit_card: 0, coupon: 0, payment_reconciled: true, status: 'Delivered', source: 'QA fixture' },
];
await db.collection('sale_orders').insertMany(fixtureRows);

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 500 && response.status() !== 501) errors.push(`${response.status()} ${response.url()}`); });
page.setDefaultTimeout(12000);
const main = () => page.locator('[data-screen-frame]:not([aria-hidden="true"]) main').last();
const request = (body) => page.request.post(`${base}/api/cod-reconciliation`, { data: body });
const search = (filters = {}) => request({ rows: 20, page: 1, sidx: '', sord: 'asc', transporterName: '1107', isReconcile: '-1', REQ_SEARCH_FLAG: true, ...filters });
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
  const metadataResponse = await page.request.get(`${base}/api/cod-reconciliation`);
  assert.equal(metadataResponse.status(), 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.transporters.length, 336);
  assert.deepEqual(metadata.pageSizes, [20, 50, 100, 200]);
  assert.deepEqual(metadata.reconciliation.map(item => item.label), ['--- Select ---', 'No', 'Yes']);

  for (const rows of [20, 50, 100, 200]) {
    const response = await request({ rows, page: 1, REQ_SEARCH_FLAG: true, transporterName: '1107', isReconcile: '-1' });
    assert.equal(response.status(), 200);
    const body = await response.json();
    assert.ok(body.rows.length <= rows);
    for (const key of ['rows', 'gridModel', 'total', 'page', 'records']) assert.ok(key in body);
  }
  const noTransporter = await request({ rows: 20, page: 1, REQ_SEARCH_FLAG: true, transporterName: '-1' });
  assert.equal(noTransporter.status(), 400);
  assert.equal((await noTransporter.json()).error, 'Please select transporter');
  const invalidTransporter = await request({ rows: 20, page: 1, REQ_SEARCH_FLAG: true, transporterName: 'not-configured' });
  assert.equal(invalidTransporter.status(), 400);
  const orderSearch = await search({ orderNo: webOrderNo, trackingNo });
  assert.equal(orderSearch.status(), 200);
  assert.equal((await orderSearch.json()).rows[0].orderNo, webOrderNo);
  const dateSearch = await search({ shipStartDate: '26/09/2026', shipEndDate: '2026-09-26' });
  assert.equal((await dateSearch.json()).rows[0].orderNo, secondWebOrderNo);
  const deliverySearch = await search({ delNo: `DEL-${suffix}` });
  assert.equal((await deliverySearch.json()).rows[0].orderNo, webOrderNo);
  const unpaidSearch = await search({ isReconcile: '0' });
  assert.deepEqual((await unpaidSearch.json()).rows.map(row => row.orderNo), [webOrderNo]);
  const paidSearch = await search({ isReconcile: '1' });
  assert.deepEqual((await paidSearch.json()).rows.map(row => row.orderNo), [secondWebOrderNo]);
  const invalidDate = await search({ shipStartDate: '2026-02-30' });
  assert.equal(invalidDate.status(), 400);
  const reversedDate = await search({ shipStartDate: '2026-09-26', shipEndDate: '2026-09-25' });
  assert.equal(reversedDate.status(), 400);

  const beforeWriteAttempts = await db.collection('sale_orders').find({ id: { $in: fixtureRows.map(row => row.id) } }).toArray();
  const emptyReconcile = await request({ action: 'reconcile', items: [] });
  assert.equal(emptyReconcile.status(), 400);
  assert.equal((await emptyReconcile.json()).error, 'Please Select Record For Process.');
  const reconcile = await request({ action: 'reconcile', items: [{ id: startId, settledamtCash: '149.50' }] });
  assert.equal(reconcile.status(), 501);
  const force = await request({ action: 'force-reconcile', items: [{ id: startId, orderNo }] });
  assert.equal(force.status(), 501);
  const importAttempt = await request({ action: 'import', cODReconciliationImport: `${trackingNo},149.50,0,0` });
  assert.equal(importAttempt.status(), 501);
  const emptyImport = await request({ action: 'import', cODReconciliationImport: '' });
  assert.equal(emptyImport.status(), 400);
  const oversizedImport = await request({ action: 'import', cODReconciliationImport: Array.from({ length: 501 }, (_, index) => `T${index},1,0,0`).join('\n') });
  assert.equal(oversizedImport.status(), 400);
  const reportCount = await db.collection('generic_records').countDocuments({ module: 'pending-report' });
  const exportAttempt = await request({ action: 'export', rows: [{ id: startId }], gridDataLen: 1, filters: { transporterName: '1107' } });
  assert.equal(exportAttempt.status(), 501);
  assert.equal(await db.collection('generic_records').countDocuments({ module: 'pending-report' }), reportCount, 'A missing export worker creates no pending report.');
  const afterWriteAttempts = await db.collection('sale_orders').find({ id: { $in: fixtureRows.map(row => row.id) } }).toArray();
  for (const before of beforeWriteAttempts) {
    const after = afterWriteAttempts.find(row => row.id === before.id);
    for (const field of ['cash', 'credit_card', 'coupon', 'collected_amount', 'received_amount', 'payment_reconciled', 'reconciliation_type', 'reconciled_at']) assert.deepEqual(after[field], before[field], `${field} must remain unchanged while settlement processing is blocked.`);
  }

  await page.goto(`${base}/app/cod-reconciliation`, { waitUntil: 'domcontentloaded' });
  for (const heading of ['Web Order No', 'Ship Date', 'Tracking No', 'Transporter', 'Collectable amount', 'Payment reconciled', 'Cash', 'Credit Card', 'Coupon', 'Received Amount', 'Status', 'Source']) await main().getByRole('columnheader', { name: heading, exact: true }).first().waitFor();
  const actionRequirements = [
    ['Reconcile', 'Requires authorized settlement evidence'],
    ['Force Reconcile', 'Force reconciliation is unavailable'],
    ['Download', 'No COD report-generation worker'],
    ['Upload tracking No', 'Settlement import is unavailable'],
  ];
  for (const [label, hint] of actionRequirements) {
    const action = main().getByRole('button', { name: label, exact: true });
    assert.equal(await action.isDisabled(), true, `${label} must not report unsupported success.`);
    assert.ok((await action.getAttribute('title')).includes(hint));
  }
  await main().getByRole('note').getByText('This screen can search stored COD rows.', { exact: false }).waitFor();
  await main().getByLabel('Transporter', { exact: true }).selectOption('1107');
  await main().getByLabel('Web Order No', { exact: true }).fill(webOrderNo);
  await main().getByLabel('Tracking No', { exact: true }).fill(trackingNo);
  await main().getByLabel('Ship Date', { exact: true }).fill('25/09/2026 - 25/09/2026');
  const searchResponse = page.waitForResponse(response => response.url().endsWith('/api/cod-reconciliation') && response.request().method() === 'POST' && response.request().postDataJSON()?.REQ_SEARCH_FLAG === true);
  await main().getByRole('button', { name: 'Search', exact: true }).click();
  assert.equal((await (await searchResponse).json()).records, 1);
  const fixtureRow = main().getByRole('row').filter({ hasText: webOrderNo });
  await fixtureRow.getByText(trackingNo, { exact: true }).waitFor();
  assert.equal(await fixtureRow.getByLabel(`Select ${webOrderNo}`).isEnabled(), true);
  await fixtureRow.getByLabel(`Select ${webOrderNo}`).check();
  await main().getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await main().getByLabel('Web Order No', { exact: true }).inputValue(), '');
  assert.deepEqual(await eventKeys(), eventsBefore, 'COD queue and blocked settlement actions must not mutate Central Inventory.');
  assert.deepEqual(errors, [], `Unexpected browser/API errors: ${errors.join(' | ')}`);
  console.log('PASS COD Reconciliation: signed legacy queue search, transporter/date/order/tracking/status filters, exact paging contract, truthful disabled controls, and no-write 501 guards for reconcile/force/import/report. MongoDB and Central Inventory readback remained unchanged.');
} catch (error) {
  console.error('COD Reconciliation browser state at failure:', { url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
