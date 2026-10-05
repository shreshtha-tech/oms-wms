import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.DMILLS_TEST_BASE_URL || 'http://127.0.0.1:3002';
const username = process.env.DMILLS_TEST_USER;
const password = process.env.DMILLS_TEST_PASSWORD;
if (!username || !password) {
  console.error('Set DMILLS_TEST_USER and DMILLS_TEST_PASSWORD for an isolated test server.');
  process.exit(1);
}

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const allRoutes = [...new Set([...source.matchAll(/path="([^"]+)"/g)].map(match => match[1]))]
  .filter(path => path.startsWith('/app/') && !path.includes(':') && !path.includes('*'));
const requested = String(process.env.DMILLS_TEST_ROUTES || '').split(',').map(route => route.trim()).filter(Boolean);
const hasAdminRoute = source.includes('path="/app/admin/:screen"');
const routes = requested.length ? requested.filter(route => allRoutes.includes(route) || (route.startsWith('/app/admin/') && hasAdminRoute)) : allRoutes;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
const loaded = [];
let activeRoute = 'login';
page.on('pageerror', error => failures.push({ route: activeRoute, error: error.message }));
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Login Id' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard', { timeout: 10000 });
  for (const route of routes) {
    activeRoute = route;
    try {
      const response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(250);
      const body = await page.locator('body').innerText();
      if (response?.status() !== 200) failures.push({ route, error: `HTTP ${response?.status()}` });
      if (page.url().endsWith('/')) failures.push({ route, error: 'Redirected to login' });
      if (!body.trim()) failures.push({ route, error: 'Empty rendered body' });
      const match = /Vinculum Solutions|JX Karawaci|Welcome to eRetail|Vin eRetail/i.exec(body);
      if (match) failures.push({ route, error: `Reference content visible: ${body.slice(Math.max(0, match.index - 45), match.index + match[0].length + 45).replace(/\s+/g, ' ')}` });
      loaded.push(route);
    } catch (error) {
      failures.push({ route, error: error.message });
    }
  }
  console.log(JSON.stringify({ checked: routes.length, loaded: loaded.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
