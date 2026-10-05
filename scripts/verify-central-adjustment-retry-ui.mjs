import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright';

const skuId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const posted = [];
const app = express();
app.use(express.json());
app.get('/api/auth/session', (_req, res) => res.json({ user: { username: 'isolated-ui-operator' }, configured: true }));
app.get('/api/inventory-sync/central/overview', (_req, res) => res.json({
  products: [{ id: skuId, sku: 'RETRY-SKU', product_name: 'Retry item', on_hand: '5', reserved: '0', sellable: '5', counted_locations: 1,
    threshold: null, alert_enabled: false, in_base_workbook: false, workbook_listed_stock: null }],
  locations: [{ id: locationId, code: 'RETRY-WH', location_type: 'warehouse' }], accounts: [], alerts: [], generatedAt: new Date().toISOString(),
}));
app.get('/api/inventory-sync/central/events', (_req, res) => res.json([]));
app.post('/api/inventory-sync/central/adjustments', (req, res) => {
  posted.push(req.body);
  if (posted.length === 1) return res.status(503).json({ error: 'Response uncertain; retry the same request' });
  return res.json({ duplicate: true, eventId: 'same-event' });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unavailable in isolated UI test' }));
app.use(express.static('dist'));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile('index.html', { root: 'dist' }));

const server = app.listen(0, '127.0.0.1');
let browser;
try {
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`${base}/app/central-inventory?section=stock`);
  const frame = page.locator('[data-screen-frame][aria-hidden="false"]');
  const workspace = frame.locator('[data-central-inventory]');
  await workspace.getByRole('heading', { name: 'Record physical stock' }).waitFor();
  await workspace.getByLabel('SKU', { exact: true }).selectOption(skuId);
  await workspace.getByLabel('Warehouse / store').selectOption(locationId);
  await workspace.getByLabel('Operation').selectOption('delta');
  await workspace.getByLabel('Quantity', { exact: true }).fill('2');
  await workspace.getByLabel('Reason / reference').fill('Count correction');
  await workspace.getByRole('button', { name: 'Record stock', exact: true }).click();
  await workspace.getByText('Response uncertain; retry the same request').waitFor();
  assert.equal(posted.length, 1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('central-inventory-pending-adjustment:isolated-ui-operator')));
  assert.equal(saved.id, posted[0].requestId);

  await page.reload();
  await workspace.getByRole('heading', { name: 'Record physical stock' }).waitFor();
  await workspace.getByText('A stock request is awaiting confirmation.', { exact: false }).waitFor();
  assert.equal(await workspace.getByLabel('Quantity', { exact: true }).inputValue(), '2');
  await workspace.getByLabel('Reason / reference').fill('Changed correction');
  await workspace.getByRole('button', { name: 'Record stock', exact: true }).click();
  await workspace.getByText('A previous stock request is unresolved.', { exact: false }).waitFor();
  assert.equal(posted.length, 1, 'Changed retry must not mint a new stock event');

  await workspace.getByLabel('Reason / reference').fill('Count correction');
  await workspace.getByRole('button', { name: 'Record stock', exact: true }).click();
  await workspace.getByText('Stock recorded and alerts evaluated').waitFor();
  assert.equal(posted.length, 2);
  assert.equal(posted[1].requestId, posted[0].requestId);
  assert.equal(await page.evaluate(() => localStorage.getItem('central-inventory-pending-adjustment:isolated-ui-operator')), null);
  console.log('PASS stock adjustment keeps the same request ID after uncertain response and reload; changed retry is blocked');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
