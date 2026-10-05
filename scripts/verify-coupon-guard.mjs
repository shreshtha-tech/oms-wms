import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || '';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
assert.ok(username && password, 'Generated administrator login required.');
assert.ok(/^codexqa_[a-z0-9_]+$/i.test(dbName), 'Generated database required.');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname));
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(mongoUri).hostname));

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const anonymous = await browser.newContext();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const path = `${base}/api/coupons`;
  assert.equal((await anonymous.request.get(path)).status(), 401);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const legacyId = 940000000 + Math.floor(Math.random() * 40000000);
  const legacy = { id: legacyId, coupon_key: `QA-KEY-${suffix}`, coupon_code: `QA-CODE-${suffix}`, description: 'Legacy coupon metadata', coupon_type: 'Line', status: 'Confirmed', start_date: '2026-09-01', active_date: '2026-09-05', created_by: 'historical-user' };
  await db.collection('coupons_master').insertOne({ ...legacy });
  for (const [method, body] of [
    ['post', { coupon_key: `NEW-${suffix}`, coupon_code: `NEW-CODE-${suffix}`, status: 'Active', created_by: 'forged' }],
    ['put', { id: legacyId, status: 'Active', created_by: 'forged' }],
    ['delete', { id: legacyId }],
  ]) {
    const response = await page.request[method](path, { data: body });
    assert.equal(response.status(), 501, `${method}: ${await response.text()}`);
  }
  assert.deepEqual(await db.collection('coupons_master').findOne({ id: legacyId }, { projection: { _id: 0 } }), legacy);
  const search = async data => {
    const response = await page.request.post(`${base}/api/fetchCouponEnquiryData`, { data: { REQ_SEARCH_FLAG: true, page: 1, rows: 20, ...data } });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  assert.equal((await search({ couponKey: legacy.coupon_key })).records, 1);
  assert.equal((await search({ fromOrderDate: '2026-09-02' })).records, 0);
  assert.equal((await search({ toOrderDate: '2026-09-01', fromActiveDate: '2026-09-05' })).records, 1);
  assert.equal((await search({ fromActiveDate: '2026-09-06' })).records, 0);
  await page.goto(`${base}/app/coupons`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Coupon records are read-only legacy metadata', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Add New unavailable' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  await page.getByText(legacy.coupon_key, { exact: true }).waitFor();
  await page.getByRole('button', { name: legacy.coupon_key }).click();
  await page.getByRole('dialog').getByText('historical-user', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS Manage Coupons guard: real login, legacy readback, date filters, disabled creation, API 501, and unchanged MongoDB record.');
} finally {
  await anonymous.close();
  await browser.close();
  await mongo.close();
}
