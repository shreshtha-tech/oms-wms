import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
const departmentCode = `QA-MH-DEP-${suffix}`;
const categoryCode = `QA-MH-CAT-${suffix}`;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

assert.ok(username && password, 'Merchandising Hierarchy verification requires an isolated signed-in administrator.');
assert.ok(mongoUri && /^codexqa_[a-z0-9_]+$/i.test(dbName || ''), 'Merchandising Hierarchy test must use a generated codexqa MongoDB database.');

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200);
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

const eventsBefore = await send('/api/inventory-sync/central/events');
assert.equal(eventsBefore.response.status, 200);

const missingFields = await send('/api/merch-hierarchy', 'POST', { code: '', name: '', description: '' });
assert.equal(missingFields.response.status, 400);
const unsupportedType = await send('/api/merch-hierarchy', 'POST', {
  code: `QA-MH-INVALID-${suffix}`, name: 'Invalid type', description: 'Invalid type guard', hierarchy_type: 'Division',
});
assert.equal(unsupportedType.response.status, 400);
const missingParent = await send('/api/merch-hierarchy', 'POST', {
  code: `QA-MH-NOPARENT-${suffix}`, name: 'Missing parent', description: 'Parent required for Category', hierarchy_type: 'Category',
});
assert.equal(missingParent.response.status, 400);
const unknownParent = await send('/api/merch-hierarchy', 'POST', {
  code: `QA-MH-ORPHAN-${suffix}`, name: 'Unknown parent', description: 'Unknown parent guard', hierarchy_type: 'Category', parent_code: `QA-NO-PARENT-${suffix}`,
});
assert.equal(unknownParent.response.status, 400);

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  const downloadEvents = [];
  page.on('download', (download) => downloadEvents.push(download.suggestedFilename()));
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.setDefaultTimeout(12_000);

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const metadataPromise = page.waitForResponse((response) => response.url().endsWith('/api/merch-hierarchy') && response.request().method() === 'GET');
  await page.goto(`${base}/app/m/merch-hierarchy`, { waitUntil: 'domcontentloaded' });
  assert.equal((await metadataPromise).status(), 200);
  for (const action of ['Save', 'Reset', 'Export', 'Audit']) await page.getByRole('button', { name: action, exact: true }).waitFor();
  const importButton = page.getByRole('button', { name: 'Import unavailable', exact: true });
  assert.equal(await importButton.isDisabled(), true, 'The screen does not offer an import processor that is not connected.');
  const main = page.getByRole('main');
  for (const tab of ['Merchandising Hierarchy', 'User Defined Fields', 'Other Settings']) await main.getByRole('button', { name: tab, exact: true }).waitFor();

  await page.getByLabel('Merchandising Code *').fill(departmentCode.toLowerCase());
  await page.getByLabel('Ext. Merchandising Code').fill(`EXT-${suffix}`);
  await page.getByLabel('Merchandising Name *').fill(`Department, ${suffix}`);
  await page.getByLabel('Merchandising Desc *').fill(`Isolated hierarchy root ${suffix}`);
  await page.getByLabel('Outbound Packaging Type').selectOption('Small Box');
  await page.getByLabel('Inbound Packaging Type').selectOption('Normal');
  await page.getByRole('button', { name: 'User Defined Fields', exact: true }).click();
  await page.getByLabel('UDF 1', { exact: true }).fill(`Custom ${suffix}`);
  await page.getByRole('button', { name: 'Other Settings', exact: true }).click();
  await page.getByLabel('Default Lottable', { exact: true }).fill(`LOT-${suffix}`);
  await page.getByLabel('Is Default', { exact: true }).selectOption('Yes');
  await page.getByLabel('Return Window', { exact: true }).fill('30');
  await page.getByLabel('Non Returnable Category', { exact: true }).check();
  await page.getByRole('main').getByRole('button', { name: 'Merchandising Hierarchy', exact: true }).click();

  const createDepartmentPromise = page.waitForResponse((response) => response.url().endsWith('/api/merch-hierarchy')
    && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const createDepartmentResponse = await createDepartmentPromise;
  assert.equal(createDepartmentResponse.status(), 201, JSON.stringify(await createDepartmentResponse.json()));
  const department = await createDepartmentResponse.json();
  assert.equal(department.code, departmentCode);
  assert.equal(department.hierarchy_type, 'Department');
  assert.equal(department.created_by, username);
  assert.equal(department.updated_by, username);
  assert.equal(department.external_code, `EXT-${suffix}`);
  assert.deepEqual(department.udf, [`Custom ${suffix}`, '', '', '', '']);
  assert.equal(department.default_lottable, `LOT-${suffix}`);
  assert.equal(department.is_default, 'Yes');
  assert.equal(department.return_window, 30);
  assert.equal(department.non_returnable, true);
  assert.equal(department.outbound_packaging_type, 'Small Box');
  assert.equal(department.inbound_packaging_type, 'Normal');
  const storedDepartment = await db.collection('generic_records').findOne({ id: department.id, module: 'merch-hierarchy' });
  assert.equal(storedDepartment.name, `Department, ${suffix}`);
  assert.equal(storedDepartment.created_by, username);

  await page.getByLabel('Merch. Hierarchy Type *').selectOption('Category');
  await page.getByLabel('Merchandising Code *').fill(categoryCode);
  await page.getByLabel('Merchandising Name *').fill(`Category ${suffix}`);
  await page.getByLabel('Merchandising Desc *').fill(`Child hierarchy node ${suffix}`);
  await page.getByLabel('Parent Merch Code').selectOption(departmentCode);
  const createCategoryPromise = page.waitForResponse((response) => response.url().endsWith('/api/merch-hierarchy')
    && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const createCategoryResponse = await createCategoryPromise;
  assert.equal(createCategoryResponse.status(), 201, JSON.stringify(await createCategoryResponse.json()));
  const category = await createCategoryResponse.json();
  assert.equal(category.code, categoryCode);
  assert.equal(category.parent_code, departmentCode);
  assert.equal(category.created_by, username);
  assert.ok(await db.collection('generic_records').findOne({ id: category.id, parent_code: departmentCode, module: 'merch-hierarchy' }));
  await page.getByLabel(`Select merchandising ${departmentCode}`, { exact: true }).waitFor();
  await page.getByLabel(`Select merchandising ${categoryCode}`, { exact: true }).waitFor();

  const duplicateCode = await send('/api/merch-hierarchy', 'POST', {
    code: departmentCode.toLowerCase(), name: 'Duplicate code', description: 'Duplicate guard', hierarchy_type: 'Department',
  });
  assert.equal(duplicateCode.response.status, 409);
  const selfParent = await send('/api/merch-hierarchy', 'PUT', {
    id: category.id, code: categoryCode, name: category.name, description: category.description,
    hierarchy_type: category.hierarchy_type, parent_code: categoryCode,
  });
  assert.equal(selfParent.response.status, 400);
  const cycle = await send('/api/merch-hierarchy', 'PUT', {
    id: department.id, code: departmentCode, name: department.name, description: department.description,
    hierarchy_type: department.hierarchy_type, parent_code: categoryCode,
  });
  assert.equal(cycle.response.status, 400, 'An ancestor cannot be assigned to its descendant as parent.');
  const immutableCode = await send('/api/merch-hierarchy', 'PUT', {
    id: department.id, code: `${departmentCode}-CHANGED`, name: department.name, description: department.description,
    hierarchy_type: department.hierarchy_type,
  });
  assert.equal(immutableCode.response.status, 400);
  const staleUpdate = await send('/api/merch-hierarchy', 'PUT', {
    id: Number.MAX_SAFE_INTEGER, code: departmentCode, name: 'Stale', description: 'Stale update', hierarchy_type: 'Department',
  });
  assert.equal(staleUpdate.response.status, 404);

  await page.getByLabel(`Select merchandising ${departmentCode}`, { exact: true }).click();
  const editCode = page.getByLabel('Merchandising Code *', { exact: true });
  assert.equal(await editCode.isDisabled(), true);
  assert.equal(await editCode.inputValue(), departmentCode);
  await page.getByLabel('Merchandising Name *', { exact: true }).fill(`Department Edited, ${suffix}`);
  const updatePromise = page.waitForResponse((response) => response.url().endsWith('/api/merch-hierarchy') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const updateResponse = await updatePromise;
  assert.equal(updateResponse.status(), 200, JSON.stringify(await updateResponse.json()));
  const updated = await updateResponse.json();
  assert.equal(updated.code, departmentCode);
  assert.equal(updated.name, `Department Edited, ${suffix}`);
  assert.equal(updated.created_by, username);
  assert.equal(updated.updated_by, username);
  assert.deepEqual(updated.udf, [`Custom ${suffix}`, '', '', '', '']);
  assert.equal((await db.collection('generic_records').findOne({ id: department.id })).name, `Department Edited, ${suffix}`);
  assert.equal((await db.collection('generic_records').findOne({ id: category.id })).parent_code, departmentCode, 'Editing a parent label preserves child references.');

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByText('Choose export format', { exact: true }).waitFor();
  const exportDialog = page.locator('div.fixed.inset-0').filter({ hasText: 'Choose export format' });
  const exportPostPromise = page.waitForResponse((response) => response.url().endsWith('/api/downloads')
    && response.request().method() === 'POST');
  const downloadPromise = page.waitForEvent('download').catch(() => null);
  await exportDialog.getByText('CSV', { exact: true }).click();
  const exportPost = await exportPostPromise;
  assert.equal(exportPost.status(), 201, `CSV export history request failed: ${await exportPost.text()}`);
  const exportRecord = await exportPost.json();
  assert.equal(exportRecord.filename, `merchandising-hierarchy-${new Date().toISOString().slice(0, 10)}.csv`);
  assert.equal(exportRecord.status, 'Processing');
  const download = await downloadPromise;
  if (!download) {
    const diagnosticPromise = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob(['diagnostic'], { type: 'text/plain' }));
      link.download = 'download-diagnostic.txt';
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
    const diagnostic = await diagnosticPromise;
    console.error('Merchandising Hierarchy download diagnostics:', {
      appDownloadEvents: downloadEvents,
      syntheticDownload: diagnostic?.suggestedFilename() || 'not observed',
      dialog: await exportDialog.innerText().catch(() => 'closed'),
    });
  }
  assert.ok(download, `CSV history was recorded, but the browser did not start a download. Events observed: ${downloadEvents.join(', ') || 'none'}`);
  assert.match(download.suggestedFilename(), /^merchandising-hierarchy-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile(await download.path(), 'utf8');
  assert.ok(csv.includes('Code,Name,Type,Parent,Status'));
  assert.ok(csv.includes(`"Department Edited, ${suffix}"`), 'CSV export quotes a hierarchy name containing a comma.');
  assert.ok(csv.includes(categoryCode));

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await page.getByLabel('Merchandising Code *', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Merch. Hierarchy Type *', { exact: true }).inputValue(), 'Department');

  const finalRows = await send('/api/merch-hierarchy');
  assert.equal(finalRows.response.status, 200);
  assert.ok(finalRows.json.rows.some((row) => row.code === departmentCode));
  assert.ok(finalRows.json.rows.some((row) => row.code === categoryCode && row.parent_code === departmentCode));
  const eventsAfter = await send('/api/inventory-sync/central/events');
  assert.equal(eventsAfter.response.status, 200);
  assert.deepEqual(eventsAfter.json.map((event) => event.event_key).sort(), eventsBefore.json.map((event) => event.event_key).sort());
  assert.deepEqual(errors, []);
  console.log('PASS Merchandising Hierarchy: signed tree create/edit, parent persistence, five UDFs, Other Settings, enum/reference/self/cycle/duplicate/stale/code guards, authenticated Mongo audit fields, CSV export content, reset, and unchanged Central Inventory events. Import and audit history are explicitly unavailable.');
} catch (error) {
  console.error('Merchandising Hierarchy browser state at failure:', {
    url: page.url(),
    visible: await page.locator('body').innerText().catch(() => ''),
    errors,
  });
  throw error;
} finally {
  await browser.close();
  await mongo.close();
}
