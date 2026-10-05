import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const testUsername = process.env.ERETAIL_TEST_USERNAME || 'picker-zone';
const testPassword = process.env.ERETAIL_TEST_PASSWORD || 'local';
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: testUsername, password: testPassword }) });
assert.equal(login.status, 200, 'The isolated administrator must authenticate before calling WMS APIs.');
const sessionCookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(sessionCookie, /^dmills_session=[a-f0-9]{64}$/);
const send = async (method, body) => {
  const response = await fetch(`${base}/api/picker-zone-preferences`, { method, headers: { 'content-type': 'application/json', cookie: sessionCookie }, body: JSON.stringify(body) });
  const json = await response.json();
  return { response, json };
};
const query = (overrides = {}) => ({ action: 'search', REQ_SEARCH_FLAG: true, rows: 20, page: 1, sidx: '', sord: 'asc', zoneCode: '', pickerId: '', zonePreference: '', status: '-1', ...overrides });

for (const size of [20, 50, 100, 200]) {
  const { response, json } = await send('POST', query({ rows: size }));
  assert.equal(response.status, 200);
  assert.equal(json.rows, size);
  assert.ok(json.gridModel.length <= size);
  assert.deepEqual(json.pickerZonePreferenceEnq, json.gridModel);
  for (const key of ['rows', 'total', 'page', 'records']) assert.ok(key in json);
}

const seedZoneCode = `SEED${Date.now()}`;
const seeded = await send('POST', { action: 'import', rows: [{ zoneCode: seedZoneCode, pickerId: 'QA-PICKER', zonePreference: 'Seed Preference', status: 'Active' }] });
assert.equal(seeded.response.status, 201);
assert.equal(seeded.json.created, 1);
const initial = await send('POST', query({ zoneCode: seedZoneCode }));
assert.ok(initial.json.gridModel.length, 'Picker Zone Preference requires a seeded row');
const seed = initial.json.gridModel[0];
const missingZone = await send('POST', { action: 'save', id: seed.id, zoneCode: '', pickerId: seed.picker_id });
assert.equal(missingZone.response.status, 400);
assert.equal(missingZone.json.error, 'Zone is mandatory.');
const missingPicker = await send('POST', { action: 'save', id: seed.id, zoneCode: seed.zone_code, pickerId: '' });
assert.equal(missingPicker.response.status, 400);
assert.equal(missingPicker.json.error, 'Picker Id is Mandatory');
const preference = `API-${Date.now()}`;
const updated = await send('POST', { action: 'save', id: seed.id, zoneCode: seed.zone_code, pickerId: seed.picker_id, zonePreference: preference, status: '1' });
assert.equal(updated.response.status, 200);
assert.equal(updated.json.jsonMessage, 'Data saved successfully.');
const filtered = await send('POST', query({ zoneCode: seed.zone_code, pickerId: seed.picker_id, zonePreference: preference, status: 'Active' }));
assert.ok(filtered.json.gridModel.some((row) => row.id === seed.id));
const importedZone = `IMP${Date.now()}`;
const imported = await send('POST', { action: 'import', rows: [{ zoneCode: importedZone, pickerId: 'UI-PICKER', zonePreference: 'Imported Preference', status: 'Inactive' }] });
assert.equal(imported.response.status, 201);
assert.equal(imported.json.created, 1);
const inactive = await send('POST', query({ zoneCode: importedZone, status: 'InActive' }));
assert.equal(inactive.json.records, 1);

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(base);
  await page.getByLabel('Login Id').fill(testUsername);
  await page.getByLabel('Password').fill(testPassword);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/wms/picker-zone-preference`);
  await page.getByRole('button', { name: 'Search', exact: true }).last().waitFor();
  for (const action of ['Search', 'Reset', 'Import']) await page.getByRole('button', { name: action, exact: true }).last().waitFor();
  for (const heading of ['Zone Code', 'Picker Id', 'Zone Preference', 'Status', 'Actions']) await page.getByRole('columnheader', { name: heading, exact: true }).waitFor();
  const preferenceGrid = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Zone Code', exact: true }) });
  await preferenceGrid.locator('thead tr').nth(1).locator('input').first().fill(importedZone);
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  await page.getByText('Imported Preference', { exact: true }).waitFor();
  await page.getByRole('button', { name: `Edit ${importedZone} UI-PICKER` }).click();
  assert.equal(await page.getByLabel('Zone Code editor').isEditable(), false);
  assert.equal(await page.getByLabel('Picker Id editor').isEditable(), false);
  await page.getByLabel('Zone Preference editor').fill('UI Updated Preference');
  await page.getByLabel('Status editor').uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Data saved successfully.', { exact: true }).waitFor();
  await page.getByText('UI Updated Preference', { exact: true }).waitFor();
  await page.getByText('Inactive', { exact: true }).waitFor();
  await page.getByRole('button', { name: `Audit ${importedZone} UI-PICKER` }).click();
  await page.getByText('Audit Details', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close modal', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).last().click();
  await preferenceGrid.locator('thead tr').nth(1).locator('input').first().waitFor();
  assert.equal(await preferenceGrid.locator('thead tr').nth(1).locator('input').first().inputValue(), '');
  for (const size of ['20', '50', '100', '200']) await page.getByLabel('Records per Page').selectOption(size);
  await page.getByRole('button', { name: 'Import', exact: true }).last().click();
  await page.waitForURL('**/app/admin/common-import?externalImportType=69');
  assert.deepEqual(errors, []);
  console.log('PASS Picker Zone Preference: live request/response model, filtering, reset, update, import, audit, pagination, validation, and clean browser state.');
} finally {
  await browser.close();
}
