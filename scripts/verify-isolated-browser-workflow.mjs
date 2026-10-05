import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import '../env.js';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';
import { sealCredential } from '../inventory/credentials.js';

const pgUrl = process.env.INVENTORY_DATABASE_URL;
const mongoUri = process.env.MONGODB_URI;
if (!pgUrl || !mongoUri) throw new Error('Both database connections are required.');
const configuredPg = new URL(pgUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(configuredPg.hostname)) throw new Error('Disposable PostgreSQL test requires a local server.');
const configuredMongo = new URL(mongoUri);
if (!['mongodb:', 'mongodb+srv:'].includes(configuredMongo.protocol) || !['localhost', '127.0.0.1', '::1'].includes(configuredMongo.hostname)) {
  throw new Error('Disposable MongoDB browser test requires a loopback MongoDB server; configured remote clusters are never used for generated test databases.');
}
const configuredPgName = configuredPg.pathname.slice(1);
const configuredMongoName = process.env.MONGODB_DB || 'd_mills_global';
const suffix = `${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
const pgName = `codexqa_${suffix}`;
const mongoName = `codexqa_${suffix}`;
if (pgName === configuredPgName || mongoName === configuredMongoName || Buffer.byteLength(mongoName) > 38) throw new Error('Unsafe test database name.');
console.log(`Generated isolated database names: PostgreSQL=${pgName}, MongoDB=${mongoName}`);
const testPgUrl = new URL(pgUrl);
testPgUrl.pathname = `/${pgName}`;
const port = 3137;
const origin = `http://127.0.0.1:${port}`;
const adminUser = `qa_${suffix}`;
const password = randomBytes(24).toString('hex');
const salt = randomBytes(16).toString('hex');
const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const tenantId = `qa_${suffix}`;
const credentialKey = randomBytes(32).toString('hex');
const shopSecret = randomBytes(32).toString('hex');
const shopDomain = `qa-${suffix}.myshopify.com`;
const admin = new pg.Client({ connectionString: pgUrl, connectionTimeoutMillis: 8000 });
const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
let pgCreated = false;
let mongoCreated = false;
let server;
let browser;
let failed = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${pgName}"`);
  pgCreated = true;
  process.env.INVENTORY_DATABASE_URL = testPgUrl.toString();
  const { migrateInventory, inventoryPool } = await import('../inventory/db.js');
  await migrateInventory();
  await inventoryPool().end();
  const setupDb = new pg.Client({ connectionString: testPgUrl.toString(), connectionTimeoutMillis: 8000 });
  await setupDb.connect();
  const priorCredentialKey = process.env.INVENTORY_CREDENTIAL_KEY;
  let sealedShopSecret;
  try {
    process.env.INVENTORY_CREDENTIAL_KEY = credentialKey;
    sealedShopSecret = sealCredential({ webhookSecret: shopSecret });
  } finally {
    if (priorCredentialKey === undefined) delete process.env.INVENTORY_CREDENTIAL_KEY;
    else process.env.INVENTORY_CREDENTIAL_KEY = priorCredentialKey;
  }
  await setupDb.query(`INSERT INTO ci_channel_account
    (tenant_id,platform,external_account_id,status,encrypted_credentials,credential_iv,credential_tag)
    VALUES($1,'shopify',$2,'active',$3,$4,$5)`,
  [tenantId, shopDomain, sealedShopSecret.encrypted, sealedShopSecret.iv, sealedShopSecret.tag]);
  await setupDb.end();
  const childEnv = {
    ...process.env,
    INVENTORY_DATABASE_URL: testPgUrl.toString(),
    MONGODB_DB: mongoName,
    INVENTORY_ALLOWED_TENANT_ID: tenantId,
    INVENTORY_CREDENTIAL_KEY: credentialKey,
    DMILLS_ADMIN_USER: adminUser,
    DMILLS_ADMIN_PASSWORD_HASH: passwordHash,
    DMILLS_REQUIRE_PERSISTENCE: 'true',
    PORT: String(port),
  };
  server = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  mongoCreated = true;
  let serverLog = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { serverLog = (serverLog + String(chunk)).slice(-5000); });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Isolated app server stopped during startup. Server output: ${serverLog || '(no output captured)'}`);
    try {
      const response = await fetch(`${origin}/api/health/ready`);
      if (response.ok && (await response.json()).ready === true) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Isolated app did not become ready.');
  const browserCache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const installed = (await readdir(browserCache)).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse();
  let executablePath;
  for (const folder of installed) {
    const candidate = join(browserCache, folder, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
  if (!executablePath) throw new Error('No installed Chromium executable found.');
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(adminUser);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${origin}/app/vendors`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add New', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add New', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Please complete the highlighted mandatory fields', { exact: true }).waitFor();
  await page.getByLabel('Vendor Code').fill('QA-BROWSER-VENDOR');
  await page.getByLabel('Vendor Name').fill('Browser Verified Vendor');
  await page.getByLabel('Tax Zone').selectOption({ label: 'Dubai' });
  await page.getByLabel('Currency Code').selectOption({ label: 'Indian Rupee' });
  await page.getByLabel('Vendor Type').selectOption({ label: 'Outright purchase' });
  await page.getByRole('button', { name: 'Address', exact: true }).click();
  for (const [field, value] of Object.entries({ address1: '1 QA Street', contact: 'QA Contact', phone: '9999999999', email: 'qa@example.test', city: 'Delhi', pin_code: '110001', billing_address1: '1 QA Street', billing_contact: 'QA Contact', billing_phone: '9999999999', billing_email: 'billing@example.test', billing_city: 'Delhi', billing_pin_code: '110001' })) {
    await page.locator(`[data-field="${field}"]`).fill(value);
  }
  await page.locator('[data-field="state"]').selectOption({ label: 'Delhi' });
  await page.locator('[data-field="billing_state"]').selectOption({ label: 'Delhi' });
  const saveResponse = page.waitForResponse((response) => response.url().endsWith('/api/vendors') && response.request().method() === 'POST', { timeout: 8000 }).catch(async () => {
    const alerts = await page.locator('[role="alert"]').allTextContents();
    throw new Error(`Vendor create request did not fire. Visible alerts: ${alerts.join(' | ') || 'none'}`);
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const response = await saveResponse;
  if (response.status() !== 201) throw new Error(`Vendor create returned HTTP ${response.status()}: ${(await response.json()).error || 'unknown error'}`);
  const saved = await response.json();
  assert.equal(saved.vendor_code, 'QA-BROWSER-VENDOR');
  assert.equal(saved.audit[0].by, adminUser);
  await mongo.connect();
  assert.equal((await mongo.db(mongoName).collection('vendors').findOne({ vendor_code: 'QA-BROWSER-VENDOR' })).vendor_name, 'Browser Verified Vendor');
  await page.getByRole('button', { name: 'Vendor Master', exact: true }).click();
  await page.getByLabel('Vendor Name').fill('Browser Edited Vendor');
  const updateResponse = page.waitForResponse((response) => response.url().endsWith('/api/vendors') && response.request().method() === 'PUT', { timeout: 8000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal((await updateResponse).status(), 200);
  assert.equal((await mongo.db(mongoName).collection('vendors').findOne({ id: saved.id })).vendor_name, 'Browser Edited Vendor');
  await page.getByRole('button', { name: 'Audit', exact: true }).click();
  await page.getByRole('dialog', { name: 'Vendor Audit' }).getByText(adminUser).first().waitFor();
  await page.getByRole('dialog', { name: 'Vendor Audit' }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Close vendor editor' }).click();
  await page.getByLabel('vendor_code filter').fill('QA-BROWSER-VENDOR');
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  await page.getByText('Browser Edited Vendor', { exact: true }).waitFor();
  const postJson = async (path, body) => page.request.post(`${origin}${path}`, { data: body });
  const productResponse = await postJson('/api/inventory-sync/central/products', { sku: 'QA-BROWSER-SKU', productName: 'Browser Verified Product' });
  assert.equal(productResponse.status(), 201);
  const masterSkuId = (await productResponse.json()).id;
  const locationResponse = await postJson('/api/inventory-sync/central/locations', { code: 'QA-WH', locationType: 'warehouse' });
  assert.equal(locationResponse.status(), 201);
  const locationId = (await locationResponse.json()).id;
  const adjustment = { masterSkuId, locationId, mode: 'set', quantity: 7, reason: 'Isolated browser count', requestId: 'qa-browser-count-1' };
  const writeStarted = performance.now();
  const adjustmentResponse = await postJson('/api/inventory-sync/central/adjustments', adjustment);
  assert.equal(adjustmentResponse.status(), 201);
  const writeCompleted = performance.now();
  const inventoryResponse = await page.request.get(`${origin}/api/inventory`);
  assert.equal(inventoryResponse.status(), 200);
  const stockRow = (await inventoryResponse.json()).find((row) => row.sku_code === 'QA-BROWSER-SKU' && row.warehouse === 'QA-WH');
  assert.equal(stockRow?.on_hand, 7);
  assert.equal(stockRow?.available, 7);
  const readCompleted = performance.now();
  const replayResponse = await postJson('/api/inventory-sync/central/adjustments', adjustment);
  assert.equal(replayResponse.status(), 200);
  assert.equal((await replayResponse.json()).duplicate, true);
  const conflictResponse = await postJson('/api/inventory-sync/central/adjustments', { ...adjustment, quantity: 8 });
  assert.equal(conflictResponse.status(), 409);
  const concurrent = { ...adjustment, mode: 'delta', quantity: 2, requestId: 'qa-browser-concurrent-1' };
  const concurrentResponses = await Promise.all([postJson('/api/inventory-sync/central/adjustments', concurrent), postJson('/api/inventory-sync/central/adjustments', concurrent)]);
  assert.deepEqual(concurrentResponses.map((response) => response.status()).sort(), [200, 201]);
  assert.equal((await page.request.get(`${origin}/api/inventory`).then((response) => response.json())).find((row) => row.sku_code === 'QA-BROWSER-SKU').on_hand, 9);
  const eventsResponse = await page.request.get(`${origin}/api/inventory-sync/central/events`);
  assert.equal(eventsResponse.status(), 200);
  assert.equal((await eventsResponse.json()).filter((event) => event.sku === 'QA-BROWSER-SKU').length, 2);
  const configuredLocation = await postJson('/api/locations', { location_code: 'QA-WH', location_name: 'QA Warehouse', location_short_name: 'QAWH', location_type: 'WH', status: 'Active' });
  assert.equal(configuredLocation.status(), 201, JSON.stringify(await configuredLocation.json()));
  const poPayload = { po_no: 'QA-BROWSER-PO', vendor: 'Browser Edited Vendor', vendor_code: 'QA-BROWSER-VENDOR', warehouse: 'QA-WH', po_date: '2026-09-30', expected_date: '2026-10-01', buyer_name: 'QA Buyer', recv_validation_code: 'QA', qty: 8, amount: 80, line_items: [{ sku_code: 'QA-BROWSER-SKU', qty: 8 }] };
  const poResponse = await postJson('/api/purchase-orders', poPayload);
  assert.equal(poResponse.status(), 201, JSON.stringify(await poResponse.json()));
  const po = await poResponse.json();
  const receiptPayload = { action: 'confirm', poNo: poPayload.po_no, warehouse: 'QA-WH', lines: [{ skuCode: 'QA-BROWSER-SKU', rcvdUOMQty: 3 }], requestId: 'qa-browser-inbound-1' };
  assert.equal((await postJson('/api/inbound-create-edit', receiptPayload)).status(), 409);
  const putPo = (action) => page.request.put(`${origin}/api/purchase-orders`, { data: { id: po.id, action } });
  assert.equal((await putPo('confirm')).status(), 200);
  assert.equal((await putPo('release')).status(), 200);
  const inboundStarted = performance.now();
  const inboundResponse = await postJson('/api/inbound-create-edit', receiptPayload);
  assert.equal(inboundResponse.status(), 201, JSON.stringify(await inboundResponse.json()));
  const inboundCompleted = performance.now();
  const confirmedInbound = await inboundResponse.json();
  assert.equal(confirmedInbound.row.status, 'Confirmed');
  const inboundVisible = await page.request.get(`${origin}/api/inventory`);
  assert.equal((await inboundVisible.json()).find(row => row.sku_code === 'QA-BROWSER-SKU').on_hand, 12);
  const inboundReadCompleted = performance.now();
  assert.equal((await mongo.db(mongoName).collection('grn').findOne({ central_request_id: receiptPayload.requestId })).central_receipt_status, 'committed');
  const inboundReplay = await postJson('/api/inbound-create-edit', receiptPayload);
  assert.equal(inboundReplay.status(), 200, JSON.stringify(await inboundReplay.json()));
  assert.equal((await postJson('/api/inbound-create-edit', { ...receiptPayload, lines: [{ skuCode: 'QA-BROWSER-SKU', rcvdUOMQty: 4 }] })).status(), 409);
  const competing = [
    postJson('/api/inbound-create-edit', { ...receiptPayload, requestId: 'qa-browser-inbound-create-edit-competition', lines: [{ skuCode: 'QA-BROWSER-SKU', rcvdUOMQty: 5 }] }),
    postJson('/api/inbound-realtime', { action: 'confirm', inboundType: 'With PO', poNo: poPayload.po_no, warehouse: 'QA-WH', requestId: 'qa-browser-inbound-realtime-competition', lines: [{ skuCode: 'QA-BROWSER-SKU', rcvdQty: 5 }] }),
  ];
  assert.deepEqual((await Promise.all(competing)).map(response => response.status()).sort(), [201, 409]);
  const competitionRows = await mongo.db(mongoName).collection('grn').find({ central_request_id: { $in: ['qa-browser-inbound-create-edit-competition', 'qa-browser-inbound-realtime-competition'] } }).toArray();
  assert.ok(competitionRows.length >= 1 && competitionRows.length <= 2);
  assert.equal(competitionRows.filter(row => row.central_receipt_status === 'committed').length, 1);
  assert.ok(competitionRows.every(row => ['blocked', 'committed'].includes(row.central_receipt_status)));
  const competitionInventory = await page.request.get(`${origin}/api/inventory`).then(response => response.json());
  assert.equal(competitionInventory.find(row => row.sku_code === 'QA-BROWSER-SKU' && row.warehouse === 'QA-WH')?.on_hand, 17, 'Only one competing 5-unit receipt may commit; a request rejected before staging need not leave a blocked Mongo row.');
  const storeLocation = await postJson('/api/inventory-sync/central/locations', { code: 'QA-STORE', locationType: 'store' });
  assert.equal(storeLocation.status(), 201);
  const storeMaster = await postJson('/api/locations', { location_code: 'QA-STORE', location_name: 'QA Store', location_short_name: 'QAST', location_type: 'Store', status: 'Active' });
  assert.equal(storeMaster.status(), 201);
  await page.goto(`${origin}/app/m/inv-move`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Inventory Move', exact: true }).waitFor();
  await page.getByPlaceholder('SKU Code').fill('QA-BROWSER-SKU');
  await page.getByLabel('Source location', { exact: true }).selectOption({ label: 'QA Warehouse (QA-WH)' });
  await page.getByLabel('Destination location', { exact: true }).selectOption({ label: 'QA Store (QA-STORE)' });
  await page.getByPlaceholder('Quantity').fill('4');
  await page.getByPlaceholder('Reason / Reference').fill('Browser verified location transfer');
  const transferStarted = performance.now();
  const transferResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/inventory-ops') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const transferResponse = await transferResponsePromise;
  const transferResult = await transferResponse.json();
  assert.equal(transferResponse.status(), 201, JSON.stringify(transferResult));
  const transfer = transferResponse.request().postDataJSON();
  assert.equal(transfer.entity, 'inv-move');
  assert.equal(transfer.from_warehouse, 'QA Warehouse');
  assert.equal(transfer.to_warehouse, 'QA Store');
  assert.equal(transfer.quantity, '4');
  await page.getByRole('status').getByText('Inventory Move committed to Central Inventory.', { exact: true }).waitFor();
  const transferCompleted = performance.now();
  assert.equal(transferResult.status, 'Completed');
  const transferReplay = await page.request.post(`${origin}/api/inventory-ops?entity=moves`, { data: transfer });
  assert.equal(transferReplay.status(), 200);
  assert.equal((await transferReplay.json()).duplicate, true);
  assert.equal((await page.request.post(`${origin}/api/inventory-ops?entity=moves`, { data: { ...transfer, quantity: 3 } })).status(), 409);
  const transferRead = await page.request.get(`${origin}/api/inventory`);
  const transferRows = await transferRead.json();
  const transferReadCompleted = performance.now();
  const transferBalances = transferRows.filter(row => row.sku_code === 'QA-BROWSER-SKU');
  assert.equal(transferBalances.find(row => row.warehouse === 'QA-WH')?.on_hand, 13);
  assert.equal(transferBalances.find(row => row.warehouse === 'QA-STORE')?.on_hand, 4);
  assert.equal(transferBalances.reduce((sum, row) => sum + Number(row.on_hand), 0), 17);
  const transferEvents = await page.request.get(`${origin}/api/inventory-sync/central/events`).then(response => response.json());
  assert.equal(transferEvents.filter(event => event.event_key?.startsWith(`wms-transfer:${transfer.requestId}:`)).length, 2);
  await page.goto(`${origin}/app/r/inv-move-history`, { waitUntil: 'domcontentloaded' });
  const moveHistorySearch = page.waitForResponse(response => response.url().endsWith('/api/inventory-move-history') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  const moveHistoryResponse = await moveHistorySearch;
  const moveHistoryResult = await moveHistoryResponse.json();
  assert.equal(moveHistoryResponse.status(), 200, JSON.stringify(moveHistoryResult));
  const moveHistoryUnfiltered = await page.request.post(`${origin}/api/inventory-move-history`, { data: { REQ_SEARCH_FLAG: true, rows: 20, page: 1, skuCode: 'QA-BROWSER-SKU' } }).then(response => response.json());
  assert(moveHistoryResult.rows.some(row => row.skuCode === 'QA-BROWSER-SKU'), JSON.stringify({ result: moveHistoryResult, request: moveHistoryResponse.request().postDataJSON(), unfiltered: moveHistoryUnfiltered, events: transferEvents.filter(event => event.event_key?.startsWith(`wms-transfer:${transfer.requestId}:`)) }));
  const moveRow = page.locator('tbody tr').filter({ hasText: 'QA-BROWSER-SKU' }).first();
  await moveRow.waitFor();
  assert.equal(await moveRow.locator('td').nth(4).innerText(), '4');
  assert.match(await moveRow.innerText(), /Transfer from QA-WH to QA-STORE/);
  console.log(`Isolated location transfer response ${Math.round(transferCompleted - transferStarted)} ms; committed response to balance read ${Math.round(transferReadCompleted - transferCompleted)} ms.`);
  await page.goto(`${origin}/app/m/stock-adjustment`, { waitUntil: 'domcontentloaded' });
  const adjustmentScreen = page.locator('select[aria-label="Inventory record"]');
  await adjustmentScreen.waitFor();
  await adjustmentScreen.selectOption({ label: 'QA-BROWSER-SKU — QA-WH (13)' });
  await page.getByPlaceholder('Quantity').fill('2');
  await page.getByPlaceholder('Reason / Reference').fill('Count variance: 2 units found');
  const stockAdjustmentResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/inventory-ops') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const stockAdjustmentResponse = await stockAdjustmentResponsePromise;
  assert.equal(stockAdjustmentResponse.status(), 201, JSON.stringify(await stockAdjustmentResponse.json()));
  const stockAdjustmentPayload = stockAdjustmentResponse.request().postDataJSON();
  assert.equal(stockAdjustmentPayload.masterSkuId, masterSkuId);
  assert.equal(stockAdjustmentPayload.locationId, locationId);
  assert.equal(stockAdjustmentPayload.quantity, '2');
  assert.equal(stockAdjustmentPayload.reason, 'Count variance: 2 units found');
  await page.getByRole('status').getByText('Stock Adjustment committed to Central Inventory.', { exact: true }).waitFor();
  const stockAdjustmentReplay = await page.request.post(`${origin}/api/inventory-ops?entity=adjustments`, { data: stockAdjustmentPayload });
  assert.equal(stockAdjustmentReplay.status(), 200);
  assert.equal((await stockAdjustmentReplay.json()).duplicate, true);
  assert.equal((await page.request.post(`${origin}/api/inventory-ops?entity=adjustments`, { data: { ...stockAdjustmentPayload, quantity: '3' } })).status(), 409);
  const adjustedInventory = await page.request.get(`${origin}/api/inventory`).then(response => response.json());
  assert.equal(adjustedInventory.find(row => row.sku_code === 'QA-BROWSER-SKU' && row.warehouse === 'QA-WH')?.on_hand, 15);
  const adjustedEvents = await page.request.get(`${origin}/api/inventory-sync/central/events`).then(response => response.json());
  assert.equal(adjustedEvents.filter(event => event.event_key === `wms-adjustment:${stockAdjustmentPayload.requestId}`).length, 1);
  assert.equal(Number(adjustedEvents.find(event => event.event_key === `wms-adjustment:${stockAdjustmentPayload.requestId}`)?.delta_on_hand), 2);
  await page.goto(`${origin}/app/central-inventory?section=stock`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Record physical stock', exact: true }).waitFor();
  const countForm = page.locator('[data-central-inventory] form.ci-form').first();
  const countSelects = countForm.locator('select');
  await countSelects.nth(0).selectOption(masterSkuId);
  await countSelects.nth(1).selectOption(locationId);
  await countSelects.nth(2).selectOption('set');
  await countForm.locator('input[type="number"]').first().fill('14');
  await countForm.locator('label').filter({ hasText: 'Reason / reference' }).locator('input').fill('QA physical count: 14 units observed');
  const physicalCountResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/inventory-sync/central/adjustments') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Record stock', exact: true }).click();
  const physicalCountResponse = await physicalCountResponsePromise;
  assert.equal(physicalCountResponse.status(), 201, JSON.stringify(await physicalCountResponse.json()));
  const physicalCountPayload = physicalCountResponse.request().postDataJSON();
  assert.equal(physicalCountPayload.mode, 'set');
  assert.equal(physicalCountPayload.quantity, 14);
  await page.getByRole('status').getByText('Stock recorded and alerts evaluated', { exact: true }).waitFor();
  const physicalCountReplay = await page.request.post(`${origin}/api/inventory-sync/central/adjustments`, { data: physicalCountPayload });
  assert.equal(physicalCountReplay.status(), 200);
  assert.equal((await physicalCountReplay.json()).duplicate, true);
  assert.equal((await page.request.post(`${origin}/api/inventory-sync/central/adjustments`, { data: { ...physicalCountPayload, quantity: 13 } })).status(), 409);
  const countedInventory = await page.request.get(`${origin}/api/inventory`).then(response => response.json());
  assert.equal(countedInventory.find(row => row.sku_code === 'QA-BROWSER-SKU' && row.warehouse === 'QA-WH')?.on_hand, 14);
  const countedEvents = await page.request.get(`${origin}/api/inventory-sync/central/events`).then(response => response.json());
  const physicalCountEvent = countedEvents.find(event => event.event_key === `manual:${physicalCountPayload.requestId}`);
  assert.equal(physicalCountEvent?.event_type, 'physical_count');
  assert.equal(Number(physicalCountEvent?.delta_on_hand), -1);
  await page.goto(`${origin}/app/inventory`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  const inventorySkuCells = page.getByRole('cell', { name: 'QA-BROWSER-SKU', exact: true });
  await inventorySkuCells.first().waitFor();
  assert.equal(await inventorySkuCells.count(), 2);
  console.log(`Isolated Central Inventory count response ${Math.round(writeCompleted - writeStarted)} ms; committed response to Inventory View API visibility ${Math.round(readCompleted - writeCompleted)} ms.`);
  console.log(`Isolated released PO inbound response ${Math.round(inboundCompleted - inboundStarted)} ms; committed response to inventory API visibility ${Math.round(inboundReadCompleted - inboundCompleted)} ms.`);
  const orderEvent = Buffer.from(JSON.stringify({
    id: `QA-ORDER-${suffix}`,
    status: 'open',
    created_at: new Date().toISOString(),
    shipping_address: { city: 'Bengaluru', zip: '560001' },
    current_total_price: '1250.00', currency: 'INR',
    line_items: [{ id: `QA-LINE-${suffix}`, sku: 'QA-BROWSER-SKU', quantity: 2, title: 'Browser Verified Product' }],
  }));
  const webhookId = `qa-order-${suffix}`;
  const shopifyHeaders = (body) => ({
    'content-type': 'application/json',
    'x-shopify-shop-domain': shopDomain,
    'x-shopify-topic': 'orders/create',
    'x-shopify-webhook-id': webhookId,
    'x-shopify-hmac-sha256': createHmac('sha256', shopSecret).update(body).digest('base64'),
  });
  const shopifyWebhookPath = `${origin}/api/inventory-sync/shopify/webhook`;
  const webhookResponse = await page.request.post(shopifyWebhookPath, { data: orderEvent, headers: shopifyHeaders(orderEvent) });
  const webhookResult = await webhookResponse.json();
  assert.equal(webhookResponse.status(), 202, JSON.stringify(webhookResult));
  assert.equal(webhookResult.duplicate, false);
  const webhookReplay = await page.request.post(shopifyWebhookPath, { data: orderEvent, headers: shopifyHeaders(orderEvent) });
  assert.equal(webhookReplay.status(), 202);
  assert.equal((await webhookReplay.json()).duplicate, true);
  const changedOrderEvent = Buffer.from(orderEvent.toString().replace('1250.00', '1300.00'));
  assert.equal((await page.request.post(shopifyWebhookPath, { data: changedOrderEvent, headers: shopifyHeaders(changedOrderEvent) })).status(), 409);
  const orderSearchUrl = `${origin}/api/inventory-sync/unified/orders/search?page=1&limit=25`;
  const ordersResponse = await page.request.get(orderSearchUrl);
  assert.equal(ordersResponse.status(), 200);
  const ordersResult = await ordersResponse.json();
  assert.equal(ordersResult.total, 1);
  assert.equal(ordersResult.rows[0].external_order_id, `QA-ORDER-${suffix}`);
  assert.equal(ordersResult.rows[0].items[0].sku, 'QA-BROWSER-SKU');
  await page.goto(`${origin}/app/order-enquiry`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-live-orders] h1').getByText('Order Enquiry', { exact: true }).waitFor();
  const orderWorkspace = page.locator('[data-live-orders]').filter({ has: page.getByRole('heading', { name: 'Order Enquiry', exact: true }) });
  await orderWorkspace.getByLabel('Order, SKU or product', { exact: true }).fill(`QA-ORDER-${suffix}`);
  const orderRow = orderWorkspace.locator('tbody tr').filter({ hasText: `QA-ORDER-${suffix}` });
  await orderRow.waitFor();
  assert.equal((await orderRow.locator('td').nth(3).innerText()).trim(), '2');
  assert.match(await orderRow.innerText(), /shopify/);
  assert.match(await orderRow.innerText(), /open/);
  await orderRow.getByRole('button', { name: `QA-ORDER-${suffix}` }).click();
  await page.getByRole('heading', { name: `Order QA-ORDER-${suffix}`, exact: true }).waitFor();
  await page.getByText('QA-BROWSER-SKU · Browser Verified Product · 2 units', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'ForcePull Order' }).count(), 0);
  for (const [route, title] of [
    ['master-order-enquiry', 'Master Order Enquiry'],
    ['global-order-search', 'Global Order Search'],
  ]) {
    await page.goto(`${origin}/app/${route}`, { waitUntil: 'domcontentloaded' });
    const workspace = page.locator('[data-live-orders]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await workspace.getByLabel('Order, SKU or product', { exact: true }).fill(`QA-ORDER-${suffix}`);
    const matchingOrder = workspace.locator('tbody tr').filter({ hasText: `QA-ORDER-${suffix}` });
    await matchingOrder.waitFor();
    assert.equal((await matchingOrder.locator('td').nth(3).innerText()).trim(), '2');
    assert.match(await matchingOrder.innerText(), /shopify/);
    await matchingOrder.getByRole('button', { name: `QA-ORDER-${suffix}` }).click();
    await workspace.getByRole('heading', { name: `Order QA-ORDER-${suffix}`, exact: true }).waitFor();
    await workspace.getByText('QA-BROWSER-SKU · Browser Verified Product · 2 units', { exact: true }).waitFor();
  }
  await page.goto(`${origin}/app/sale-orders`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-live-orders] h1').getByText('Sale Orders', { exact: true }).waitFor();
  const saleOrdersWorkspace = page.locator('[data-live-orders]').filter({ has: page.getByRole('heading', { name: 'Sale Orders', exact: true }) });
  await saleOrdersWorkspace.getByLabel('Order, SKU or product', { exact: true }).fill(`QA-ORDER-${suffix}`);
  await saleOrdersWorkspace.locator('tbody tr').filter({ hasText: `QA-ORDER-${suffix}` }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'New Order' }).count(), 0);
  const runArsRulesAndLog = async () => {
    const arsRulesVerifier = spawn(process.execPath, ['scripts/verify-ars-rules.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const arsRulesVerifierExit = await new Promise((resolve, reject) => {
      arsRulesVerifier.once('error', reject);
      arsRulesVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(arsRulesVerifierExit.code, 0, 'ARS Rules verifier failed.');

    const isolatedMongoDb = mongo.db(mongoName);
    const savedRule = await isolatedMongoDb.collection('ars_rules').findOne({ description: 'Playwright ARS Rule' });
    assert.ok(savedRule, 'The signed ARS rule verifier should persist the rule before the log fixture is added.');
    const configuredLocations = (await page.request.get(`${origin}/api/locations`).then((response) => response.json())).rows;
    const location = configuredLocations.find((row) => (row.location_code || row.code) === 'QA-WH') || configuredLocations.find((row) => !row.status || row.status.toLowerCase() === 'active');
    assert.ok(location, 'The isolated ARS log fixture requires a configured location.');
    const locationName = location.location_name || location.name;
    const link = await isolatedMongoDb.collection('ars_sku_links').findOne({});
    assert.ok(link, 'The isolated ARS log fixture should refer to a SKU-Location link created by the signed workflow.');
    const executionId = `ARSEX-QA-${suffix.toUpperCase()}`;
    await isolatedMongoDb.collection('ars_execution_logs').insertOne({
      id: 900000000 + Math.floor(Math.random() * 90000000), execution_id: executionId, started_at: new Date().toISOString(),
      rule_id: String(savedRule.rule_id), description: savedRule.description, frequency_desc: 'Monthly', vendor_type: savedRule.vendor_type,
      output_type: savedRule.output_type, location: locationName, status: 'Pending', message: 'Isolated historical fixture for read-only detail verification.',
      generated_po_codes: [], execution_details: [{ location: locationName, sku_code: link.sku_code, vendor: link.primary_vendor || '', inventory: 4,
        ars_calculated: 8, ars_approved: 8, status: 'Pending', document_generated: '' }],
    });
    const arsExecutionLogVerifier = spawn(process.execPath, ['scripts/verify-ars-execution-log.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password,
        ERETAIL_TEST_EXECUTION_ID: executionId, ERETAIL_TEST_RULE_ID: String(savedRule.rule_id), PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const arsExecutionLogVerifierExit = await new Promise((resolve, reject) => {
      arsExecutionLogVerifier.once('error', reject);
      arsExecutionLogVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(arsExecutionLogVerifierExit.code, 0, 'ARS Execution Log verifier failed.');

    const arsSettingsVerifier = spawn(process.execPath, ['scripts/verify-ars-settings.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const arsSettingsVerifierExit = await new Promise((resolve, reject) => {
      arsSettingsVerifier.once('error', reject);
      arsSettingsVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(arsSettingsVerifierExit.code, 0, 'ARS Settings verifier failed.');
  };
  if (process.env.ISOLATED_BROWSER_FOCUS === 'ars') {
    const focusedSku = await postJson('/api/skus', { sku_code: `QA-ARS-${suffix}`, name: 'ARS isolated verification SKU', status: 'Active' });
    assert.equal(focusedSku.status(), 201, JSON.stringify(await focusedSku.json()));
    const arsSkuLocationVerifier = spawn(process.execPath, ['scripts/verify-ars-sku-location.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const arsSkuLocationVerifierExit = await new Promise((resolve, reject) => {
      arsSkuLocationVerifier.once('error', reject);
      arsSkuLocationVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(arsSkuLocationVerifierExit.code, 0, 'ARS SKU-Location Link verifier failed.');
    await runArsRulesAndLog();
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'manage-channels') {
    const manageChannelsVerifier = spawn(process.execPath, ['scripts/verify-manage-channels.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const manageChannelsVerifierExit = await new Promise((resolve, reject) => {
      manageChannelsVerifier.once('error', reject);
      manageChannelsVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(manageChannelsVerifierExit.code, 0, 'Manage Channels verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'sku-channel-listing') {
    const skuChannelListingVerifier = spawn(process.execPath, ['scripts/verify-sku-channel-listing.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const skuChannelListingVerifierExit = await new Promise((resolve, reject) => {
      skuChannelListingVerifier.once('error', reject);
      skuChannelListingVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(skuChannelListingVerifierExit.code, 0, 'SKU Channel Listing verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'sku-moderation') {
    const skuModerationVerifier = spawn(process.execPath, ['scripts/verify-sku-moderation.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const skuModerationVerifierExit = await new Promise((resolve, reject) => {
      skuModerationVerifier.once('error', reject);
      skuModerationVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(skuModerationVerifierExit.code, 0, 'SKU Moderation verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'oms-rules') {
    const omsRulesVerifier = spawn(process.execPath, ['scripts/verify-oms-rules.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const omsRulesVerifierExit = await new Promise((resolve, reject) => {
      omsRulesVerifier.once('error', reject);
      omsRulesVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(omsRulesVerifierExit.code, 0, 'OMS Rules verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'cod-reconciliation') {
    const codReconciliationVerifier = spawn(process.execPath, ['scripts/verify-cod-reconciliation.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const codReconciliationVerifierExit = await new Promise((resolve, reject) => {
      codReconciliationVerifier.once('error', reject);
      codReconciliationVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(codReconciliationVerifierExit.code, 0, 'COD Reconciliation verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'po-enquiry') {
    const poEnquiryVerifier = spawn(process.execPath, ['scripts/verify-po-enquiry.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const poEnquiryVerifierExit = await new Promise((resolve, reject) => {
      poEnquiryVerifier.once('error', reject);
      poEnquiryVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(poEnquiryVerifierExit.code, 0, 'PO Enquiry verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'po-revision') {
    const poRevisionVerifier = spawn(process.execPath, ['scripts/verify-po-revision.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const poRevisionVerifierExit = await new Promise((resolve, reject) => {
      poRevisionVerifier.once('error', reject);
      poRevisionVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(poRevisionVerifierExit.code, 0, 'PO Revision verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'vouchers') {
    const voucherVerifier = spawn(process.execPath, ['scripts/verify-voucher-guard.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const voucherVerifierExit = await new Promise((resolve, reject) => {
      voucherVerifier.once('error', reject);
      voucherVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(voucherVerifierExit.code, 0, 'Voucher guard verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'sku-company-link') {
    const linkVerifier = spawn(process.execPath, ['scripts/verify-sku-company-link.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const linkVerifierExit = await new Promise((resolve, reject) => {
      linkVerifier.once('error', reject);
      linkVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(linkVerifierExit.code, 0, 'SKU Company Link verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'sku-group') {
    const skuGroupVerifier = spawn(process.execPath, ['scripts/verify-sku-group.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const skuGroupVerifierExit = await new Promise((resolve, reject) => {
      skuGroupVerifier.once('error', reject);
      skuGroupVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(skuGroupVerifierExit.code, 0, 'SKU Group verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'coupons') {
    const couponVerifier = spawn(process.execPath, ['scripts/verify-coupon-guard.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const couponVerifierExit = await new Promise((resolve, reject) => {
      couponVerifier.once('error', reject);
      couponVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(couponVerifierExit.code, 0, 'Manage Coupons guard verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'sales-promotion') {
    const promotionVerifier = spawn(process.execPath, ['scripts/verify-sales-promotion-guard.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const promotionVerifierExit = await new Promise((resolve, reject) => {
      promotionVerifier.once('error', reject);
      promotionVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(promotionVerifierExit.code, 0, 'Sales Promotion guard verifier failed.');
  } else if (process.env.ISOLATED_BROWSER_FOCUS === 'other-masters') {
    const otherMastersVerifier = spawn(process.execPath, ['scripts/verify-other-masters.mjs'], {
      cwd: process.cwd(),
      env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
      stdio: 'inherit',
    });
    const otherMastersVerifierExit = await new Promise((resolve, reject) => {
      otherMastersVerifier.once('error', reject);
      otherMastersVerifier.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(otherMastersVerifierExit.code, 0, 'Other Masters guard verifier failed.');
  } else {
  const previousMongoDatabase = process.env.MONGODB_DB;
  process.env.MONGODB_DB = mongoName;
  try {
    const isolatedMongoStore = await import(`../api/mongo.js?isolated=${suffix}`);
    await isolatedMongoStore.insert('generic_records', {
      module: 'user-enquiry', code: `QA_PICKER_${suffix}`, name: `QA Picker ${suffix}`, description: 'Disposable picker fixture for WMS Zone link/unlink verification',
    });
  } finally {
    if (previousMongoDatabase === undefined) delete process.env.MONGODB_DB;
    else process.env.MONGODB_DB = previousMongoDatabase;
  }
  const wmsVerifier = spawn(process.execPath, ['scripts/verify-wms-zone.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, ERETAIL_TEST_LOCATION: 'QA-WH', PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const wmsVerifierExit = await new Promise((resolve, reject) => {
    wmsVerifier.once('error', reject);
    wmsVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(wmsVerifierExit.code, 0, `WMS Zone verifier exited with ${wmsVerifierExit.code ?? wmsVerifierExit.signal}.`);
  const pickerPreferenceVerifier = spawn(process.execPath, ['scripts/verify-picker-zone-preference.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const pickerPreferenceVerifierExit = await new Promise((resolve, reject) => {
    pickerPreferenceVerifier.once('error', reject);
    pickerPreferenceVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(pickerPreferenceVerifierExit.code, 0, `Picker Zone Preference verifier exited with ${pickerPreferenceVerifierExit.code ?? pickerPreferenceVerifierExit.signal}.`);
  const binEditorVerifier = spawn(process.execPath, ['scripts/verify-bin-editor.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, ERETAIL_TEST_LOCATION: 'QA-WH', PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const binEditorVerifierExit = await new Promise((resolve, reject) => {
    binEditorVerifier.once('error', reject);
    binEditorVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(binEditorVerifierExit.code, 0, `Bin Create/Edit verifier exited with ${binEditorVerifierExit.code ?? binEditorVerifierExit.signal}.`);
  const binEnquiryVerifier = spawn(process.execPath, ['scripts/verify-bin-enquiry.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, ERETAIL_TEST_LOCATION: 'QA-WH', PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const binEnquiryVerifierExit = await new Promise((resolve, reject) => {
    binEnquiryVerifier.once('error', reject);
    binEnquiryVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(binEnquiryVerifierExit.code, 0, `Bin Enquiry verifier exited with ${binEnquiryVerifierExit.code ?? binEnquiryVerifierExit.signal}.`);
  const binAuditVerifier = spawn(process.execPath, ['scripts/verify-bin-audit.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, ERETAIL_TEST_LOCATION: 'QA-WH', PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const binAuditVerifierExit = await new Promise((resolve, reject) => {
    binAuditVerifier.once('error', reject);
    binAuditVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(binAuditVerifierExit.code, 0, `BIN Audit verifier exited with ${binAuditVerifierExit.code ?? binAuditVerifierExit.signal}.`);
  const cycleCountWaveVerifier = spawn(process.execPath, ['scripts/verify-cycle-count-waves.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, ERETAIL_TEST_LOCATION: 'QA-WH', PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const cycleCountWaveVerifierExit = await new Promise((resolve, reject) => {
    cycleCountWaveVerifier.once('error', reject);
    cycleCountWaveVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(cycleCountWaveVerifierExit.code, 0, `Manage Cycle Count Wave verifier exited with ${cycleCountWaveVerifierExit.code ?? cycleCountWaveVerifierExit.signal}.`);
  const allocationStrategiesVerifier = spawn(process.execPath, ['scripts/verify-allocation-strategies.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, ERETAIL_TEST_LOCATION: 'QA-WH', PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const allocationStrategiesVerifierExit = await new Promise((resolve, reject) => {
    allocationStrategiesVerifier.once('error', reject);
    allocationStrategiesVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(allocationStrategiesVerifierExit.code, 0, `Manage Allocation Strategies verifier exited with ${allocationStrategiesVerifierExit.code ?? allocationStrategiesVerifierExit.signal}.`);
  const putawayRulesVerifier = spawn(process.execPath, ['scripts/verify-putaway-rules.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, ERETAIL_TEST_LOCATION: 'QA-WH', PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const putawayRulesVerifierExit = await new Promise((resolve, reject) => {
    putawayRulesVerifier.once('error', reject);
    putawayRulesVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(putawayRulesVerifierExit.code, 0, 'Manage PutAway Rule verifier failed.');
  const lottableVerifier = spawn(process.execPath, ['scripts/verify-lottable-validation.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const lottableVerifierExit = await new Promise((resolve, reject) => {
    lottableVerifier.once('error', reject);
    lottableVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(lottableVerifierExit.code, 0, 'Lottable Validation verifier failed.');
  const skuLabelPrintVerifier = spawn(process.execPath, ['scripts/verify-sku-label-print.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const skuLabelPrintVerifierExit = await new Promise((resolve, reject) => {
    skuLabelPrintVerifier.once('error', reject);
    skuLabelPrintVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(skuLabelPrintVerifierExit.code, 0, 'SKU Label Print verifier failed.');
  const receiptValidationVerifier = spawn(process.execPath, ['scripts/verify-receipt-validation.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const receiptValidationVerifierExit = await new Promise((resolve, reject) => {
    receiptValidationVerifier.once('error', reject);
    receiptValidationVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(receiptValidationVerifierExit.code, 0, 'Receipt Validation verifier failed.');
  const putawayEnquiryVerifier = spawn(process.execPath, ['scripts/verify-putaway-enquiry.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, ERETAIL_TEST_LOCATION: 'QA-WH', ERETAIL_TEST_INBOUND_NO: confirmedInbound.row.inboundNo, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const putawayEnquiryVerifierExit = await new Promise((resolve, reject) => {
    putawayEnquiryVerifier.once('error', reject);
    putawayEnquiryVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(putawayEnquiryVerifierExit.code, 0, 'PutAway Enquiry verifier failed.');
  const clientMasterVerifier = spawn(process.execPath, ['scripts/verify-client-master-workflow.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const clientMasterVerifierExit = await new Promise((resolve, reject) => {
    clientMasterVerifier.once('error', reject);
    clientMasterVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(clientMasterVerifierExit.code, 0, 'Client Master verifier failed.');
  const customerGroupVerifier = spawn(process.execPath, ['scripts/verify-customer-group-workflow.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const customerGroupVerifierExit = await new Promise((resolve, reject) => {
    customerGroupVerifier.once('error', reject);
    customerGroupVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(customerGroupVerifierExit.code, 0, 'Customer Group verifier failed.');
  const taxCategoryVerifier = spawn(process.execPath, ['scripts/verify-tax-category-workflow.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const taxCategoryVerifierExit = await new Promise((resolve, reject) => {
    taxCategoryVerifier.once('error', reject);
    taxCategoryVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(taxCategoryVerifierExit.code, 0, 'Tax Category verifier failed.');
  const taxGroupVerifier = spawn(process.execPath, ['scripts/verify-tax-group-workflow.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const taxGroupVerifierExit = await new Promise((resolve, reject) => {
    taxGroupVerifier.once('error', reject);
    taxGroupVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(taxGroupVerifierExit.code, 0, 'Tax Group verifier failed.');
  const taxCodeVerifier = spawn(process.execPath, ['scripts/verify-tax-code-workflow.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const taxCodeVerifierExit = await new Promise((resolve, reject) => {
    taxCodeVerifier.once('error', reject);
    taxCodeVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(taxCodeVerifierExit.code, 0, 'Tax Code verifier failed.');
  const taxZoneVerifier = spawn(process.execPath, ['scripts/verify-tax-zone-workflow.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const taxZoneVerifierExit = await new Promise((resolve, reject) => {
    taxZoneVerifier.once('error', reject);
    taxZoneVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(taxZoneVerifierExit.code, 0, 'Tax Zone verifier failed.');
  const taxApplicationVerifier = spawn(process.execPath, ['scripts/verify-tax-application-workflow.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const taxApplicationVerifierExit = await new Promise((resolve, reject) => {
    taxApplicationVerifier.once('error', reject);
    taxApplicationVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(taxApplicationVerifierExit.code, 0, 'Tax Application verifier failed.');
  const skuMasterVerifier = spawn(process.execPath, ['scripts/verify-sku-master-workflow.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const skuMasterVerifierExit = await new Promise((resolve, reject) => {
    skuMasterVerifier.once('error', reject);
    skuMasterVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(skuMasterVerifierExit.code, 0, 'SKU Master verifier failed.');
  const skuImportVerifier = spawn(process.execPath, ['scripts/verify-sku-import.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const skuImportVerifierExit = await new Promise((resolve, reject) => {
    skuImportVerifier.once('error', reject);
    skuImportVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(skuImportVerifierExit.code, 0, 'SKU Import verifier failed.');
  const skuBarcodeVerifier = spawn(process.execPath, ['scripts/verify-sku-barcode.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const skuBarcodeVerifierExit = await new Promise((resolve, reject) => {
    skuBarcodeVerifier.once('error', reject);
    skuBarcodeVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(skuBarcodeVerifierExit.code, 0, 'SKU Barcode verifier failed.');
  const skuCompanyLinkVerifier = spawn(process.execPath, ['scripts/verify-sku-company-link.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const skuCompanyLinkVerifierExit = await new Promise((resolve, reject) => {
    skuCompanyLinkVerifier.once('error', reject);
    skuCompanyLinkVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(skuCompanyLinkVerifierExit.code, 0, 'SKU Company Link verifier failed.');
  const skuGroupVerifier = spawn(process.execPath, ['scripts/verify-sku-group.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const skuGroupVerifierExit = await new Promise((resolve, reject) => {
    skuGroupVerifier.once('error', reject);
    skuGroupVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(skuGroupVerifierExit.code, 0, 'Manage SKU Group verifier failed.');
  const merchandisingHierarchyVerifier = spawn(process.execPath, ['scripts/verify-merchandising-hierarchy.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const merchandisingHierarchyVerifierExit = await new Promise((resolve, reject) => {
    merchandisingHierarchyVerifier.once('error', reject);
    merchandisingHierarchyVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(merchandisingHierarchyVerifierExit.code, 0, 'Merchandising Hierarchy verifier failed.');
  const manageAttributeVerifier = spawn(process.execPath, ['scripts/verify-manage-attribute.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const manageAttributeVerifierExit = await new Promise((resolve, reject) => {
    manageAttributeVerifier.once('error', reject);
    manageAttributeVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(manageAttributeVerifierExit.code, 0, 'Manage Attribute verifier failed.');
  const attributeSetVerifier = spawn(process.execPath, ['scripts/verify-attribute-set.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const attributeSetVerifierExit = await new Promise((resolve, reject) => {
    attributeSetVerifier.once('error', reject);
    attributeSetVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(attributeSetVerifierExit.code, 0, 'Attribute Set verifier failed.');
  const vendorSkuCatalogVerifier = spawn(process.execPath, ['scripts/verify-vendor-sku-catalog.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const vendorSkuCatalogVerifierExit = await new Promise((resolve, reject) => {
    vendorSkuCatalogVerifier.once('error', reject);
    vendorSkuCatalogVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(vendorSkuCatalogVerifierExit.code, 0, 'Vendor SKU Catalog verifier failed.');
  const vendorSkuLocCatalogVerifier = spawn(process.execPath, ['scripts/verify-vendor-sku-loc-catalog.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const vendorSkuLocCatalogVerifierExit = await new Promise((resolve, reject) => {
    vendorSkuLocCatalogVerifier.once('error', reject);
    vendorSkuLocCatalogVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(vendorSkuLocCatalogVerifierExit.code, 0, 'Vendor SKU Loc Catalog verifier failed.');
  const manageChannelsVerifier = spawn(process.execPath, ['scripts/verify-manage-channels.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const manageChannelsVerifierExit = await new Promise((resolve, reject) => {
    manageChannelsVerifier.once('error', reject);
    manageChannelsVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(manageChannelsVerifierExit.code, 0, 'Manage Channels verifier failed.');
  const skuChannelListingVerifier = spawn(process.execPath, ['scripts/verify-sku-channel-listing.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const skuChannelListingVerifierExit = await new Promise((resolve, reject) => {
    skuChannelListingVerifier.once('error', reject);
    skuChannelListingVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(skuChannelListingVerifierExit.code, 0, 'SKU Channel Listing verifier failed.');
  const skuModerationVerifier = spawn(process.execPath, ['scripts/verify-sku-moderation.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const skuModerationVerifierExit = await new Promise((resolve, reject) => {
    skuModerationVerifier.once('error', reject);
    skuModerationVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(skuModerationVerifierExit.code, 0, 'SKU Moderation verifier failed.');
  const omsRulesVerifier = spawn(process.execPath, ['scripts/verify-oms-rules.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const omsRulesVerifierExit = await new Promise((resolve, reject) => {
    omsRulesVerifier.once('error', reject);
    omsRulesVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(omsRulesVerifierExit.code, 0, 'OMS Rules verifier failed.');
  const codReconciliationVerifier = spawn(process.execPath, ['scripts/verify-cod-reconciliation.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const codReconciliationVerifierExit = await new Promise((resolve, reject) => {
    codReconciliationVerifier.once('error', reject);
    codReconciliationVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(codReconciliationVerifierExit.code, 0, 'COD Reconciliation verifier failed.');
  const arsSkuLocationVerifier = spawn(process.execPath, ['scripts/verify-ars-sku-location.mjs'], {
    cwd: process.cwd(),
    env: { ...childEnv, ERETAIL_BASE_URL: origin, ERETAIL_TEST_USERNAME: adminUser, ERETAIL_TEST_PASSWORD: password, PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath },
    stdio: 'inherit',
  });
  const arsSkuLocationVerifierExit = await new Promise((resolve, reject) => {
    arsSkuLocationVerifier.once('error', reject);
    arsSkuLocationVerifier.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(arsSkuLocationVerifierExit.code, 0, 'ARS SKU-Location Link verifier failed.');
  await runArsRulesAndLog();
  }
  assert.deepEqual(errors, []);
  if (process.env.ISOLATED_BROWSER_FOCUS === 'ars') console.log('PASS isolated signed-in ARS SKU-Location, Rules, Execution Log, and Settings browser workflows.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'manage-channels') console.log('PASS isolated signed-in Manage Channels create/search workflow.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'sku-channel-listing') console.log('PASS isolated signed-in SKU Channel Listing create/edit/import/link workflow.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'sku-moderation') console.log('PASS isolated signed-in SKU Moderation enquiry/link/import workflow.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'oms-rules') console.log('PASS isolated signed-in OMS Rules configuration workflow.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'cod-reconciliation') console.log('PASS isolated signed-in COD Reconciliation read-only workflow and blocked settlement actions.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'vouchers') console.log('PASS isolated signed-in Generate Vouchers fail-closed workflow.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'other-masters') console.log('PASS isolated signed-in Other Masters read-only workflow and blocked generic writes.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'sales-promotion') console.log('PASS isolated signed-in Sales Promotion read-only workflow and blocked generic writes.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'coupons') console.log('PASS isolated signed-in Manage Coupons read-only workflow and blocked writes.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'sku-group') console.log('PASS isolated signed-in SKU Group workflow and blocked generic bypass.');
  else if (process.env.ISOLATED_BROWSER_FOCUS === 'sku-company-link') console.log('PASS isolated signed-in SKU Company Link workflow, uniqueness, and blocked generic bypass.');
  else console.log('PASS isolated signed-in browser: Vendor, Customer, Client, Customer Group, Tax Category, Tax Code, Tax Group, Tax Zone, Tax Application, SKU Master, SKU Import, SKU Barcode, SKU Company Link, Manage SKU Group, Merchandising Hierarchy, Manage Attribute, Attribute Set, Vendor SKU Catalog, Vendor SKU Loc Catalog, Manage Channels, ARS SKU-Location Link, ARS Rules, ARS Execution Log, B2B ARS Settings, Central Inventory count and Stock Adjustment, location transfer, PO receipt concurrency, movement history, signed Shopify webhook replay, populated order search/detail on Order Enquiry, Master Order Enquiry, Global Order Search, and Sale Orders, WMS Zone CRUD/picker actions, Picker Zone Preference import/edit/audit/search, Bin Create/Edit, Bin Enquiry, guarded BIN Audit, Cycle Count Wave configuration, allocation strategy metadata, PutAway Rule configuration, Lottable Validation, guarded SKU Label Print, Receipt Validation, and guarded PutAway Enquiry draft workflow.');
} catch (error) {
  failed = true;
  console.error('Isolated browser workflow failed:', error.code || error.name || 'TEST_FAILURE', error.stack || error.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  try { if (mongoCreated) { await mongo.connect(); await mongo.db(mongoName).dropDatabase(); console.log('Isolated MongoDB browser database removed.'); } }
  catch (error) { failed = true; console.error('MongoDB cleanup failed:', error.code || error.name); }
  await mongo.close().catch(() => {});
  try { if (pgCreated) { await admin.query(`DROP DATABASE "${pgName}" WITH (FORCE)`); console.log('Isolated PostgreSQL browser database removed.'); } }
  catch (error) { failed = true; console.error('PostgreSQL cleanup failed:', error.code || error.name, pgName); }
  await admin.end().catch(() => {});
  process.exit(failed ? 1 : 0);
}
