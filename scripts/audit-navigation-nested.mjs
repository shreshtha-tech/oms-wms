import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const port = 3128, base = `http://127.0.0.1:${port}`;
const user = 'nav-nested-local', password = randomBytes(16).toString('hex'), salt = randomBytes(16).toString('hex');
const hash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), MONGODB_URI: '', DMILLS_ADMIN_USER: user, DMILLS_ADMIN_PASSWORD_HASH: hash }, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let n = 0; n < 80; n++) {
    try { if ((await fetch(`${base}/api/auth/session`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!ready) throw new Error('Local server did not start');
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage();
  await page.goto(base);
  await page.getByRole('textbox', { name: 'Login Id' }).fill(user);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');
  await page.goto(`${base}/app/central-inventory`);
  await page.locator('[data-central-inventory]').getByText('Catalog SKUs').waitFor();
  const sections = [];
  for (const label of ['Stock overview', 'Record physical stock', 'Excel upload', 'Low-stock alerts', 'Channel connections', 'Ledger activity']) {
    const button = page.getByRole('navigation', { name: 'Central inventory sections' }).getByRole('button', { name: label });
    await button.click();
    sections.push({ label, selected: await button.getAttribute('aria-current'), heading: (await page.locator('.ci-content h2').allInnerTexts()).slice(0, 3) });
  }
  await page.locator('[data-screen-frame][aria-hidden="false"]').getByTitle('Switch Location').click();
  const locationDialog = await page.getByRole('dialog', { name: 'User Preferences' }).isVisible();
  await page.goto(`${base}/app/dashboard`);
  await page.locator('[data-screen-frame][aria-hidden="false"]').getByTitle('Export Report Status').click();
  await page.waitForTimeout(350);
  const downloads = { url: new URL(page.url()).pathname, body: (await page.locator('[data-screen-frame][aria-hidden="false"]').innerText()).slice(0, 180) };
  writeFileSync('artifacts/navigation-audit/nested-results.json', JSON.stringify({ sections, locationDialog, downloads }, null, 2));
  console.log(JSON.stringify({ sections, locationDialog, downloads }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
