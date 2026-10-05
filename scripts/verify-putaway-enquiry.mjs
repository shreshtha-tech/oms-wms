import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const testUsername = process.env.ERETAIL_TEST_USERNAME || 'putaway';
const testPassword = process.env.ERETAIL_TEST_PASSWORD || 'local';
const inboundNo = process.env.ERETAIL_TEST_INBOUND_NO;
assert.ok(inboundNo, 'The isolated browser workflow must pass a committed inbound number.');
const suffix = Date.now().toString().slice(-8);
const createdToday = new Date().toISOString().slice(0, 10);
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: testUsername, password: testPassword }),
});
assert.equal(login.status, 200, 'The isolated administrator must authenticate before calling WMS APIs.');
const sessionCookie = (login.headers.get('set-cookie') || '').split(';', 1)[0];
assert.match(sessionCookie, /^dmills_session=[a-f0-9]{64}$/);
const send = async (path, method, body) => {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json() };
};
const putaway = (method, body) => send('/api/putaway-enquiry', method, body);
const inventoryEvents = async () => {
  const result = await send('/api/inventory-sync/central/events', 'GET');
  assert.equal(result.response.status, 200);
  return result.json.map(event => event.event_key).sort();
};
const query = (overrides = {}) => ({
  action: 'search', REQ_SEARCH_FLAG: true, rows: 20, page: 1, sidx: 'putAwayId', sord: 'desc',
  putAwayNo: '', status: '-1', CreatedDate: `${createdToday} - ${createdToday}`, fromCreatedDate: createdToday, toCreatedDate: createdToday, confirmedDate: '', putAwayType: '-1',
  locationCode: '', inboundNo: '', sku: '', poNo: '', orderNo: '', fromBin: '', toBin: '', toZone: '', obCode: '', extAsn: '', fromLpn: '', toLpn: '',
  ...overrides,
});

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB;
assert.ok(mongoUri && mongoDbName, 'The verifier must use the generated isolated MongoDB database.');
const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(mongoDbName);
const sourceInbound = await db.collection('grn').findOne({ $or: [{ inbound_no: inboundNo }, { grn_no: inboundNo }] });
assert.ok(sourceInbound, 'The inbound source must exist in the generated database.');
assert.equal(sourceInbound.status, 'Confirmed');
assert.equal(sourceInbound.central_receipt_status, 'committed');
assert.ok(sourceInbound.central_receipt_event_ids?.length);
const eventsBefore = await inventoryEvents();
const sourcePutawayFields = { putaway_requested: sourceInbound.putaway_requested, putaway_count: sourceInbound.putaway_count };

const meta = await putaway('GET');
assert.equal(meta.response.status, 200);
assert.ok(meta.json.locations.some(location => location[0] === 'QA-WH'));
for (const size of [20, 50, 100, 200]) {
  const result = await putaway('POST', query({ rows: size }));
  assert.equal(result.response.status, 200);
  assert.equal(result.json.rows, size);
  assert.ok(result.json.putAwayList.length <= size);
  assert.deepEqual(result.json.putAwayList, result.json.gridModel);
}

