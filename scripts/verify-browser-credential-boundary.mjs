import '../env.js';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import express from 'express';
import { chromium } from 'playwright';
import { inventoryPrivate } from '../inventory/http.js';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { authenticateSession, currentUser, issueSession, verifyCredentials } from '../api/auth-session.js';
const url = new URL(process.env.INVENTORY_DATABASE_URL || '');
assert.match(url.pathname, /codexqa_test_reliable_/);
assert.ok(['localhost', '127.0.0.1', '::1'].includes(url.hostname));
process.env.INVENTORY_ALLOWED_TENANT_ID = `browser-credential-${randomUUID()}`;
const password = randomBytes(24).toString('hex'), salt = randomBytes(16).toString('hex');
process.env.DMILLS_ADMIN_USER = 'credential-browser-fixture';
process.env.DMILLS_ADMIN_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
process.env.INVENTORY_PUBLIC_ORIGIN = 'https://fixture.invalid';
process.env.SHOPIFY_CLIENT_ID = 'generated-fixture-client';
process.env.SHOPIFY_CLIENT_SECRET = 'generated-fixture-server-secret';
await migrateInventory();
const app = express(); app.use(express.json());
app.use(async (req, res, next) => { try { req.user = await authenticateSession(req); next(); } catch { res.status(503).json({ error: 'Session unavailable' }); } });
app.get('/api/auth/session', (req, res) => res.json({ user: currentUser(req), configured: true }));
app.post('/api/auth/login', async (req, res) => {
  try { if (!await verifyCredentials(req.body.username, req.body.password)) return res.sendStatus(401); await issueSession(res, req.body.username); res.json({ user: { username: req.body.username } }); }
  catch { res.status(503).json({ error: 'Login unavailable' }); }
});
app.use('/api', (req, res, next) => currentUser(req) ? next() : res.status(401).json({ error: 'Sign in' }));
app.use('/api/inventory-sync', inventoryPrivate);
app.use(express.static('dist')); app.get(/^(?!\/api).*/, (_, res) => res.sendFile('index.html', { root: 'dist' }));
let server, browser;
try {
  server = await new Promise((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/inventory-sync/connections`)).status, 401);
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage(); let browserErrors = 0;
  page.on('pageerror', () => browserErrors++);
  await page.goto(base); await page.getByLabel('Login Id').fill(process.env.DMILLS_ADMIN_USER);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('button[type=submit]').click(); await page.waitForURL('**/app/dashboard');
  assert.equal((await page.request.get(`${base}/api/inventory-sync/connections`)).status(), 200);
  const sessionCookie = (await page.context().cookies()).find(cookie => cookie.name === 'dmills_session');
  assert.equal(sessionCookie?.httpOnly, true);
  assert.equal(sessionCookie?.sameSite, 'Strict');
  assert.equal(await page.evaluate(() => document.cookie.includes('dmills_session=')), false);
  await page.getByRole('link', { name: 'Manage inventory' }).click();
  const workspace = page.locator('[data-screen-frame][aria-hidden="false"] [data-central-inventory]');
  await workspace.getByRole('heading', { name: 'Master SKU balances' }).waitFor();
  await workspace.getByRole('navigation').getByRole('button', { name: 'Channel connections', exact: true }).click();
  const shopify = workspace.locator('.seller-connections tbody tr').filter({ has: page.getByText('Shopify', { exact: true }) });
  await shopify.getByRole('button', { name: 'Connect', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Shopify/ });
  const store = dialog.getByLabel('Shop domain', { exact: true });
  const token = dialog.getByLabel('Admin API access token', { exact: true });
  const secret = dialog.getByLabel('App client secret for webhook verification', { exact: true });
  const markers = [randomBytes(24).toString('hex'), randomBytes(24).toString('hex')];
  await store.fill('fixture-browser.myshopify.com');
  for (const [endpoint, action] of [['test', 'Test connection and save'], ['oauth/start', 'Authorize with Shopify']]) {
    for (const failure of ['401', '403', '429', '500', '502', '503', '504', 'transport']) {
      await token.fill(markers[0]); await secret.fill(markers[1]);
      const pattern = `**/api/inventory-sync/connections/${endpoint}`;
      await page.route(pattern, route => failure === 'transport' ? route.abort('failed') : route.fulfill({ status: Number(failure), contentType: 'application/json', body: JSON.stringify({ error: 'Controlled dependency unavailable' }) }));
      await dialog.getByRole('button', { name: action, exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('dialog input[type=password]')].every(input => input.value === ''));
      assert.equal(Boolean(await token.inputValue()), false); assert.equal(Boolean(await secret.inputValue()), false);
      assert.equal(await store.inputValue(), 'fixture-browser.myshopify.com');
      const persisted = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      assert.equal(markers.some(marker => persisted.includes(marker)), false);
      assert.equal(markers.some(marker => page.url().includes(marker)), false);
      await page.unroute(pattern);
    }
  }
  assert.equal(browserErrors, 0);
  assert.equal((await inventoryPool().query('SELECT count(*)::integer AS count FROM ci_channel_account WHERE tenant_id=$1', [process.env.INVENTORY_ALLOWED_TENANT_ID])).rows[0].count, 0);
  console.log('PASS signed-in disposable browser credential boundary: verification/OAuth 401/403/429/500/502/503/504 and transport failures clear secrets, preserve setup, omit marker values from local/session storage and URL, and create no accounts. No real provider calls.');
} finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); await inventoryPool().end(); }
