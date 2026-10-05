import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || '';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
const types = ['validation', 'routing', 'return', 'seller', 'shipping', 'allocation'];
const labels = ['Order Validation Rules', 'Order Routing/Split Rules', 'Return Routing Rules', 'Seller Panel Order Rules', 'Shipping Rules', 'Allocation Rules'];
const sections = ['All Condition', 'Any Condition', 'Action'];
assert.ok(username && password, 'OMS Rules verification requires the generated administrator login.');
assert.ok(/^codexqa_[a-z0-9_]+$/i.test(dbName), 'OMS Rules verification requires a generated codexqa MongoDB database.');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname), 'OMS Rules verification requires a local app.');
const mongoUrl = new URL(mongoUri);
assert.equal(mongoUrl.protocol, 'mongodb:');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(mongoUrl.hostname), 'OMS Rules verification only permits a loopback MongoDB server.');

const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
const locationCode = `QA-OMS-LOC-${suffix}`;
const channelCode = `QA-OMS-CH-${suffix}`;
const clientId = String(Date.now()).slice(-10);
const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
page.setDefaultTimeout(12000);
const main = () => page.locator('[data-screen-frame]:not([aria-hidden="true"]) main').last();
const loc = { location_code: locationCode, location_name: `OMS QA ${suffix}`, location_short_name: `OMS${suffix.slice(-5)}`, location_type: 'WH', status: 'Active' };
const channel = { channel_code: channelCode, channel_name: `OMS QA Channel ${suffix}`, channel_type: 'Marketplace', status: 'Active' };
const client = {
  client_id: clientId, client_name: `OMS QA Client ${suffix}`, client_short_name: `OMS${suffix.slice(-5)}`,
  client_currency: 'INR', address1: 'QA Address', phone: '9999999999', country: 'India', state: 'Karnataka',
  city: 'Bengaluru', pincode: '560001', status: 'Active',
};
const eventKeys = async () => {
  const response = await page.request.get(`${base}/api/inventory-sync/central/events`);
  assert.equal(response.status(), 200);
  return (await response.json()).map(event => event.event_key).sort();
};
const createReferences = async () => {
  const locationResponse = await page.request.post(`${base}/api/locations`, { data: loc });
  assert.equal(locationResponse.status(), 201, JSON.stringify(await locationResponse.json()));
  const channelResponse = await page.request.post(`${base}/api/channels`, { data: channel });
  assert.equal(channelResponse.status(), 201, JSON.stringify(await channelResponse.json()));
  const clientResponse = await page.request.post(`${base}/api/clients`, { data: client });
  assert.equal(clientResponse.status(), 201, JSON.stringify(await clientResponse.json()));
};
const verifyMetadata = async (type) => {
  const response = await page.request.get(`${base}/api/oms-rules?type=${type}&active=false&page=1`);
  assert.equal(response.status(), 200);
  const body = await response.json();
  assert.ok(body.locations.some(row => row.location_code === locationCode));
  assert.ok(body.channels.some(row => row.channel_code === channelCode));
  assert.ok(body.clients.some(row => row[0] === clientId));
  assert.equal(body.endpoints[type], {
    validation: 'jsonSaveOrderValidationRule', routing: 'jsonSaveOrderRoutingRule', return: 'jsonSaveReturnRoutingRule',
    seller: 'jsonSaveSellerPanelOrderRule', shipping: 'jsonSaveShippingRule', allocation: 'jsonSaveAllocRule',
  }[type]);
  return body;
};

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await createReferences();
  const eventsBefore = await eventKeys();
  const names = {};

  await page.goto(`${base}/app/m/oms-rules`, { waitUntil: 'domcontentloaded' });
  for (const label of labels) await main().getByRole('button', { name: label, exact: true }).waitFor();

  for (let index = 0; index < types.length; index++) {
    const type = types[index], label = labels[index], name = `QA OMS ${type} ${suffix}`;
    names[type] = name;
    const metadata = await verifyMetadata(type);
    const launch = main().getByRole('button', { name: label, exact: true });
    await launch.click();
    await main().getByRole('button', { name: 'Add New Rules', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Edit Rule' });
    for (const section of sections) await modal.getByText(section, { exact: true }).waitFor();

    if (type === 'validation') await modal.getByLabel('Location', { exact: true }).selectOption(locationCode);
    if (type === 'routing') {
      await modal.getByLabel('Channel Name', { exact: true }).selectOption(locationCode);
      await modal.getByLabel('Location Filter Criterion', { exact: true }).selectOption('Location Type');
      await modal.getByLabel('Location Type', { exact: true }).selectOption('WH');
    }
    if (type === 'return') await modal.getByLabel('Channel Name', { exact: true }).selectOption(channelCode);
    if (type === 'shipping') {
      await modal.getByLabel('Applicable Locations', { exact: true }).selectOption(locationCode);
      await modal.getByLabel('Client', { exact: true }).selectOption(clientId);
    }
    if (type === 'allocation') {
      await modal.getByLabel('Warehouse Name', { exact: true }).selectOption('All');
      await modal.getByLabel('Client', { exact: true }).selectOption(clientId);
      assert.equal(await modal.getByLabel('Action Operand 1').inputValue(), 'Allocation Strategy');
    }

    if (type === 'validation') {
      await modal.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByText('Rule Name is mandatory', { exact: true }).waitFor();
      const expectedValidationError = errors.findIndex(message => message.includes('Failed to load resource') && message.includes('400'));
      if (expectedValidationError >= 0) errors.splice(expectedValidationError, 1);
      await modal.getByLabel('Rule Name', { exact: true }).fill(name);
      const createPromise = page.waitForResponse(response => response.url().endsWith('/api/oms-rules') && response.request().method() === 'POST' && response.status() === 201);
      await modal.getByRole('button', { name: 'Save', exact: true }).click();
      const created = await (await createPromise).json();
      assert.equal(created.row.name, name);
      assert.equal(created.row.save_endpoint, metadata.endpoints[type]);
      assert.equal(created.row.created_by, username);
      assert.equal(created.row.updated_by, username);
      assert.ok(created.row.created_date && created.row.updated_date);
      assert.equal(await modal.count(), 0);
      const saved = await db.collection('oms_rules').findOne({ id: created.row.id });
      assert.equal(saved.name, name);
      assert.equal(saved.locations[0], locationCode);
      assert.equal(saved.created_by, username);
      assert.equal(saved.updated_by, username);
    } else {
      await modal.getByLabel('Rule Name', { exact: true }).fill(name);
      const createPromise = page.waitForResponse(response => response.url().endsWith('/api/oms-rules') && response.request().method() === 'POST' && response.status() === 201);
      await modal.getByRole('button', { name: 'Save', exact: true }).click();
      const created = await (await createPromise).json();
      assert.equal(created.row.name, name);
      assert.equal(created.row.rule_type, type);
      assert.equal(created.row.save_endpoint, metadata.endpoints[type]);
      assert.equal(created.row.created_by, username);
      assert.equal(created.row.updated_by, username);
      assert.ok(created.row.created_date && created.row.updated_date);
      const saved = await db.collection('oms_rules').findOne({ id: created.row.id });
      assert.equal(saved.name, name);
      assert.equal(saved.rule_type, type);
      assert.equal(saved.created_by, username);
      assert.equal(saved.updated_by, username);
    }

    await main().getByText(name, { exact: true }).waitFor();
    const savedRows = (await page.request.get(`${base}/api/oms-rules?type=${type}&active=false&page=1`)).json();
    assert.ok((await savedRows).rows.some(row => row.name === name));
    await main().getByRole('button', { name: 'Back', exact: true }).click();
  }

  const validationRow = main().getByRole('button', { name: labels[0], exact: true });
  await validationRow.click();
  const ruleRow = main().locator('div.grid').filter({ hasText: names.validation }).last();
  await ruleRow.getByLabel(`${names.validation} Priority`).fill('13');
  const priorityPromise = page.waitForResponse(response => response.url().endsWith('/api/oms-rules') && response.request().method() === 'PATCH');
  await ruleRow.getByRole('button', { name: 'Update', exact: true }).click();
  assert.equal((await priorityPromise).status(), 200);
  const offPromise = page.waitForResponse(response => response.url().endsWith('/api/oms-rules') && response.request().method() === 'PATCH');
  await ruleRow.getByRole('button', { name: 'On', exact: true }).click();
  assert.equal((await offPromise).status(), 200);
  let persistedValidation = await db.collection('oms_rules').findOne({ name: names.validation });
  assert.equal(persistedValidation.priority, 13);
  assert.equal(persistedValidation.status, 'Inactive');
  assert.equal(persistedValidation.created_by, username);
  assert.equal(persistedValidation.updated_by, username);
  const activeOnlySearch = page.waitForResponse(response => response.url().includes('/api/oms-rules?type=validation&active=true'));
  await main().getByLabel('Show Active Only', { exact: true }).check();
  assert.ok(!(await (await activeOnlySearch).json()).rows.some(row => row.name === names.validation));
  const showAllSearch = page.waitForResponse(response => response.url().includes('/api/oms-rules?type=validation&active=false'));
  await main().getByLabel('Show Active Only', { exact: true }).uncheck();
  await showAllSearch;
  await main().getByText(names.validation, { exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Edit Rule' });
  const editedName = `${names.validation} Edited`;
  await modal.getByLabel('Rule Name', { exact: true }).fill(editedName);
  const updatePromise = page.waitForResponse(response => response.url().endsWith('/api/oms-rules') && response.request().method() === 'PUT' && response.status() === 200);
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal((await (await updatePromise).json()).row.name, editedName);
  persistedValidation = await db.collection('oms_rules').findOne({ name: editedName });
  assert.equal(persistedValidation.created_by, username);
  assert.equal(persistedValidation.updated_by, username);
  assert.ok(persistedValidation.created_date && persistedValidation.updated_date);

  const countBeforeInvalid = await db.collection('oms_rules').countDocuments();
  const invalidPayload = { rule_type: 'validation', name: 'Invalid', status: 'Active', locations: [locationCode], event: 'Create', priority: 1, actions: [] };
  const rejected = async (body, expectedStatus = 400) => {
    const response = await page.request.post(`${base}/api/oms-rules`, { data: body });
    assert.equal(response.status(), expectedStatus, JSON.stringify(await response.json()));
    return response.json();
  };
  assert.equal((await rejected({ ...invalidPayload, rule_type: 'unknown' })).error, 'Invalid OMS rule type.');
  assert.equal((await rejected({ ...invalidPayload, name: '' })).error, 'Rule Name is mandatory');
  assert.equal((await rejected({ ...invalidPayload, status: '' })).error, 'Rule Status is mandatory');
  assert.equal((await rejected({ ...invalidPayload, status: 'Enabled' })).error, 'Status must be Active or Inactive.');
  assert.equal((await rejected({ ...invalidPayload, priority: 1.5 })).error, 'Priority must be a positive integer.');
  assert.equal((await rejected({ ...invalidPayload, locations: 'bad' })).error, 'locations must be a list.');
  const branchPayload = type => ({
    rule_type: type, name: `Invalid ${type}`, status: 'Active', priority: 1,
    locations: [locationCode], event: 'Create', priority_type: 'Location Type', location_type: 'WH',
    location_tags: [], client: clientId, warehouse: locationCode, rule_direction: 'Forward',
    actions: [{ operand: 'Allocation Strategy', value: 'Nearest Warehouse' }],
  });
  assert.equal((await rejected({ ...branchPayload('validation'), locations: [] })).error, 'Location is mandatory');
  assert.equal((await rejected({ ...branchPayload('validation'), event: '' })).error, 'Event is mandatory');
  assert.equal((await rejected({ ...branchPayload('routing'), priority_type: '' })).error, 'Location Filter Criterion is Mandatory.');
  assert.equal((await rejected({ ...branchPayload('routing'), priority_type: 'Location Type', location_type: '' })).error, 'Location Type is Mandatory.');
  assert.equal((await rejected({ ...branchPayload('routing'), priority_type: 'Location Tags', location_tags: [] })).error, 'Location Tags is Mandatory.');
  assert.equal((await rejected({ ...branchPayload('return'), locations: [] })).error, 'common.shippingrule.applicableLocations is Mandatory.');
  assert.equal((await rejected({ ...branchPayload('shipping'), locations: [] })).error, 'common.shippingrule.applicableLocations is Mandatory.');
  assert.equal((await rejected({ ...branchPayload('shipping'), client: '' })).error, 'Client is mandatory');
  assert.equal((await rejected({ ...branchPayload('shipping'), rule_direction: '' })).error, 'Rule Type is Mandatory.');
  assert.equal((await rejected({ ...branchPayload('allocation'), client: '' })).error, 'Client is mandatory');
  assert.equal((await rejected({ ...branchPayload('allocation'), warehouse: '' })).error, 'Warehouse is Mandatory.');
  assert.equal((await rejected({ ...branchPayload('allocation'), actions: [] })).error, 'No Action defined (Allocation strategy)');
  const malformedPatch = await page.request.patch(`${base}/api/oms-rules`, { data: { id: persistedValidation.id, active: 'false' } });
  assert.equal(malformedPatch.status(), 400);
  const staleUpdate = await page.request.put(`${base}/api/oms-rules`, { data: { ...invalidPayload, id: Number.MAX_SAFE_INTEGER } });
  assert.equal(staleUpdate.status(), 404);
  assert.equal(await db.collection('oms_rules').countDocuments(), countBeforeInvalid, 'Rejected writes create no rules.');
  assert.deepEqual(await eventKeys(), eventsBefore, 'OMS rule configuration must not mutate Central Inventory.');
  assert.deepEqual(errors, [], `Unexpected browser/API errors: ${errors.join(' | ')}`);
  console.log('PASS OMS Rules: authenticated six-branch metadata workflow, reference-backed configuration, create/edit/status/priority persistence and audit, exact branch API contracts, validation guards, pagination/filter reload, and unchanged Central Inventory events. Rules remain configuration metadata; order execution was not simulated.');
} catch (error) {
  console.error('OMS Rules browser state at failure:', { url: page.url(), visible: await page.locator('body').innerText().catch(() => ''), errors });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
