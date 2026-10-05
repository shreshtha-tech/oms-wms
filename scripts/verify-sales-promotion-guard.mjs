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
  const path = `${base}/api/generic`;
  assert.equal((await anonymous.request.get(`${path}?module=sales-promotion`)).status(), 401);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const legacyId = 950000000 + Math.floor(Math.random() * 40000000);
  const legacy = { id: legacyId, module: 'sales-promotion', code: `QA-LEGACY-${suffix}`, name: 'Legacy promotion metadata', status: 'Confirmed', promo_type: 'Mix and Match' };
  await db.collection('generic_records').insertOne({ ...legacy });
  const otherResponse = await page.request.post(path, { data: { module: 'qa-unrelated', code: `QA-${suffix}`, name: 'Unrelated metadata' } });
  assert.equal(otherResponse.status(), 201);
  const other = await otherResponse.json();
  for (const [method, body] of [
    ['post', { module: 'sales-promotion', code: `QA-NEW-${suffix}`, name: 'Unexecuted promotion', status: 'Confirmed' }],
    ['put', { id: legacyId, status: 'Active' }],
    ['put', { id: other.id, module: 'sales-promotion' }],
    ['delete', { id: legacyId }],
  ]) {
    const response = await page.request[method](path, { data: body });
    assert.equal(response.status(), 501, `${method}: ${await response.text()}`);
  }
  assert.deepEqual(await db.collection('generic_records').findOne({ id: legacyId }, { projection: { _id: 0 } }), legacy);
  assert.equal((await db.collection('generic_records').findOne({ id: other.id }))?.module, 'qa-unrelated');
  await page.goto(`${base}/app/promotions`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Sales Promotion is read-only', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Add New' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  await page.getByText(legacy.code, { exact: true }).waitFor();
  await page.getByText('View 1 - 1 of 1', { exact: true }).waitFor();
  await page.getByRole('button', { name: legacy.code }).click();
  assert.equal(await page.getByRole('button', { name: 'Save unavailable' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Confirm unavailable' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Add Tiers' }).click();
  assert.deepEqual(errors, []);
  console.log('PASS Sales Promotion guard: signed-in legacy readback, no fixture rows, disabled writes, API 501 including migration, and unchanged MongoDB records.');
} finally {
  await anonymous.close();
  await browser.close();
  await mongo.close();
}
