import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const description = `External Apps verification ${Date.now()}`;

const invalid = await fetch(`${base}/api/external-apps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
assert.equal(invalid.status, 400);
assert.equal((await invalid.json()).error, 'Select ExtApps Type');

for (const pageSize of [20, 50, 100, 200]) {
  const response = await fetch(`${base}/api/external-apps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: pageSize, page: 1, extapptype: '-1', extid: '-1', desc: '', clientId: '0', REQ_SEARCH_FLAG: true }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  for (const key of ['rows', 'gridModel', 'page', 'total', 'records']) assert.ok(key in result);
  assert.ok(result.rows.length <= pageSize);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const savePayloads = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', (request) => { if (request.url().endsWith('/api/saveExternalAppsData')) savePayloads.push({ contentType: request.headers()['content-type'], payload: Object.fromEntries(new URLSearchParams(request.postData() || '')) }); });
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const captcha = (await page.locator('.font-mono').textContent()).trim();
  await page.getByPlaceholder('Username').fill('external-apps');
  await page.getByPlaceholder('Password').fill('local');
  await page.getByPlaceholder('Enter captcha').fill(captcha);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/m/external-apps`, { waitUntil: 'domcontentloaded' });

  for (const label of ['Search', 'Reset', 'Add New']) await page.getByRole('button', { name: label, exact: true }).waitFor();
  for (const header of ['ExtApps Sub Id', 'ExtApps Desc', 'ExtApps Type', 'Status', 'Registration Date']) await page.getByRole('columnheader', { name: header, exact: true }).waitFor();
  const initialAppNames = await page.getByLabel('ExtApps Name').locator('option').allTextContents();
  assert.equal(initialAppNames.length, 55);
  assert.deepEqual(initialAppNames.slice(0, 14), ['--- Select ---','Paytm','Mobikwik','Easy Rewards','FreeCharge','Qwikcilver','Amazon Pay','OVO Pay','FreeCharge NAPI','FreeCharge NAPI','TALLY','QuickBooksDesktop','PayU','Sales Interface']);
  await page.getByRole('button', { name: 'Add New', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Select ExtApps Type', { exact: true }).waitFor();
  await page.getByLabel('ExtApps Type').selectOption('POS');
  const appNames = await page.getByLabel('ExtApps Name').locator('option').allTextContents();
  assert.deepEqual(appNames, ['--- Select ---','Logic Erp','Wondersoft','Logic Erp (Using Logic WMS)','Wondersoft (Using Wondersoft WMS)','Zenoti','Genesys V2','ETP POS','WizApp POS','TALLY POS','Genesys V2 B2B']);
  await page.getByLabel('ExtApps Name').selectOption('20');
  await page.getByLabel('ExtApps Desc').fill(description);
  await page.getByLabel('Username').fill('local-user');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Fill all mendatory fields', { exact: true }).waitFor();
  await page.getByLabel('Password').fill('local-password');
  await page.getByLabel('URL').fill('https://local.invalid');
  await page.getByLabel('Sales/Invoice Push Status').selectOption({ label: 'Shipped' });
  await page.getByLabel('Return Push Status').selectOption({ label: 'Closed' });
  await page.getByLabel('Sales Order Prefix').fill('LOCAL');
  await page.getByLabel('RCU Membership').fill('LOCAL');
  page.once('dialog', async (dialog) => {
    assert.equal(dialog.message(), 'One ERP detail already configured. Do you want to update existing data?');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Record Saved Successfully', { exact: true }).waitFor();
  assert.match(savePayloads.at(-1).contentType, /^application\/x-www-form-urlencoded/);
  assert.equal(savePayloads.at(-1).payload.user, 'local-user');
  assert.equal(savePayloads.at(-1).payload.userpassword, 'local-password');
  assert.equal(savePayloads.at(-1).payload.extsubid, '');
  assert.ok(!('username' in savePayloads.at(-1).payload));
  assert.ok(!('password' in savePayloads.at(-1).payload));

  const persisted = await fetch(`${base}/api/external-apps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: 20, page: 1, extapptype: 'POS', extid: '20', desc: description, clientId: '0', REQ_SEARCH_FLAG: true }) }).then((response) => response.json());
  assert.equal(persisted.records, 1);
  assert.equal(persisted.rows[0].ext_app_desc, description);
  assert.equal(persisted.rows[0].config.username, 'local-user');
  const createdId = String(persisted.rows[0].id);
  const duplicate = await fetch(`${base}/api/checkTaxIntConfigured`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extappType: 'POS', extappid: '20', billToParty: '', clientId: '0', model: '', extAppSubId: '' }) }).then((response) => response.json());
  assert.equal(String(duplicate.customMap.extAppSubId), createdId);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('ExtApps Type').selectOption({ label: 'Point of Sale' });
  assert.deepEqual(await page.getByLabel('ExtApps Name').locator('option').allTextContents(), ['--- Select ---','Logic Erp','Wondersoft','Logic Erp (Using Logic WMS)','Wondersoft (Using Wondersoft WMS)','Zenoti','Genesys V2','ETP POS','WizApp POS','TALLY POS','Genesys V2 B2B']);
  await page.getByLabel('ExtApps Name').selectOption({ label: 'Logic Erp' });
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByText(description, { exact: true }).waitFor();
  await page.getByRole('table').getByRole('button', { name: createdId, exact: true }).click();
  assert.equal(await page.getByLabel('ExtApps Desc').inputValue(), description);
  assert.equal(await page.getByLabel('ExtApps Desc').isDisabled(), true);
  await page.getByLabel('Username').fill('local-user-updated');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Record Saved Successfully', { exact: true }).waitFor();
  assert.equal(savePayloads.at(-1).payload.extsubid, createdId);
  const updated = await fetch(`${base}/api/external-apps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: 20, page: 1, extapptype: 'POS', extid: '20', desc: description, clientId: '0', REQ_SEARCH_FLAG: true }) }).then((response) => response.json());
  assert.equal(updated.records, 1);
  assert.equal(String(updated.rows[0].id), createdId);
  assert.equal(updated.rows[0].config.username, 'local-user-updated');
  await page.getByRole('button', { name: 'Audit', exact: true }).click();
  await page.getByText('Created By', { exact: true }).waitFor();
  await page.getByText('super admin', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Close modal' }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByText('Data Copied Successfully.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('ExtApps Desc').isDisabled(), false);
  assert.equal(await page.getByLabel('ExtApps Desc').inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Add New', exact: true }).count(), 0);
  await page.getByLabel('ExtApps Type').selectOption('SME');
  await page.getByLabel('ExtApps Name').selectOption('43');
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await page.getByText('Kindly provide Subdomain, Client_ID & Client_Secret for establishing a connection.', { exact: true }).waitFor();
  await page.getByLabel('Subdomain *').fill('local-sfmc');
  await page.getByLabel('Client_ID *').fill('local-client');
  await page.getByLabel('Client_Secret *').fill('local-secret');
  await page.route('**/api/testSMSConnection', async (route) => {
    const payload = Object.fromEntries(new URLSearchParams(route.request().postData() || ''));
    assert.deepEqual(payload, { extAppID: '43', extAppType: 'SME', subDomain: 'local-sfmc', clientID: 'local-client', clientSecret: 'local-secret' });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonMessage: null, connected: true }) });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await page.getByText('Connection verified. Access token remains on the server and was not returned to this page.', { exact: true }).waitFor();
  for (const label of ['Subdomain *', 'Client_ID *', 'Client_Secret *']) assert.equal(await page.getByLabel(label).isDisabled(), true);
  await page.getByLabel('ExtApps Type').selectOption('TS');
  await page.getByLabel('ExtApps Name').selectOption('29');
  await page.getByLabel('Model').waitFor();
  assert.deepEqual(await page.getByLabel('Model').locator('option').evaluateAll((options) => options.map((option) => ({ text: option.textContent, value: option.value }))), [
    { text: '--- Select ---', value: '-1' },
    { text: 'EInvoicing', value: '1' },
    { text: 'EWay Bill', value: '2' },
    { text: 'EInvoicing & EWay Bill', value: '3' },
  ]);
  assert.equal(await page.getByLabel('Auto-Gen EWB (Part-A)').getAttribute('type'), 'checkbox');
  const typeValues = await page.getByLabel('ExtApps Type').locator('option').evaluateAll((options) => options.filter((option) => option.value).map((option) => option.value));
  let traversedApps = 0;
  for (const typeValue of typeValues) {
    await page.getByLabel('ExtApps Type').selectOption(typeValue);
    const appValues = await page.getByLabel('ExtApps Name').locator('option').evaluateAll((options) => options.filter((option) => option.value).map((option) => option.value));
    for (const appValue of appValues) {
      const metadataResponse = page.waitForResponse((response) => response.url().includes('/api/getRewardMasterDataForExtAppId') && response.request().postData()?.includes(`extappid=${appValue}`));
      await page.getByLabel('ExtApps Name').selectOption(appValue);
      const metadata = await (await metadataResponse).json();
      const expectedIds = [...(typeValue === 'F' ? ['billToParty'] : []), ...metadata.fields];
      if (expectedIds.length) await page.locator(`#${expectedIds.at(-1)}`).waitFor();
      const renderedIds = await page.locator('fieldset input[id], fieldset select[id], fieldset textarea[id]').evaluateAll((elements) => elements.map((element) => element.id));
      assert.deepEqual(renderedIds, expectedIds, `control sequence mismatch for External App ${appValue}`);
      traversedApps += 1;
    }
  }
  assert.equal(traversedApps, 53);
  assert.deepEqual(errors, []);
  console.log('PASS External Apps: validation, dependent options, save contract, persistence, reload, search, grid, paging API, and clean browser console.');
} finally { await browser.close(); }