let invalid = await putaway('POST', { action: 'create', type: '-1' });
assert.equal(invalid.response.status, 400);
invalid = await putaway('POST', { action: 'create', type: '1', inboundNo });
assert.equal(invalid.response.status, 501, 'Unsupported source types must fail closed.');
invalid = await putaway('POST', { action: 'create', type: '5', inboundNo, mode: '2' });
assert.equal(invalid.response.status, 501, 'System Suggested must not create an un-routed record.');
invalid = await putaway('POST', { action: 'create', type: '5', inboundNo, mode: '1' });
assert.equal(invalid.response.status, 201);
const created = invalid.json.row;
assert.equal(created.status, 'Open');
assert.equal(created.createdBy, testUsername);
assert.equal(created.inboundNo, inboundNo);
assert.equal(created.central_receipt_status, undefined, 'PutAway draft should reference the source rather than duplicate its receipt state.');
assert.equal(created.details.length, sourceInbound.lines.length);
assert.equal(created.details[0].qty, 3);
assert.equal(created.details[0].suggestedBin, '');
assert.equal(created.details[0].putawayQty, 0);
assert.equal(created.sourceQty, 3);
assert.equal(created.toQty, 0, 'Completed PutAway quantity must remain zero until a placement movement commits.');
invalid = await putaway('POST', { action: 'create', type: '5', inboundNo, mode: '1' });
assert.equal(invalid.response.status, 409, 'Only one non-cancelled draft may exist for an inbound.');
invalid = await putaway('POST', { action: 'save', putAwayId: created.putAwayId, remarks: `Saved draft ${suffix}`, details: [{ skuCode: 'FORGED', qty: 999, suggestedBin: 'FORGED', putawayQty: 999 }] });
assert.equal(invalid.response.status, 200);
assert.equal(invalid.json.row.remarks, `Saved draft ${suffix}`);
assert.deepEqual(invalid.json.row.details, created.details, 'Save must ignore caller-supplied bin and quantity details.');
const draft = await send(`/api/putaway-enquiry?putAwayNo=${encodeURIComponent(created.putAwayId)}`, 'GET');
assert.equal(draft.response.status, 200);
assert.deepEqual(draft.json.row.details, created.details);
assert.equal(draft.json.row.modifiedBy, testUsername);

invalid = await putaway('POST', { action: 'confirm', putAwayId: created.putAwayId, details: [{ skuCode: 'FORGED', qty: 999, suggestedBin: 'FORGED', putawayQty: 999 }] });
assert.equal(invalid.response.status, 501);
assert.match(invalid.json.error, /bin placement and Central Inventory movement/);
invalid = await putaway('POST', { action: 'export', gridDataLen: 1 });
assert.equal(invalid.response.status, 501);
invalid = await putaway('POST', { action: 'detail-export', gridDataLen: 1 });
assert.equal(invalid.response.status, 501);
const noPendingReport = await db.collection('generic_records').countDocuments({ module: 'pending-report' });
assert.equal(noPendingReport, 0, 'Unavailable report actions must not leave fake report jobs.');

let found = await putaway('POST', query({ putAwayNo: created.putAwayId, CreatedDate: '', fromCreatedDate: '', toCreatedDate: '' }));
assert.equal(found.response.status, 200);
assert.equal(found.json.records, 1);
found = await putaway('POST', query({ putAwayNo: '', CreatedDate: `${createdToday} - ${createdToday}`, fromCreatedDate: createdToday, toCreatedDate: createdToday, inboundNo }));
assert.equal(found.response.status, 200);
assert.equal(found.json.records, 1);
assert.equal(found.json.putAwayList[0].putAwayType, 'Selected Inbound RealTime');
assert.equal(found.json.putAwayList[0].sourceQty, 3);
found = await putaway('POST', query({ CreatedDate: `${createdToday} - ${createdToday}`, fromCreatedDate: createdToday, toCreatedDate: createdToday, putAwayType: '5', sku: 'QA-BROWSER-SKU' }));
assert.equal(found.response.status, 200);
assert.equal(found.json.records, 1, 'Type and SKU filters must match stored details.');
invalid = await putaway('POST', query({ orderNo: 'unsupported' }));
assert.equal(invalid.response.status, 501);

const inboundBeforeLaunch = await db.collection('grn').findOne({ id: sourceInbound.id });
const putawayRowsBeforeLaunch = await db.collection('generic_records').countDocuments({ module: 'putaway' });
const launch = await send('/api/inbound-enquiry', 'POST', { action: 'putaway', id: sourceInbound.id });
assert.equal(launch.response.status, 200);
assert.equal(launch.json.target, `/app/r/putaway-enquiry?inboundNo=${encodeURIComponent(inboundNo)}`);
assert.match(launch.json.jsonMessage, /draft setup opened/);
assert.equal(await db.collection('generic_records').countDocuments({ module: 'putaway' }), putawayRowsBeforeLaunch, 'Inbound launch must not create a hollow PutAway row.');
const inboundAfterLaunch = await db.collection('grn').findOne({ id: sourceInbound.id });
assert.deepEqual({ putaway_requested: inboundAfterLaunch.putaway_requested, putaway_count: inboundAfterLaunch.putaway_count }, sourcePutawayFields);
assert.equal(inboundBeforeLaunch.putaway_requested, sourcePutawayFields.putaway_requested);

