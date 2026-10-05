import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const testUsername = process.env.ERETAIL_TEST_USERNAME || 'putaway';
const testPassword = process.env.ERETAIL_TEST_PASSWORD || 'local';
const testLocation = process.env.ERETAIL_TEST_LOCATION || 'QA-WH';
const suffix = Date.now().toString().slice(-8);
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: testUsername, password: testPassword }),
});
assert.equal(login.status, 200, 'The isolated administrator must authenticate before calling WMS APIs.');
const sessionCookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(sessionCookie, /^dmills_session=[a-f0-9]{64}$/);
const send = async (method, body = {}) => {
  const response = await fetch(`${base}/api/putaway-rules`, {
    method,
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json() };
};
const query = (overrides = {}) => ({
  action: 'search', REQ_SEARCH_FLAG: true, rows: 20, page: 1, sidx: 'id.ruleId', sord: 'asc',
  ruleId: '', ruleDesc: '', locCode: '', methodId: '-1', ruleParameter: '-1', merchHierarchy: '',
  skuCode: '', brand: '-1', vendor: '', isActive: false, zone: '-1', bin: '', ...overrides,
});
const inventoryEvents = async () => {
  const response = await fetch(`${base}/api/inventory-sync/central/events`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  return (await response.json()).map((event) => event.event_key).sort();
};

const meta = await send('GET');
assert.equal(meta.response.status, 200);
assert.ok(meta.json.locations.some((location) => location.code === testLocation));
assert.ok(meta.json.zones.some((zone) => zone.code), 'The WMS Zone test must provide generated configuration.');
const eventsBefore = await inventoryEvents();
for (const size of [20, 50, 100, 200]) {
  const result = await send('POST', query({ rows: size }));
  assert.equal(result.response.status, 200);
  assert.equal(result.json.rows, size);
  assert.ok(result.json.putAwayEnquiryDTOs.length <= size);
  assert.deepEqual(result.json.putAwayEnquiryDTOs, result.json.gridModel);
  for (const key of ['rows', 'total', 'page', 'records', 'putAwayEnquiryDTOs']) assert.ok(key in result.json);
}
let invalid = await send('POST', { action: 'save' });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'Please Enter Rule Description.');
invalid = await send('POST', { action: 'validate-step', step: { stepNo: '', invBucket: '-1', zone: '-1', fromBin: '', toBin: '' }, steps: [] });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'Please enter Step No.');
invalid = await send('POST', { action: 'validate-step', step: { stepNo: '10', invBucket: '-1', zone: '-1', fromBin: '', toBin: '' }, steps: [] });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'Please fill either Zone or Bin');
const step = { stepNo: '10', invBucket: '10', zone: '-1', fromBin: '', toBin: '', commingleItem: true, commingleLot: true, bulkThreshold: '50' };
const valid = {
  action: 'save', ruleDesc: `API PutAway ${suffix}`, locCode: testLocation, methodId: '1', uom: 'Kg', active: true,
  ruleParameter: '1', searchPriorities: ['10', '20', '30', '40', '50', '60'], noOfIteration: '1', steps: [step],
};
invalid = await send('POST', { ...valid, steps: [] });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'At least one PutAway step is required.');
const createdResponse = await send('POST', valid);
assert.equal(createdResponse.response.status, 201);
const created = createdResponse.json.row;
assert.match(created.ruleId, /^PAR\d{6}$/);
assert.equal(created.created_by, testUsername);
invalid = await send('PUT', { ...valid, id: Number.MAX_SAFE_INTEGER, ruleId: 'PAR999999' });
assert.equal(invalid.response.status, 404, 'An update for an unknown rule must not silently create another rule.');
invalid = await send('POST', { ...valid, ruleId: created.ruleId });
assert.equal(invalid.response.status, 409, 'A create request must not overwrite an existing rule by its display id.');
invalid = await send('PUT', { ...valid, id: created.id, ruleId: created.ruleId, steps: [{ ...step, zone: 'QA-NOT-CONFIGURED' }] });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'Please select a zone configured for this location.');
invalid = await send('PUT', { ...valid, id: created.id, ruleId: created.ruleId, steps: [step, { ...step, stepNo: '010' }] });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.json.error, 'step no already exists');
const updatedResponse = await send('PUT', { ...valid, id: created.id, ruleId: created.ruleId, ruleDesc: `API PutAway Updated ${suffix}` });
assert.equal(updatedResponse.response.status, 200);
const apiFound = await send('POST', query({ ruleId: created.ruleId, ruleDesc: 'Updated' }));
assert.equal(apiFound.json.records, 1);
assert.equal(apiFound.json.putAwayEnquiryDTOs[0].modified_by, testUsername);
const deleted = await send('DELETE', { id: created.id });
assert.equal(deleted.response.status, 200);
assert.deepEqual(await inventoryEvents(), eventsBefore, 'PutAway rule configuration must not write Central Inventory stock events.');

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
let uiCreated;
try {
  await page.goto(base);
  await page.getByLabel('Login Id').fill(testUsername);
  await page.getByLabel('Password').fill(testPassword);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/wms/putaway-rules`);
  await page.getByRole('status').getByText('PutAway rules are saved', { exact: false }).waitFor();
  for (const action of ['Search', 'Reset', 'Advanced Search', 'Download', 'Add New']) await page.getByRole('button', { name: action, exact: true }).last().waitFor();
  for (const heading of ['Rule Id', 'Description', 'Location', 'Putaway Method', 'Merch. Hierarchy', 'SKU Code', 'Brand', 'Vendor', 'Active']) await page.getByRole('columnheader', { name: heading, exact: true }).waitFor();
  await page.getByText('No records to view', { exact: true }).last().waitFor();
  for (const size of ['20', '50', '100', '200']) await page.getByLabel('Records per Page').selectOption(size);
  await page.getByRole('button', { name: 'Advanced Search', exact: true }).click();
  for (const label of ['Location', 'Rule Id', 'Description', 'Rule Parameter', 'Putaway Method', 'Merch. Hierarchy', 'Brand', 'SKU Code', 'Vendor', 'Active', 'Zone', 'Bin']) await page.getByLabel(label, { exact: true }).waitFor();
  await page.getByLabel('Select SKU', { exact: true }).click();
  await page.getByText('Select SKU', { exact: true }).last().waitFor();
  await page.getByRole('button', { name: 'Close modal', exact: true }).last().click();
  await page.getByLabel('Select Vendor', { exact: true }).click();
  await page.getByText('Select Vendor', { exact: true }).last().waitFor();
  await page.getByRole('button', { name: 'Close modal', exact: true }).last().click();
  await page.getByRole('button', { name: 'Close modal', exact: true }).last().click();

  await page.getByRole('button', { name: 'Add New', exact: true }).click();
  for (const label of ['Rule Id', 'Rule Desc*', 'Location*', 'PutAway Method*', 'PutAway UOM*', 'Active', 'Rule Parameter*']) await page.getByLabel(label, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText('Please Enter Rule Description.', { exact: true }).waitFor();
  const uiDescription = `UI PutAway ${suffix}`;
  await page.getByLabel('Rule Desc*', { exact: true }).fill(uiDescription);
  await page.getByLabel('Location*', { exact: true }).selectOption(testLocation);
  await page.getByLabel('PutAway Method*', { exact: true }).selectOption('1');
  await page.getByLabel('Rule Parameter*', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  for (const label of ['Step No.*', 'Good Inventory Bucket', 'Zone', 'From Bin', 'To Bin', 'Commingle SKU', 'Commingle Lot', 'Bulk Threshold Qty']) await page.getByLabel(label, { exact: true }).waitFor();
  await page.getByLabel('Step No.*', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Please enter Step No.', { exact: true }).waitFor();
  await page.getByLabel('Step No.*', { exact: true }).fill('20');
  await page.getByLabel('Good Inventory Bucket', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Step added successfully', { exact: true }).waitFor();
  await page.getByLabel('Step No.*', { exact: true }).fill('10');
  await page.getByLabel('Good Inventory Bucket', { exact: true }).selectOption('10');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('tbody tr').nth(0).getByText('10', { exact: true }).waitFor();
  await page.locator('tbody tr').nth(1).getByText('20', { exact: true }).waitFor();
  const stepRows = await page.locator('tbody tr').allInnerTexts();
  assert.ok(stepRows[0].trimStart().startsWith('10'));
  assert.ok(stepRows[1].trimStart().startsWith('20'));
  const saveResponse = page.waitForResponse((response) => response.url().endsWith('/api/putaway-rules') && response.request().method() === 'POST' && response.status() === 201);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  uiCreated = await (await saveResponse).json();
  assert.equal(uiCreated.row.ruleDesc, uiDescription);
  assert.equal(uiCreated.row.locCode, testLocation);
  assert.equal(uiCreated.row.created_by, testUsername);
  await page.getByText('Data saved successfully.', { exact: true }).waitFor();
  const uiRuleId = uiCreated.row.ruleId;
  assert.match(uiRuleId, /^PAR\d{6}$/);

  await page.goto(`${base}/app/wms/putaway-rules`);
  await page.getByRole('button', { name: 'Search', exact: true }).last().waitFor();
  await page.getByRole('button', { name: 'Advanced Search', exact: true }).click();
  const advancedSearch = page.getByRole('dialog', { name: 'Advance Search' });
  await advancedSearch.getByLabel('Rule Id', { exact: true }).fill(uiRuleId);
  await advancedSearch.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: uiRuleId, exact: true }).waitFor();
  await page.getByRole('button', { name: uiRuleId, exact: true }).click();
  await page.getByLabel('Rule Desc*', { exact: true }).fill(`${uiDescription} Edited`);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const editResponse = page.waitForResponse((response) => response.url().endsWith('/api/putaway-rules') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal((await editResponse).status(), 200);
  const uiReadback = await send('POST', query({ ruleId: uiRuleId }));
  assert.equal(uiReadback.json.records, 1);
  assert.equal(uiReadback.json.putAwayEnquiryDTOs[0].ruleDesc, `${uiDescription} Edited`);
  await page.getByRole('button', { name: 'Audit', exact: true }).click();
  const audit = page.getByRole('dialog', { name: 'Audit Details' });
  const auditText = await audit.innerText();
  assert.ok(auditText.includes(`Created By: ${testUsername}`));
  assert.ok(auditText.includes(`Modified By: ${testUsername}`));
  await page.getByRole('button', { name: 'Close modal', exact: true }).click();
  await page.goto(`${base}/app/wms/putaway-rules`);
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  await page.getByRole('button', { name: uiRuleId, exact: true }).waitFor();
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadWait;
  assert.equal(download.suggestedFilename(), 'putaway-rules.csv');
  let csv = '';
  for await (const chunk of await download.createReadStream()) csv += chunk.toString();
  assert.ok(csv.includes(`${uiDescription} Edited`));
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByText('No records to view', { exact: true }).last().waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(await inventoryEvents(), eventsBefore);
  const uiDeleted = await send('DELETE', { id: uiCreated.row.id });
  assert.equal(uiDeleted.response.status, 200);
  console.log('PASS Manage PutAway Rule: authenticated API/UI validation, location/zone dependency checks, create/edit/readback/delete, ordered steps, audit actor, advanced filters/pickers, paging, CSV content, and no Central Inventory event changes. Rules remain configuration metadata; no PutAway executor consumes them.');
} finally {
  await browser.close();
}
