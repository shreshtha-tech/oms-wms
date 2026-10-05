import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';

const baseUrl = process.env.ERETAIL_BASE_URL || '';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
if (!username || !password) throw new Error('PO Revision verification requires the generated administrator login.');
if (!/^codexqa_[a-z0-9_]+$/i.test(dbName)) throw new Error('PO Revision verification requires a generated codexqa MongoDB database.');
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(baseUrl).hostname)) throw new Error('PO Revision verification only permits a local app.');
const mongoUrl = new URL(mongoUri);
if (mongoUrl.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', '::1'].includes(mongoUrl.hostname)) throw new Error('PO Revision verification only permits a loopback MongoDB server.');
const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const anonymous = await browser.newContext();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const runtimeErrors = [];
const apiErrors = [];
let expectedApiError = false;
page.on('pageerror', (error) => runtimeErrors.push(error.message));
page.on('console', (message) => { if (!expectedApiError && message.type() === 'error') runtimeErrors.push(message.text()); });
page.on('response', (response) => { if (!expectedApiError && response.url().includes('/api/') && response.status() >= 400) apiErrors.push(`${response.status()} ${response.url()}`); });

try {
  assert.equal((await anonymous.request.get(`${baseUrl}/api/purchase-orders`)).status(), 401, 'Purchase-order API must require a session.');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  const suffix = Date.now().toString().slice(-8);
  const poNo = `POREV${suffix}`;
  const vendorCode = `QA-V-${suffix}`;
  const vendorName = `QA PO Revision Vendor ${suffix}`;
  const vendorResponse = await page.request.post(`${baseUrl}/api/vendors`, { data: { vendor_code: vendorCode, vendor_name: vendorName, vendor_type: 'Outright purchase', status: 'Confirmed' } });
  if (vendorResponse.status() !== 201) throw new Error(`Generated vendor fixture failed: ${vendorResponse.status()} ${await vendorResponse.text()}`);
  const createdResponse = await page.request.post(`${baseUrl}/api/purchase-orders`, { data: {
    po_no: poNo, vendor: vendorName, vendor_code: vendorCode, warehouse: 'Delhi NCR', source_location: 'Mumbai WH',
    po_date: '2026-08-24', expected_date: '2026-08-30', items: 1, qty: 10, amount: 1000, buyer_name: 'System Buyer',
    recv_validation_code: 'Standard', po_type: 'Outright', po_mode: 'Manual', status: 'Pending Confirmation',
  }});
  if (!createdResponse.ok()) throw new Error(`Fixture create failed: ${createdResponse.status()} ${await createdResponse.text()}`);
  const created = await createdResponse.json();
  const revisedResponse = await page.request.put(`${baseUrl}/api/purchase-orders`, { data: { id: created.id, qty: 12, amount: 1200, expected_date: '2026-09-01', revision_reason: 'Parity verification' } });
  if (!revisedResponse.ok()) throw new Error(`Fixture revision failed: ${revisedResponse.status()} ${await revisedResponse.text()}`);
  const persisted = await db.collection('purchase_orders').findOne({ po_no: poNo });
  if (persisted?.revision_no !== 1 || persisted?.revisions?.[0]?.reason !== 'Parity verification') throw new Error('PO revision did not persist to the generated MongoDB database.');

  for (const size of [20, 50, 100, 200]) {
    const response = await page.request.post(`${baseUrl}/api/po-revision`, { data: { rows: size, page: 1, sidx: 'id.POCode', sord: 'asc', REQ_SEARCH_FLAG: true, 'id.POCode': poNo } });
    if (!response.ok()) throw new Error(`Page-size ${size} search failed: ${response.status()}`);
    const result = await response.json();
    if (!Array.isArray(result.rows) || result.total !== 1 || result.page !== 1 || result.records !== 1 || result.rows[0].poRevisionCode !== `${poNo}-R1`) throw new Error(`Invalid response model for page size ${size}: ${JSON.stringify(result)}`);
  }

  await page.goto(`${baseUrl}/app/purchase-orders`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Search to view PO revisions', { exact: true }).waitFor();
  if (await page.getByRole('button', { name: /create purchase order|revise|receive/i }).count()) throw new Error('Unobserved PO mutation controls remain in PO Revision.');
  const poTypeOptions = await page.locator('#gs_poType option').allTextContents();
  const expectedTypes = ['CIF', 'Outright-Direct Inbound', 'Outright', 'ARS', 'FNV', 'Consignment', 'Blanket', 'SOR', 'Aggregate'];
  if (JSON.stringify(poTypeOptions) !== JSON.stringify(expectedTypes)) throw new Error('PO Type options do not match live.');
  const sizes = await page.getByRole('combobox', { name: 'Records per Page' }).locator('option').allTextContents();
  if (JSON.stringify(sizes) !== JSON.stringify(['20', '50', '100', '200'])) throw new Error('Page sizes do not match live.');

  await page.getByRole('button', { name: 'Advanced Search', exact: true }).click();
  const poModes = await page.getByLabel('PO Mode').locator('option').allTextContents();
  if (!['ARS', 'Auto', 'BackOrder', 'BackOrder/new', 'DirectInbound', 'Manual', 'System'].every((mode) => poModes.includes(mode))) throw new Error('PO Mode options do not match confirmed options.');
  await page.getByLabel('From PO Revision Code').fill(`${poNo}-R1`);
  await page.getByLabel('To PO Revision Code').fill(`${poNo}-R1`);
  await page.getByLabel('From PO Code').fill(poNo);
  await page.getByLabel('To PO Code').fill(poNo);
  await page.getByLabel('Source Location').selectOption({ label: 'Mumbai WH' });
  await page.locator('#gs_poDate').fill('2026-08-24');
  await page.locator('#gs_poRevisionDate').fill(new Date().toISOString().slice(0, 10));
  await page.locator('#gs_poCode').fill(poNo);
  const [request] = await Promise.all([
    page.waitForRequest((request) => request.url().endsWith('/api/po-revision') && request.method() === 'POST', { timeout: 12000 }),
    page.locator('#SearchBtn').click(),
  ]);
  const payload = request.postDataJSON();
  if (payload.rows !== 20 || payload.page !== 1 || payload.sidx !== 'id.POCode' || payload.sord !== 'asc' || payload.REQ_SEARCH_FLAG !== true || payload['id.POCode'] !== poNo || payload.podate !== '2026-08-24' || !payload.poRevisionDate || payload.sourceLocation !== 'Mumbai WH' || payload.createdBy !== '' || payload.updatedDate !== '' || payload.fromPORevisionCode !== `${poNo}-R1` || payload.toPOCode !== poNo) throw new Error(`Search payload mismatch: ${JSON.stringify(payload)}`);
  await page.getByText(`${poNo}-R1`, { exact: true }).waitFor();
  await page.getByText('View 1 - 1 of 1', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Open vendor picker' }).click();
  await page.getByText('Vendor Picker', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Search vendors' }).fill(vendorName);
  const vendor = page.getByRole('button').filter({ hasText: vendorName }).first();
  await vendor.click();
  if (!await page.locator('#gs_vendorCode').inputValue()) throw new Error('Vendor picker did not populate Vendor Code.');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  if (await page.locator('#gs_poCode').inputValue() || await page.locator('#gs_vendorCode').inputValue()) throw new Error('Reset did not clear filters.');
  await page.getByText('Search to view PO revisions', { exact: true }).waitFor();

  expectedApiError = true;
  await page.route('**/api/po-revision', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Verification failure' }) });
  });
  await page.locator('#SearchBtn').click();
  await page.getByText('Loading records…', { exact: true }).waitFor();
  await page.getByRole('alert').getByText('Verification failure', { exact: true }).waitFor();
  await page.unroute('**/api/po-revision');
  expectedApiError = false;
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  if (runtimeErrors.length || apiErrors.length) throw new Error(`Browser errors: ${[...runtimeErrors, ...apiErrors].join(' | ')}`);
  console.log('PASS PO Revision: API-backed search, response model, filters, advanced search, vendor picker, pagination sizes, grid, and reset.');
} finally {
  await anonymous.close();
  await browser.close();
  await mongo.close();
}
