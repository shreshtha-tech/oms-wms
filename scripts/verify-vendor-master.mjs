import { chromium } from 'playwright';
import { startTestServer } from './lib/test-server.mjs';

const fixture = await startTestServer();
const baseUrl = fixture.baseUrl;
const uniqueCode = `VM-E2E-${Date.now()}`;
const requiredTabs = ['Vendor Master', 'Address', 'User Defined Fields', 'Attached Document', 'Terms and Conditions', 'Seller Details', 'Other Details'];

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const exactLabel = (page, text, index = 0) => page.locator('label').filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`) }).nth(index);
const labelInput = (page, text, index = 0) => exactLabel(page, text, index).locator('input');
const labelSelect = (page, text, index = 0) => exactLabel(page, text, index).locator('select');

let browser;
let page;
const pageErrors = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const [name,value] = fixture.sessionCookie.split('=');
  await context.addCookies([{ name,value,url:baseUrl,httpOnly:true,sameSite:'Strict' }]);
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.setDefaultTimeout(10_000);
  console.log(`Starting Vendor Master browser workflow at ${baseUrl}`);
  await page.goto(`${baseUrl}/app/vendors`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  await page.getByRole('button', { name: 'add new' }).waitFor();
  await page.getByRole('button', { name: 'add new' }).click();
  for (const tab of requiredTabs) await assert(await page.getByRole('button', { name: tab, exact: true }).count() === 1, `Missing tab: ${tab}`);

  // Save validates before submission and does not silently create an incomplete vendor.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Please complete the highlighted mandatory fields', { exact: true }).waitFor();

  await labelInput(page, 'Vendor Code').fill(uniqueCode);
  await labelInput(page, 'Vendor Name').fill('Vendor Master E2E');
  await labelSelect(page, 'Tax Zone').selectOption({ label: 'Dubai' });
  await labelSelect(page, 'Currency Code').selectOption({ label: 'Indian Rupee' });
  await labelSelect(page, 'Vendor Type').selectOption({ label: 'Outright purchase' });
  await assert(await labelSelect(page, 'Tax Zone').inputValue() === 'Dubai', 'Tax Zone did not retain selection');
  await assert(await labelSelect(page, 'Currency Code').inputValue() === 'Indian Rupee', 'Currency did not retain selection');
  await assert(await labelSelect(page, 'Vendor Type').inputValue() === 'Outright purchase', 'Vendor Type did not retain selection');

  // Switching tabs keeps unsaved field state.
  await page.getByRole('button', { name: 'Address', exact: true }).click();
  await labelInput(page, 'Address 1', 0).fill('1 Test Lane');
  await labelInput(page, 'Contact Person', 0).fill('Test Contact');
  await labelInput(page, 'Phone', 0).fill('9999999999');
  await labelInput(page, 'Email', 0).fill('shipping@example.test');
  await labelSelect(page, 'Country', 0).selectOption({ label: 'INDIA' });
  await labelSelect(page, 'State', 0).selectOption({ label: 'Delhi' });
  await labelInput(page, 'City', 0).fill('Delhi');
  await labelInput(page, 'Pin Code', 0).fill('110001');
  await page.getByLabel('Copy To Billing').check();
  await labelInput(page, 'Address 1', 1).fill('1 Test Lane');
  await labelInput(page, 'Contact Person', 1).fill('Test Contact');
  await labelInput(page, 'Phone', 1).fill('9999999999');
  await labelInput(page, 'Email', 1).fill('billing@example.test');
  await labelSelect(page, 'Country', 1).selectOption({ label: 'INDIA' });
  await labelSelect(page, 'State', 1).selectOption({ label: 'Delhi' });
  await labelInput(page, 'City', 1).fill('Delhi');
  await labelInput(page, 'Pin Code', 1).fill('110001');
  await assert(await labelSelect(page, 'State', 0).inputValue() === 'Delhi', 'Shipping State did not retain selection');
  await assert(await labelSelect(page, 'State', 1).inputValue() === 'Delhi', 'Billing State did not retain selection');
  await page.getByRole('button', { name: 'Vendor Master', exact: true }).click();
  await assert(await labelInput(page, 'Vendor Code').inputValue() === uniqueCode, 'Tab switch reset Vendor Code');
  await assert(await labelSelect(page, 'Tax Zone').inputValue() === 'Dubai', 'Tab switch reset Tax Zone');
  await assert(await labelSelect(page, 'Currency Code').inputValue() === 'Indian Rupee', 'Tab switch reset Currency Code');
  await assert(await labelSelect(page, 'Vendor Type').inputValue() === 'Outright purchase', 'Tab switch reset Vendor Type');

  const createResponse = page.waitForResponse((response) => response.url().includes('/api/vendors') && response.request().method() === 'POST' && response.status() === 201);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const created = await createResponse;
  const createdVendor = await created.json();
  await assert(createdVendor.vendor_code === uniqueCode && createdVendor.address1 === '1 Test Lane', 'Create payload did not persist the entered Vendor data');
  await page.getByText('Vendor created successfully').waitFor();
  await page.getByRole('button', { name: 'Close vendor editor' }).click();
  await page.getByText(uniqueCode).waitFor();

  // Persisted records support local Link To Store, Audit and status workflows.
  await page.getByRole('button', { name: uniqueCode, exact: true }).click();
  await page.getByRole('button', { name: 'Link To Store', exact: true }).click();
  const storeDialog = page.getByRole('dialog', { name: 'Link To Store' });
  await storeDialog.getByLabel('Delhi NCR Store').check();
  await storeDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Vendor linked to store(s)').waitFor();
  await labelInput(page, 'Vendor Short Name').fill('E2E edited');
  const updateResponse = page.waitForResponse((response) => response.url().includes('/api/vendors') && response.request().method() === 'PUT' && response.status() === 200);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const updatedVendor = await (await updateResponse).json();
  await assert(updatedVendor.vendor_short_name === 'E2E edited' && updatedVendor.linked_stores.includes('Delhi NCR Store'), 'Edit/save did not persist the changed Vendor data');
  await page.getByText('Vendor updated successfully').waitFor();
  await page.getByRole('button', { name: 'Audit', exact: true }).click();
  const audit = page.getByRole('dialog', { name: 'Vendor Audit' });
  await audit.getByText('Created').waitFor();
  await audit.getByText('Updated').waitFor();
  await audit.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText('Vendor confirmed successfully').waitFor();
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await page.getByText('Vendor deactivated successfully').waitFor();

  // Closing an edited unsaved form requires an explicit discard decision.
  await labelInput(page, 'Vendor Name').fill('Unsaved change');
  await page.getByRole('button', { name: 'Close vendor editor' }).click();
  const discard = page.getByRole('dialog', { name: 'Discard vendor changes' });
  await discard.getByRole('button', { name: 'Continue editing' }).click();
  await page.getByRole('button', { name: 'Close vendor editor' }).click();
  await page.getByRole('dialog', { name: 'Discard vendor changes' }).getByRole('button', { name: 'Discard changes' }).click();
  await page.getByText(uniqueCode).waitFor();
  await page.getByRole('button', { name: uniqueCode, exact: true }).click();
  await assert(await labelInput(page, 'Vendor Name').inputValue() === 'Vendor Master E2E', 'Discard changed persisted Vendor data');
  await assert(pageErrors.length === 0, `Browser console page errors: ${pageErrors.join('; ')}`);
  console.log(`Vendor Master browser workflow passed: ${uniqueCode}`);
} catch (error) {
  console.error('Vendor Master browser workflow failed:', error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fixture.close();
}
