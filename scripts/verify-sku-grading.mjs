import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { chromium } from 'playwright';

const password = 'LocalGradingCheck123!';
const salt = randomBytes(16).toString('hex');
process.env.PORT = process.env.ERETAIL_TEST_PORT || '3022';
process.env.MONGODB_URI = '';
process.env.DMILLS_ADMIN_USER = 'gradingcheck';
process.env.DMILLS_ADMIN_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;

const { insert } = await import('../api/mongo.js');
await import('../server.js');
const base = `http://127.0.0.1:${process.env.PORT}`;
for (let attempt = 0; attempt < 30; attempt++) {
  try { if ((await fetch(`${base}/api/auth/session`)).ok) break; }
  catch { /* server still starting */ }
  await new Promise(resolve => setTimeout(resolve, 200));
}

let browser;
let failed = false;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/login`);
  await page.getByRole('textbox', { name: 'Login Id' }).fill('gradingcheck');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL('**/app/dashboard');

  const request = page.request;
  const empty = await (await request.get(`${base}/api/sku-grading`)).json();
  assert.deepEqual(empty.locations, [['-1', '--- Select ---']]);
  assert.deepEqual(empty.inbound, []);
  assert.deepEqual(empty.inventory, []);
  await page.goto(`${base}/app/r/sku-grading`);
  await page.getByText('No SKU grades to view.').waitFor();

  await insert('generic_records', { module: 'location', code: 'DMWH', name: 'D-Mills Warehouse' });
  await insert('grn', { inbound_no: 'DM-IN-1', location_code: 'DMWH' });
  await insert('inventory', { sku_code: 'DM-SKU-1', name: 'D-Mills Product', bin: 'DM-BIN', available_qty: 10 });
  const configured = await (await request.get(`${base}/api/sku-grading`)).json();
  assert.equal(configured.locations[1][0], 'DMWH');
  assert.equal(configured.inbound[0].inboundCode, 'DM-IN-1');
  assert.equal(configured.inventory[0].skuCode, 'DM-SKU-1');

  const send = async body => {
    const response = await request.post(`${base}/api/sku-grading`, { data: body });
    return { status: response.status(), body: await response.json() };
  };
  assert.equal((await send({ action: 'create-line', inboundNo: '' })).body.error, 'Please Select Inbound No');
  const valid = { action: 'create-line', inboundNo: 'DM-IN-1', locCode: 'DMWH', fromSku: 'DM-SKU-1', fromBin: 'DM-BIN', availableQty: 10, toSku: 'DM-SKU-1', toBin: 'DM-BIN', qty: 2, unitPrice: 90 };
  assert.match((await send({ ...valid, locCode: 'UNKNOWN' })).body.error, /configured location/);
  assert.match((await send({ ...valid, qty: 11 })).body.error, /available quantity/);
  const created = await send(valid);
  assert.equal(created.status, 200);
  assert.match(created.body.row.gradeId, /^SG\d{9}$/);
  const gradeId = created.body.row.gradeId;
  assert.equal((await send({ action: 'confirm', gradeId })).body.row.statusText, 'Confirmed');
  await page.goto(`${base}/app/r/sku-grading?gradeId=${gradeId}`);
  await page.getByText('DM-SKU-1').first().waitFor();
  await page.getByRole('button', { name: 'Print' }).click();
  await page.getByText('Please Select Atleast One Sku To Generate Label').waitFor();
  console.log('PASS SKU Grading: empty catalogs, configured records, validation, persistence, confirmation, and browser view');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser?.close();
  process.exit(failed ? 1 : 0);
}
