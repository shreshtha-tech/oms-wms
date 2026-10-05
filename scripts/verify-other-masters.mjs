import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || '';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
assert.ok(username && password, 'Other Masters verification requires a generated administrator login.');
assert.ok(/^codexqa_[a-z0-9_]+$/i.test(dbName), 'Other Masters verification requires a generated MongoDB database.');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname), 'Other Masters verification only permits a local app.');
const mongoUrl = new URL(mongoUri);
assert.equal(mongoUrl.protocol, 'mongodb:');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(mongoUrl.hostname), 'Other Masters verification only permits loopback MongoDB.');

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const anonymous = await browser.newContext();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  const path = `${base}/api/generic`;
  assert.equal((await anonymous.request.get(`${path}?module=other-masters-brands`)).status(), 401);
  assert.equal((await anonymous.request.post(path, { data: { module: 'other-masters-brands', code: 'UNAUTH' } })).status(), 401);

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const legacyId = 900000000 + Math.floor(Math.random() * 90000000);
  const legacy = { id: legacyId, module: 'other-masters-brands', code: `QA-BRAND-${suffix}`, name: 'Legacy brand metadata', status: 'Active' };
  await db.collection('generic_records').insertOne({ ...legacy });
  const initialCount = await db.collection('generic_records').countDocuments({ module: legacy.module });

  const unrelatedResponse = await page.request.post(path, { data: { module: 'qa-unrelated', code: `QA-${suffix}`, name: 'Unrelated metadata' } });
  if (unrelatedResponse.status() !== 201) throw new Error(`Unrelated generic metadata create failed: ${unrelatedResponse.status()} ${await unrelatedResponse.text()}`);
  const unrelated = await unrelatedResponse.json();

  for (const [method, body] of [
    ['post', { module: 'other-masters-brands', code: `QA-NEW-${suffix}`, name: 'Unsupported brand' }],
    ['post', { module: 'other-masters-uom', code: 'EA', name: 'Unsupported UOM' }],
    ['put', { id: legacyId, name: 'Mutated legacy master' }],
    ['put', { id: unrelated.id, module: 'other-masters-brands', name: 'Converted master' }],
    ['delete', { id: legacyId }],
  ]) {
    const response = await page.request[method](path, { data: body });
    assert.equal(response.status(), 501, `${method} ${JSON.stringify(body)}: ${await response.text()}`);
  }
  assert.equal(await db.collection('generic_records').countDocuments({ module: legacy.module }), initialCount);
  assert.deepEqual(await db.collection('generic_records').findOne({ id: legacyId }, { projection: { _id: 0 } }), legacy);
  assert.equal((await db.collection('generic_records').findOne({ id: unrelated.id }))?.module, 'qa-unrelated');

  await page.goto(`${base}/app/m/other-masters`, { waitUntil: 'domcontentloaded' });
  const catalog = page.locator('section[aria-label="Other Masters catalog"]');
  await catalog.getByRole('button', { name: 'Brands', exact: true }).waitFor();
  assert.equal(await catalog.getByRole('button').count(), 24);
  await catalog.getByRole('button', { name: 'Brands', exact: true }).click();
  await page.getByRole('heading', { name: 'Brands legacy records' }).waitFor();
  const records = page.locator('section[aria-label="Legacy master records"]');
  assert.equal(await records.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
  const row = records.getByRole('row').filter({ hasText: legacy.code });
  await row.waitFor();
  assert.match(await row.innerText(), /Legacy brand metadata/);
  await records.getByRole('button', { name: 'Back to Other Masters' }).click();
  await catalog.getByRole('button', { name: 'Brands', exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log('PASS Other Masters guard: real session, 24 catalog choices, legacy read-only row, disabled save, generic write/migration rejection, and unchanged MongoDB records.');
} finally {
  await anonymous.close();
  await browser.close();
  await mongo.close();
}
