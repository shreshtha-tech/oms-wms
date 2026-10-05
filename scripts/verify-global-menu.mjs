import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('vin_user', JSON.stringify({ username: 'global-menu-verifier' })));
  await page.goto(`${base}/app/dashboard`, { waitUntil: 'domcontentloaded' });

  const master = page.getByTitle('Master', { exact: true });
  const masterRect = await master.boundingBox();
  assert.equal(Math.round(masterRect?.width || 0), 50, 'LIVE rail entries are 50px wide');
  assert.equal(Math.round(masterRect?.height || 0), 42, 'LIVE rail entries are 42px high');

  await master.hover();
  const masterFlyout = page.getByText('Trading Partners', { exact: true });
  await masterFlyout.waitFor();
  const flyoutBody = page.locator('[data-menu-flyout-body]');
  const flyoutRect = await flyoutBody.boundingBox();
  assert.equal(Math.round(flyoutRect?.x || 0), 50, 'LIVE flyout begins immediately after the 50px rail');
  assert.equal(Math.round(flyoutRect?.width || 0), 630, 'LIVE three-column flyout is 630px wide');
  assert.equal(Math.round(flyoutRect?.height || 0), 419, 'LIVE Master flyout body is 419px high');
  const skuGroup = page.locator('[data-menu-group="SKU Management"]');
  const skuMetrics = await skuGroup.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }));
  assert.equal(skuMetrics.clientHeight, 171, 'LIVE overflowing SKU group is capped at 171px');
  assert.equal(skuMetrics.scrollHeight, 251, 'Captured LIVE SKU labels produce the exact 251px scroll extent');
  const skuRect = await skuGroup.boundingBox();
  await page.mouse.move((skuRect?.x || 0) + 100, (skuRect?.y || 0) + 80);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(100);
  assert.equal(await skuGroup.evaluate((element) => element.scrollTop), 80, 'Wheel is consumed by the overflowing group');
  assert.equal(await page.evaluate(() => scrollY), 0, 'Focused subgroup scrolling must not move the page');
  assert.equal(await page.getByText('Tax Management', { exact: true }).isVisible(), true);
  const beforeUnaudited = page.url();
  const unavailableMenu = page.getByRole('button', { name: 'Manage Voucher Condition, unavailable in this release', exact: true });
  assert.equal(await unavailableMenu.isDisabled(), true, 'Unaudited menu entries must be disabled with an accessible availability hint');
  assert.equal(await unavailableMenu.getAttribute('title'), 'Manage Voucher Condition is unavailable in this release');
  assert.equal(page.url(), beforeUnaudited, 'Unaudited LIVE modules must not enter the removed generic CRUD fallback');
  await master.click();
  assert.equal(await masterFlyout.isVisible(), true, 'Clicking a hovered rail group must not toggle its flyout closed');
  await page.mouse.move(1200, 700);
  await masterFlyout.waitFor({ state: 'hidden' });

  const procurement = page.getByTitle('Procurement', { exact: true });
  await procurement.hover();
  const enquiry = page.getByRole('button', { name: 'PO Enquiry', exact: true });
  await enquiry.waitFor();
  await page.mouse.move(1200, 700);
  await enquiry.waitFor({ state: 'hidden' });

  await master.hover();
  await page.getByRole('button', { name: 'Vendor Master', exact: true }).click();
  await page.waitForURL('**/app/vendors');
  await page.locator('[data-screen-frame][aria-hidden="false"]').waitFor();
  assert.equal(await page.locator('[data-screen-frame][aria-hidden="false"]').count(), 1, 'Menu navigation must activate exactly one retained screen');

  console.log('Global transient menu behavior verified across Master and Procurement, including menu navigation.');
} finally {
  await browser.close();
}
