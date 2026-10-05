import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { chromium } from 'playwright';
const testDatabase=new URL(process.env.INVENTORY_DATABASE_URL||'');if(!['localhost','127.0.0.1','[::1]'].includes(testDatabase.hostname)||!/^codexqa_test_reliable_[a-f0-9]{12}$/.test(testDatabase.pathname.slice(1)))throw new Error('Use a local isolated test/contract inventory database');
const password = 'LocalReturnCheck123!';
const salt = randomBytes(16).toString('hex');
process.env.PORT = process.env.ERETAIL_TEST_PORT || '3026';
process.env.MONGODB_URI = '';
process.env.DMILLS_ADMIN_USER = 'returncheck';
process.env.DMILLS_ADMIN_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const { migrateInventory } = await import('../inventory/db.js');await migrateInventory();const { insert } = await import('../api/mongo.js');
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
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/login`);
  await page.getByRole('textbox', { name: 'Login Id' }).fill('returncheck');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL('**/app/dashboard');
  const request = page.request;
  const empty = await (await request.get(`${base}/api/return-without-order`)).json();
  assert.deepEqual(empty.reasons, []);
  const invalid = await request.post(`${base}/api/return-without-order`, { data: { action: 'customer', custCode: '999999' } });
  assert.equal(invalid.status(), 400);
  await insert('partners', { type: 'Customer', code: 'DM-CUST', name: 'D-Mills Customer', client_id: '101' });
  await insert('skus', { sku_code: 'DM-SKU', name: 'D-Mills Product', sale_price: 25 });

  await page.goto(`${base}/app/m/return-wo-order`);
  await page.getByLabel('Customer Code').fill('DM-CUST');
  await page.getByRole('button', { name: 'Find Customer' }).click();
  await page.getByLabel('New return reason').fill('Damaged packaging');
  await page.getByRole('button', { name: 'Add Reason' }).click();
  await page.getByLabel('Reason', { exact: true }).selectOption({ label: 'Damaged packaging' });
  await page.getByLabel('Scan SKU').fill('DM-SKU');
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await page.getByText('D-Mills Product').waitFor();
  const records = await request.get(`${base}/api/return-without-order`);
  assert.deepEqual((await records.json()).reasons.map(row => row[1]), ['Damaged packaging']);
  await page.getByLabel('Remarks').fill('Packaging damaged on arrival');
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('main')].some(element => element.textContent?.includes('StatusConfirmed')));
  assert.equal(await page.getByText('Inbound No', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Print' }).click();
  await page.getByText('Choose export format').waitFor();
  assert.equal(await page.getByText('Customer Return (RPT006)').count(), 0);
  console.log('PASS Return Without Order: empty reasons, configured customer/SKU/reason, persisted scan, confirmation and real PDF dialog');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser?.close();
  process.exit(failed ? 1 : 0);
}
