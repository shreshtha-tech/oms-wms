import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.DMILLS_BASE_URL || 'http://127.0.0.1:3002';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  await page.getByLabel('Login Id', { exact: true }).waitFor();
  await page.getByLabel('Password', { exact: true }).waitFor();
  for (const name of ['Login', 'Reset']) await page.getByRole('button', { name, exact: true }).waitFor();
  await page.getByText('D-Mills Global Private Limited', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('© 2026 D-Mills Global Private Limited', { exact: true }).count(), 1);

  const sessionResponse = await page.request.get(`${base}/api/auth/session`);
  assert.equal(sessionResponse.status(), 200, 'The local authentication endpoint must be reachable.');
  assert.equal((await sessionResponse.json()).configured, true, 'Set DMILLS_ADMIN_USER and DMILLS_ADMIN_PASSWORD_HASH before login.');

  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Invalid login credentials.' }).waitFor();
  await page.getByLabel('Login Id').fill('unknown-user-for-login-check');
  await page.getByLabel('Password').fill('deliberately-invalid-login-check');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await page.getByLabel('Login Id').inputValue(), '');
  assert.equal(await page.getByLabel('Password').inputValue(), '');
  assert.equal(await page.getByRole('alert').count(), 0);

  const protectedResponse = await page.request.get(`${base}/api/skus`);
  assert.equal(protectedResponse.status(), 401, 'Protected APIs must reject requests without a session.');
  const protectedInventoryResponse = await page.request.get(`${base}/api/inventory-sync/central/overview`);
  assert.equal(protectedInventoryResponse.status(), 401, 'Central Inventory APIs must reject requests without a session.');
  console.log('Global login contract verified: D-Mills login UI, configured auth endpoint, invalid-credential feedback, reset, and protected business and Central Inventory APIs.');
} finally {
  await browser.close();
}
