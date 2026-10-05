import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const testUsername = process.env.ERETAIL_TEST_USERNAME || 'wms-zone';
const testPassword = process.env.ERETAIL_TEST_PASSWORD || 'local';
const testLocation = process.env.ERETAIL_TEST_LOCATION || 'LOC-DEL';
const runSuffix = Date.now().toString().slice(-7);
const apiZoneCode = `AZ${runSuffix}`;
const uiZoneCode = `UZ${runSuffix}`;
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: testUsername, password: testPassword }) });
assert.equal(login.status, 200, 'The isolated administrator must authenticate before calling WMS APIs.');
const sessionCookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(sessionCookie, /^dmills_session=[a-f0-9]{64}$/);
const apiHeaders = { 'content-type': 'application/json', cookie: sessionCookie };
const send = async (method, body) => { const response = await fetch(`${base}/api/wms-zones`, { method, headers: apiHeaders, body: body ? JSON.stringify(body) : undefined }); const json = await response.json(); return { response, json }; };
for (const size of [20, 50, 100, 200]) {
  const { response, json } = await send('POST', { rows: size, page: 1, sidx: '', sord: 'asc', zoneCode: '', descr: '', picktoLoc: '', kittoLoc: '', qcBin: '-1', status: '1', locCode: '', zoneType: '', letDownBin: '', operationFlag: 'add', flag: '', REQ_SEARCH_FLAG: true });
  assert.equal(response.status, 200); assert.equal(json.rows, size); assert.ok(json.gridModel.length <= size); assert.deepEqual(json.zoneDTOList, json.gridModel); for (const key of ['rows', 'total', 'page', 'records']) assert.ok(key in json);
}
const invalid = await send('POST', { action: 'save', zoneCode: '', locCode: testLocation }); assert.equal(invalid.response.status, 400); assert.equal(invalid.json.error, 'Please enter the valid zone code.');
const invalidCharacters = await send('POST', { action: 'save', zoneCode: 'BAD-ZONE', locCode: testLocation }); assert.equal(invalidCharacters.response.status, 400); assert.equal(invalidCharacters.json.error, 'Please enter AlphaNumerics only');
const created = await send('POST', { action: 'save', zoneCode: apiZoneCode, descr: 'API Zone', status: true, locCode: testLocation, zoneType: 'Normal', orderTypes: ['14'] }); assert.equal(created.response.status, 201);
const duplicate = await send('POST', { action: 'save', zoneCode: apiZoneCode, descr: 'Duplicate', status: true, locCode: testLocation, zoneType: 'Normal' }); assert.equal(duplicate.response.status, 409);
const updated = await send('PUT', { action: 'save', id: created.json.row.id, zoneCode: apiZoneCode, descr: 'API Zone Updated', status: true, locCode: testLocation, zoneType: 'Normal', orderTypes: ['14', '1'] }); assert.equal(updated.response.status, 200); assert.equal(updated.json.row.descr, 'API Zone Updated');
const pickerMeta = await (await fetch(`${base}/api/wms-zones`, { headers: { cookie: sessionCookie } })).json();
assert.ok(pickerMeta.pickers.length, 'The isolated WMS Zone test must include a disposable picker fixture.');
{ const picker = pickerMeta.pickers[0].user_id; const linked = await send('PUT', { action: 'link-pickers', id: created.json.row.id, pickers: [picker] }); assert.equal(linked.response.status, 200); assert.ok(linked.json.row.linked_pickers.includes(picker)); const unlinked = await send('PUT', { action: 'unlink-pickers', id: created.json.row.id, pickers: [picker] }); assert.equal(unlinked.response.status, 200); assert.ok(!unlinked.json.row.linked_pickers.includes(picker)); }

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) }), page = await browser.newPage(), errors = [];
page.on('pageerror', (error) => errors.push(error.message)); page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(base); await page.getByLabel('Login Id').fill(testUsername); await page.getByLabel('Password').fill(testPassword); await page.getByRole('button', { name: 'Login', exact: true }).click(); await page.waitForURL('**/app/dashboard');
  const initialSearch = page.waitForRequest((request) => request.url().endsWith('/api/wms-zones') && request.method() === 'POST');
  await page.goto(`${base}/app/wms/zone`); await page.getByRole('button', { name: 'Search', exact: true }).last().waitFor();
  const initialPayload = (await initialSearch).postDataJSON(); assert.equal(initialPayload.rows, 20); assert.equal(initialPayload.page, 1); assert.equal(initialPayload.locCode, testLocation); assert.equal(initialPayload.status, '1'); assert.equal(initialPayload.REQ_SEARCH_FLAG, true);
  assert.equal(await page.getByLabel('Site Location').isDisabled(), true);
  for (const action of ['Search', 'Reset', 'Add New', 'PickerAction']) await page.getByRole('button', { name: action, exact: true }).last().waitFor();
  for (const heading of ['Zone Code','Description','Pick To Bin','Kit To Bin','Qc Bin','Status','Zone Type','Let Down Bin','Actions','Linked Pickers']) await page.getByRole('columnheader', { name: heading, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add New', exact: true }).click(); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText('Please enter the valid zone code.', { exact: true }).waitFor();
  await page.getByLabel('Zone Code editor').fill('BAD-ZONE'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText('Please enter AlphaNumerics only', { exact: true }).waitFor();
  await page.getByLabel('Zone Code editor').fill(uiZoneCode); await page.getByLabel('Zone Description').fill('UI Zone'); await page.getByLabel('Pick Order Types').selectOption(['14', '1']).catch(async () => page.getByLabel('Pick Order Types').selectOption(['Normal', 'Prepaid'])); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText('Data saved successfully.', { exact: true }).waitFor();
  await page.getByRole('button', { name: `Edit ${uiZoneCode}` }).click(); assert.equal(await page.getByLabel('Zone Code editor').isEditable(), false); await page.getByLabel('Zone Description').fill('UI Zone Updated'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText('Data saved successfully.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'PickerAction', exact: true }).click(); for (const action of ['Link Picker','Bulk Link','Export']) await page.getByRole('button', { name: action, exact: true }).waitFor(); await page.getByRole('button', { name: 'Link Picker', exact: true }).click(); await page.getByLabel('Picker Zone').selectOption({ label: uiZoneCode });
  { const picker = pickerMeta.pickers[0].user_id; await page.getByLabel(`Picker ${picker}`).check(); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText('Picker Linked with Zone Successfully.', { exact: true }).waitFor(); await page.getByRole('button', { name: 'PickerList', exact: true }).last().click(); await page.getByLabel(`Unlink ${picker}`).check(); await page.getByRole('button', { name: 'UnLink', exact: true }).click(); await page.getByText('Picker Unlinked Successfully', { exact: true }).waitFor(); }
  const zoneGrid = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Zone Code', exact: true }) });
  await zoneGrid.locator('thead tr').nth(1).locator('input').first().fill(uiZoneCode); await page.getByRole('button', { name: 'Search', exact: true }).last().click(); await page.getByText('UI Zone Updated', { exact: true }).waitFor(); const resetRequest = page.waitForRequest((request) => request.url().endsWith('/api/wms-zones') && request.method() === 'POST'); await page.getByRole('button', { name: 'Reset', exact: true }).click(); const resetPayload = (await resetRequest).postDataJSON(); assert.equal(resetPayload.zoneCode, ''); assert.equal(resetPayload.locCode, testLocation); assert.equal(resetPayload.status, '1');
  for (const size of ['20','50','100','200']) { await page.getByLabel('Records per Page').selectOption(size); }
  assert.deepEqual(errors, []); console.log('PASS WMS Zone: live-backed search/reset, CRUD persistence, dependencies, picker link/unlink using the isolated picker fixture, paging, validation, and clean browser state.');
} finally { await browser.close(); }
