import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const vite = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const observed = [], pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    observed.push(path);
    if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'browser-fixture' }, configured: true } });
    if (path === '/api/inventory-sync/central/overview') return route.fulfill({ json: { products: [], locations: [], accounts: [], alerts: [], generatedAt: new Date().toISOString() } });
    if (path === '/api/inventory-sync/central/events') return route.fulfill({ json: [] });
    if (path === '/api/inventory-sync/connections/catalog') return route.fulfill({ json: { platforms: [], oauth: {}, authorization: {} } });
    if (path === '/api/inventory-sync/connections') return route.fulfill({ json: [] });
    if (path === '/api/inventory-sync/central/publication-status') return route.fulfill({ status: 503, json: { error: 'Publication status unavailable', code: 'PUBLICATION_SCHEMA_UNAVAILABLE' } });
    if (path === '/api/inventory-sync/unified/health') return route.fulfill({ json: { services: [], whatsapp: { senderConfigured: false, newOrderTemplateConfigured: false }, deadTasks: 0, unassignedOrders: 0, ordersWaitingOver20Minutes: 0, blockedPackingAlerts: 0, alerts: [], accounts: [] } });
    if (path === '/api/health/databases') return route.fulfill({ status: 503, json: { mongodb: { datasetState: 'UNREACHABLE', reason: 'TLS_HANDSHAKE_FAILED', selectedDatabase: 'fixture-eretail' }, postgresql: { state: 'READY' } } });
    return route.fulfill({ status: 503, json: { error: 'Fixture endpoint unavailable' } });
  });
  await page.goto(`${base}/app/central-inventory?section=channels`, { waitUntil: 'domcontentloaded' });
  try { await page.getByRole('heading', { name: 'Channel connections and requirements' }).waitFor({ timeout: 10000 }); }
  catch (error) { const body=await page.locator('body').innerText(); throw new Error(`Channel view did not render: ${JSON.stringify({ url: page.url(), bodyStart: body.slice(0, 500), bodyEnd: body.slice(-1200), observed, pageErrors })}`, { cause: error }); }
  await page.getByText('Publication status unavailable', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Marketplace stock publication' }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Refresh connections' }).isVisible(), true);
  assert.ok(observed.includes('/api/inventory-sync/central/publication-status'));
  assert.ok(!observed.includes('/api/health/databases'), 'Unrelated pages must not poll legacy MongoDB health');
  await page.goto(`${base}/app/central-inventory?section=health`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Legacy data: MongoDB TLS handshake failed; check Atlas Network Access, cluster status, and TLS configuration — fixture-eretail', { exact: true }).waitFor();
  assert.ok(observed.includes('/api/health/databases'), 'Connection health must retain the legacy database diagnosis');
  console.log('PASS rendered pages: publication failure stays local; legacy MongoDB warning appears in connection health only');
} finally {
  await browser.close();
  await vite.close();
}