const cancelled = await putaway('POST', { action: 'cancel', putAwayId: created.putAwayId });
assert.equal(cancelled.response.status, 200);
assert.equal(cancelled.json.row.status, 'Cancelled');
invalid = await putaway('POST', { action: 'save', putAwayId: created.putAwayId, remarks: 'Should not update a cancelled draft' });
assert.equal(invalid.response.status, 409);
assert.deepEqual(await inventoryEvents(), eventsBefore, 'Draft create/edit/cancel must not write Central Inventory events.');

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(base);
  await page.getByLabel('Login Id').fill(testUsername);
  await page.getByLabel('Password').fill(testPassword);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/r/putaway-enquiry`);
  await page.getByRole('status').getByText('PutAway records are drafts', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Download', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Detail Export', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Advance Search', exact: true }).click();
  for (const label of ['Order No.', 'To Bin', 'To Zone', 'Ob Code', 'To LPN']) assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true);
  await page.goto(`${base}/app/r/inbound-enquiry`);
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  await page.getByLabel(`Select row ${sourceInbound.id}`, { exact: true }).check();
  const uiLaunchResponse = page.waitForResponse(response => response.url().endsWith('/api/inbound-enquiry') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'PutAway', exact: true }).click();
  const uiLaunch = await uiLaunchResponse;
  assert.equal(uiLaunch.status(), 200);
  assert.equal((await uiLaunch.json()).target, `/app/r/putaway-enquiry?inboundNo=${encodeURIComponent(inboundNo)}`);
  await page.waitForURL(`**/app/r/putaway-enquiry?inboundNo=${encodeURIComponent(inboundNo)}`);
  await page.getByRole('status').getByText('Generated PutAway rows are drafts', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Inbound No.', { exact: true }).inputValue(), inboundNo);
  await page.getByLabel('Putaway Type', { exact: true }).selectOption('5');
  const suggestedMode = page.getByLabel('Putaway Mode', { exact: true }).locator('option[value="2"]');
  assert.equal(await suggestedMode.evaluate(option => option.disabled), true, `System Suggested option DOM: ${await suggestedMode.evaluate(option => option.outerHTML)}`);
  await page.getByLabel('Putaway Mode', { exact: true }).selectOption('1');
  const uiCreateResponse = page.waitForResponse(response => response.url().endsWith('/api/putaway-enquiry') && response.request().method() === 'POST' && response.status() === 201);
  await page.getByRole('button', { name: 'Generate PutAway', exact: true }).click();
  const uiCreated = (await (await uiCreateResponse).json()).row;
  await page.waitForURL(/putAwayNo=PA/);
  assert.equal(await page.getByRole('button', { name: 'Confirm', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Print', exact: true }).isDisabled(), true);
  await page.getByLabel('Remarks', { exact: true }).last().fill(`UI draft ${suffix}`);
  const saveResponse = page.waitForResponse(response => response.url().endsWith('/api/putaway-enquiry') && response.request().method() === 'POST' && response.status() === 200);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const uiSaved = await (await saveResponse).json();
  assert.equal(uiSaved.row.remarks, `UI draft ${suffix}`);
  const uiCancelResponse = page.waitForResponse(response => response.url().endsWith('/api/putaway-enquiry') && response.request().method() === 'POST' && response.status() === 200);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await (await uiCancelResponse).json()).row.status, 'Cancelled');
  assert.deepEqual(errors, []);
  assert.deepEqual(await inventoryEvents(), eventsBefore);
  console.log('PASS PutAway Enquiry: committed-inbound draft create/edit/cancel, supported search filters and paging, unsupported actions fail closed, inbound launch creates no hollow row, and confirmation/printing/export/system suggestion do not claim completion or write stock.');
} finally {
  await browser.close();
  await mongo.close();
}
