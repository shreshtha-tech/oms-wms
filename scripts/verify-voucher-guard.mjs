import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || '';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
assert.ok(username && password, 'Voucher verification requires a generated administrator login.');
assert.ok(/^codexqa_[a-z0-9_]+$/i.test(dbName), 'Voucher verification requires a generated MongoDB database.');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname), 'Voucher verification only permits a local app.');
const mongoUrl = new URL(mongoUri);
assert.equal(mongoUrl.protocol, 'mongodb:');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(mongoUrl.hostname), 'Voucher verification only permits loopback MongoDB.');

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
  assert.equal((await anonymous.request.get(`${path}?module=vouchers`)).status(), 401);
  assert.equal((await anonymous.request.post(path, { data: { module: 'vouchers', code: 'UNAUTH' } })).status(), 401);

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const legacyCode = `QA-LEGACY-VOUCHER-${suffix}`;
  const legacyId = 900000000 + Math.floor(Math.random() * 90000000);
  const legacy = { id: legacyId, module: 'vouchers', code: legacyCode, name: 'Legacy test row', status: 'Active', voucher_value: 250, voucher_type: 'Absolute' };
  await db.collection('generic_records').insertOne({ ...legacy });
  const initialCount = await db.collection('generic_records').countDocuments({ module: 'vouchers' });

  const unrelatedResponse = await page.request.post(path, { data: { module: 'qa-unrelated', code: `QA-${suffix}`, name: 'Unrelated metadata' } });
  if (unrelatedResponse.status() !== 201) throw new Error(`Unrelated generic metadata create failed: ${unrelatedResponse.status()} ${await unrelatedResponse.text()}`);
  const unrelated = await unrelatedResponse.json();

  for (const [method, body] of [
    ['post', { module: 'vouchers', code: `QA-NEW-${suffix}`, name: 'Unissued' }],
    ['put', { id: legacyId, name: 'Mutated legacy voucher' }],
    ['put', { id: unrelated.id, module: 'vouchers', name: 'Converted voucher' }],
    ['delete', { id: legacyId }],
  ]) {
    const response = await page.request[method](path, { data: body });
    assert.equal(response.status(), 501, `${method} ${JSON.stringify(body)}: ${await response.text()}`);
  }
  assert.equal(await db.collection('generic_records').countDocuments({ module: 'vouchers' }), initialCount);
  assert.deepEqual(await db.collection('generic_records').findOne({ id: legacyId }, { projection: { _id: 0 } }), legacy);
  assert.equal((await db.collection('generic_records').findOne({ id: unrelated.id }))?.module, 'qa-unrelated');

  await page.goto(`${base}/app/m/vouchers`, { waitUntil: 'domcontentloaded' });
  try {
    await page.getByText('Legacy voucher records', { exact: true }).waitFor({ timeout: 8000 });
  } catch (cause) {
    console.error('Voucher route diagnostic:', JSON.stringify({ url: page.url(), body: (await page.locator('body').innerText()).slice(0, 1000), pageErrors }));
    throw cause;
  }
  assert.equal(await page.locator('section[aria-label="Voucher generation"] button').isDisabled(), true);
  await page.getByText('Voucher generation is unavailable', { exact: false }).waitFor();
  const row = page.locator('section[aria-label="Legacy voucher records"] tr').filter({ hasText: legacyCode });
  await row.waitFor();
  assert.match(await row.innerText(), /250/);
  await page.getByLabel('Search legacy voucher codes').fill(`NO-MATCH-${suffix}`);
  await page.getByText('No records to view', { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log('PASS Generate Vouchers guard: real session, legacy read-only row, disabled issuance, API write/migration rejection, no voucher mutation, and unrelated generic record unchanged.');
} finally {
  await anonymous.close();
  await browser.close();
  await mongo.close();
}
