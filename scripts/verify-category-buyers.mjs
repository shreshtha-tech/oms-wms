import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { chromium } from 'playwright';

const password = 'LocalBuyerCheck123!';
const salt = randomBytes(16).toString('hex');
process.env.PORT = process.env.ERETAIL_TEST_PORT || '3024';
process.env.MONGODB_URI = '';
process.env.DMILLS_ADMIN_USER = 'buyercheck';
process.env.DMILLS_ADMIN_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const { insert } = await import('../api/mongo.js');
await import('../server.js');
const base = `http://127.0.0.1:${process.env.PORT}`;
for (let attempt = 0; attempt < 30; attempt++) {
  try { if ((await fetch(`${base}/api/auth/session`)).ok) break; }
  catch { /* server is starting */ }
  await new Promise(resolve => setTimeout(resolve, 200));
}

let browser;
let failed = false;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/login`);
  await page.getByRole('textbox', { name: 'Login Id' }).fill('buyercheck');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/procurement/category-buyers`);
  await page.getByRole('button', { name: 'Add New' }).click();
  assert.deepEqual(await page.locator('#buyerLocation option').allTextContents(), ['No location selected']);
  await page.locator('#buyerName').fill('D-Mills Buyer');
  await page.locator('#email').fill('buyer@example.com');
  await page.locator('#phone').fill('9988776655');
  await page.locator('#saveButton').click();
  await page.getByRole('button', { name: 'Close', exact: true }).first().waitFor({ state: 'hidden' });
  const request = page.request;
  const list = await request.post(`${base}/api/categoryBuyerSearch`, { data: { REQ_SEARCH_FLAG: true, rows: 20, page: 1 } });
  const saved = (await list.json()).gridModel[0];
  assert.equal(saved.locationCode, '');
  assert.equal(saved.createdBy, 'buyercheck');

  await insert('generic_records', { module: 'location', code: 'DMWH', name: 'D-Mills Warehouse' });
  const invalid = await request.post(`${base}/api/catBuyerSaveBS`, { data: { buyer_code: saved.buyerCode, buyer_name: 'D-Mills Buyer', email: 'buyer@example.com', phone: '9988776655', location: 'UNKNOWN' } });
  assert.equal(invalid.status(), 400);
  assert.match((await invalid.json()).error, /configured location/);
  await page.reload();
  await page.locator('tbody').getByRole('button', { name: String(saved.buyerCode), exact: true }).click();
  await page.getByText('Category Buyer Create/Edit').waitFor();
  await page.locator('#buyerLocation').selectOption('DMWH');
  await page.locator('#saveButton').click();
  const detail = await request.get(`${base}/api/category-buyers?buyerCode=${saved.buyerCode}`);
  const updated = await detail.json();
  assert.equal(updated.location, 'DMWH');
  assert.equal(updated.updated_by, 'buyercheck');
  console.log('PASS Category Buyers: empty configured locations, create without copied warehouse, configured location validation and edit persistence');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser?.close();
  process.exit(failed ? 1 : 0);
}
