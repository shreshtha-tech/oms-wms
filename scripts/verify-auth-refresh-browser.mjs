import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  let sessions = 0, delayed;
  let notifyDelayed;
  const delayedReady = new Promise(resolve => { notifyDelayed = resolve; });
  await page.route(`${base}/`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="fixture"></div>' }));
  await page.route('**/api/auth/session', async route => {
    if (++sessions === 2) { delayed = route; notifyDelayed(); return; }
    await route.fulfill({ json: { user: null, configured: true } });
  });
  await page.route('**/api/auth/login', route => route.fulfill({ json: { user: { username: 'owned-browser-user' } } }));
  await page.goto(base);
  await page.evaluate(async () => {
    const { default: refreshRuntime } = await import('/@react-refresh');
    refreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { AuthProvider, useAuth } = await import('/src/context/AuthContext.tsx');
    function Probe() {
      const auth = useAuth();
      window.fixtureAuth = auth;
      return React.createElement('div', { id: 'auth-state' }, auth.loading ? 'loading' : auth.user?.username || 'signed-out');
    }
    ReactDOM.createRoot(document.getElementById('fixture')).render(React.createElement(AuthProvider, null, React.createElement(Probe)));
  });
  await page.locator('#auth-state').filter({ hasText: 'signed-out' }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await delayedReady;
  assert.equal((await page.evaluate(() => window.fixtureAuth.login('owned-browser-user', 'synthetic-password'))).ok, true);
  await page.locator('#auth-state').filter({ hasText: 'owned-browser-user' }).waitFor();
  await delayed.fulfill({ json: { user: null, configured: true } });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#auth-state').textContent(), 'owned-browser-user');
  let revocationWorks = false;
  await page.route('**/api/auth/logout', route => route.fulfill(revocationWorks ? { json: { ok: true } } : { status: 503, json: { error: 'Session database unavailable' } }));
  assert.match(await page.evaluate(() => window.fixtureAuth.logout().then(() => '', error => error.message)), /Sign-out failed/);
  assert.equal(await page.locator('#auth-state').textContent(), 'owned-browser-user');
  revocationWorks = true;
  await page.evaluate(() => window.fixtureAuth.logout());
  await page.locator('#auth-state').filter({ hasText: 'signed-out' }).waitFor();
  console.log('PASS rendered Chrome AuthProvider: stale refresh cannot erase sign-in; failed revocation preserves user until acknowledged sign-out');
} finally { await browser.close(); }
