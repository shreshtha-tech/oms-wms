import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const groupName = `QA Customer Group ${suffix}`;
const updatedGroupName = `${groupName} Updated`;

assert.ok(username && password, 'Customer Group verification requires an isolated administrator.');
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200, 'The isolated administrator must authenticate before calling Customer APIs.');
const cookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(cookie, /^dmills_session=[a-f0-9]{64}$/);

const send = async (path, method = 'GET', body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json;
  try { json = await response.json(); } catch { json = null; }
  return { response, json };
};
const centralEvents = async () => {
  const result = await send('/api/inventory-sync/central/events');
  assert.equal(result.response.status, 200);
  return result.json.map((event) => event.event_key).sort();
};
const eventsBefore = await centralEvents();

let invalid = await send('/api/customer-groups', 'POST', { name: '  ' });
assert.equal(invalid.response.status, 400);
invalid = await send('/api/customer-groups', 'POST', { name: `x${'x'.repeat(50)}` });
assert.equal(invalid.response.status, 400);
invalid = await send('/api/customer-groups', 'POST', { name: groupName, customer_ids: ['invalid'] });
assert.equal(invalid.response.status, 400);

const firstCustomerResponse = await send('/api/customers', 'POST', {
  customer_name: `QA Customer One ${suffix}`,
  type: '1 - B2C',
  shipping_city: 'Delhi',
  shipping_state: 'Delhi',
});
assert.equal(firstCustomerResponse.response.status, 201, JSON.stringify(firstCustomerResponse.json));
const firstCustomer = firstCustomerResponse.json;
const secondCustomerResponse = await send('/api/customers', 'POST', {
  customer_name: `QA Customer Two ${suffix}`,
  type: '2 - B2B',
  shipping_city: 'Mumbai',
  shipping_state: 'Maharashtra',
});
assert.equal(secondCustomerResponse.response.status, 201, JSON.stringify(secondCustomerResponse.json));
const secondCustomer = secondCustomerResponse.json;
const thirdCustomerResponse = await send('/api/customers', 'POST', {
  customer_name: `QA Customer Three ${suffix}`,
  type: '1 - B2C',
});
assert.equal(thirdCustomerResponse.response.status, 201, JSON.stringify(thirdCustomerResponse.json));
const thirdCustomer = thirdCustomerResponse.json;

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
assert.ok(mongoUri && dbName, 'Customer Group test must use the generated isolated MongoDB database.');
const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

try {
  await page.goto(base);
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/customer-groups`, { waitUntil: 'domcontentloaded' });
  const screen = page.locator('[data-screen-frame][aria-hidden="false"] main');
  const searches = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/jsonCustGroupSearch')) searches.push(request);
  });

  await screen.getByRole('button', { name: 'Search', exact: true }).waitFor();
  assert.equal(searches.length, 0, 'The enquiry must wait for the user to press Search.');
  await screen.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByText('No data in grid to export', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Dismiss message' }).click();

  await screen.locator('thead input').nth(1).fill(groupName);
  const searchRequest = page.waitForRequest((request) => request.url().endsWith('/api/jsonCustGroupSearch') && request.method() === 'POST');
  await screen.getByRole('button', { name: 'Search', exact: true }).click();
  const request = await searchRequest;
  const searchBody = Object.fromEntries(new URLSearchParams(request.postData() || ''));
  assert.equal(searchBody.custGroupName, groupName);
  assert.equal(searchBody.REQ_SEARCH_FLAG, 'true');
  assert.equal((await request.response()).status(), 200);
  await screen.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('thead input') === document.activeElement);
  assert.equal(searches.length, 1, 'Reset clears results and focuses the first filter without an extra API request.');

  await screen.getByRole('button', { name: 'Add New', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'CustomerGroup Create/Edit' });
  await editor.getByLabel('CustomerGroup Name').fill(groupName);
  await editor.getByRole('button', { name: 'Import', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import' });
  await importDialog.getByLabel('Customer codes').fill(`${firstCustomer.customer_code}\nQA-MISSING-${suffix}`);
  await importDialog.getByRole('button', { name: 'OK', exact: true }).click();
  const failedDialog = page.getByRole('dialog', { name: 'Failed Imports' });
  await failedDialog.waitFor();
  assert.equal(await failedDialog.getByLabel('Failed customer codes').inputValue(), `QA-MISSING-${suffix}`);
  await failedDialog.getByRole('button', { name: 'Close', exact: true }).click();
  const secondAssignment = editor.getByLabel(`Assign ${secondCustomer.customer_code}`);
  await secondAssignment.check();
  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/customer-groups') && response.request().method() === 'POST');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const createResponse = await createResponsePromise;
  assert.equal(createResponse.status(), 201, JSON.stringify(await createResponse.json()));
  const group = await createResponse.json();
  assert.equal(group.name, groupName);
  assert.equal(group.no_of_customer, 2);
  assert.equal(group.status, 'Active');

  for (const customer of [firstCustomer, secondCustomer]) {
    const persisted = await db.collection('partners').findOne({ id: customer.id });
    assert.equal(persisted.customer_group_code, group.code);
  }
  const duplicate = await send('/api/customer-groups', 'POST', { name: groupName.toLowerCase() });
  assert.equal(duplicate.response.status, 409);

  const secondGroupResponse = await send('/api/customer-groups', 'POST', { name: `QA Other Group ${suffix}` });
  assert.equal(secondGroupResponse.response.status, 201);
  const secondGroup = secondGroupResponse.json;
  const stolen = await send('/api/customer-groups', 'PUT', {
    id: secondGroup.id,
    name: secondGroup.name,
    status: 'Active',
    customer_ids: [firstCustomer.id],
  });
  assert.equal(stolen.response.status, 409);
  assert.equal((await db.collection('partners').findOne({ id: firstCustomer.id })).customer_group_code, group.code);

  await screen.getByRole('button', { name: group.code, exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: new RegExp(`CustomerGroup Create/Edit.*${group.code}`) });
  await editDialog.getByLabel('CustomerGroup Name').fill(updatedGroupName);
  await editDialog.getByLabel('Customer Group status').selectOption('Inactive');
  const editResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/customer-groups') && response.request().method() === 'PUT');
  await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
  const editResponse = await editResponsePromise;
  assert.equal(editResponse.status(), 200, JSON.stringify(await editResponse.json()));
  const edited = await editResponse.json();
  assert.equal(edited.name, updatedGroupName);
  assert.equal(edited.status, 'InActive');
  assert.equal(edited.no_of_customer, 2);

  const inactiveFilter = await send('/api/jsonCustGroupSearch', 'POST', {
    REQ_SEARCH_FLAG: true, rows: 20, page: 1, custGroupCode: '', custGroupName: updatedGroupName,
    status: '0', clientId: '0', doFetchCount: false,
  });
  assert.equal(inactiveFilter.response.status, 200);
  assert.equal(inactiveFilter.json.records, 1);
  assert.equal(inactiveFilter.json.gridModel[0].status, 'InActive');

  const inactiveAdd = await send('/api/customer-groups', 'PUT', {
    id: group.id, name: updatedGroupName, status: 'Inactive', customer_ids: [firstCustomer.id, secondCustomer.id, thirdCustomer.id],
  });
  assert.equal(inactiveAdd.response.status, 400, 'Inactive groups cannot accept an unassigned customer.');
  const deleteAssigned = await send('/api/customer-groups', 'DELETE', { id: group.id });
  assert.equal(deleteAssigned.response.status, 409);
  const refreshedGroup = await send(`/api/customer-groups?code=${encodeURIComponent(group.code)}`);
  assert.equal(refreshedGroup.response.status, 200);
  assert.equal(refreshedGroup.json[0].no_of_customer, 2);
  assert.deepEqual(await centralEvents(), eventsBefore, 'Customer Group operations must not change Central Inventory.');
  assert.deepEqual(errors, []);
  console.log('PASS Customer Group: signed create/import/member assignment, duplicate and stale-member guards, exclusive customer assignment, edit/deactivate/search, delete guard, empty export, enquiry reset, Mongo readback, and no Central Inventory changes.');
} finally {
  await browser.close();
  await mongo.close();
}
