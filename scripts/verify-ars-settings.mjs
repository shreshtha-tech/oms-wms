import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright';

const base = process.env.ERETAIL_BASE_URL || 'http://127.0.0.1:3011';
const username = process.env.ERETAIL_TEST_USERNAME || '';
const password = process.env.ERETAIL_TEST_PASSWORD || '';
const mongoUri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || '';
assert.ok(username && password, 'ARS Settings verification requires a signed-in isolated administrator.');
assert.ok(/^codexqa_[a-z0-9_]+$/i.test(dbName), 'ARS Settings verification must use a generated codexqa MongoDB database.');
const mongoUrl = new URL(mongoUri);
assert.ok(['mongodb:', 'mongodb+srv:'].includes(mongoUrl.protocol)
  && ['localhost', '127.0.0.1', '::1'].includes(mongoUrl.hostname),
'ARS Settings verification only permits a loopback MongoDB server.');
const appUrl = new URL(base);
assert.ok(['localhost', '127.0.0.1', '::1'].includes(appUrl.hostname), 'ARS Settings verification requires a local application.');

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
await mongo.connect();
const db = mongo.db(dbName);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', (response) => { if (response.url().includes('/api/') && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
page.setDefaultTimeout(12000);
const main = () => page.locator('[data-screen-frame]:not([aria-hidden="true"]) main').last();
const toggleFor = (label) => main().locator('label').filter({ hasText: label }).getByRole('button').first();
const baseline = {
  entity: 'settings', enable_ars: true, calculation_hour: 2, puf_tuf: '1',
  ros_lifetime: true, ros_12_weeks: true, ros_6_weeks: false, ros_1_month: false, ros_2_weeks: false,
  custom_periods: ['', '', ''], custom_period_enabled: [false, false, false],
};
const persistedSettings = async (id) => {
  const row = await db.collection('ars_settings').findOne({ id });
  delete row._id;
  return row;
};

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Login Id').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('**/app/dashboard');

  const baselineResponse = await page.request.put(`${base}/api/ars`, { data: baseline });
  const baselineSaved = await baselineResponse.json();
  assert.equal(baselineResponse.status(), 200, JSON.stringify(baselineSaved));
  assert.equal(baselineSaved.updated_by, username);
  assert.ok(baselineSaved.updated_date);

  const invalidPayloads = [
    { ...baselineSaved, entity: 'settings', custom_period_enabled: [true, false, false], custom_periods: ['', '', ''] },
    { ...baselineSaved, entity: 'settings', custom_period_enabled: [false, false, false], custom_periods: ['1', '', ''] },
    { ...baselineSaved, entity: 'settings', ros_lifetime: true, ros_12_weeks: false, ros_6_weeks: false, ros_1_month: false, ros_2_weeks: false, custom_period_enabled: [false, false, false] },
  ];
  const expectedValidation = [
    'Please Enter Days in Textbox to Make it Active.',
    'Please Enter Days between 2 and 365',
    'Minimum 2 ROS Calculation parameters should be Active',
  ];
  for (let index = 0; index < invalidPayloads.length; index += 1) {
    const response = await page.request.put(`${base}/api/ars`, { data: invalidPayloads[index] });
    assert.equal(response.status(), 400);
    assert.equal((await response.json()).error, expectedValidation[index]);
  }
  assert.deepEqual(await persistedSettings(baselineSaved.id), baselineSaved, 'Rejected settings payloads must leave the saved record unchanged.');

  await page.goto(`${base}/app/procurement/ars/settings`, { waitUntil: 'domcontentloaded' });
  await main().getByText('ARS Setting', { exact: true }).waitFor();
  const hours = await main().getByLabel('ROS Calculation Hour').locator('option').allTextContents();
  assert.equal(hours.length, 24);
  assert.deepEqual([hours[0].trim(), hours[23].trim()], ['0', '23']);
  assert.deepEqual((await main().getByLabel('PUF/TUF').locator('option').allTextContents()).map((value) => value.trim()), ['Round Up', 'Round Down']);
  for (const label of ['Enable ARS', 'Life Time', '12 Weeks', '6 Weeks', '1 Month', '2 Weeks']) assert.equal(await toggleFor(label).count(), 1, `${label} toggle is present.`);
  for (let index = 1; index <= 3; index += 1) {
    assert.equal(await main().getByLabel(`Custom Period ${index} Days`).count(), 1);
    assert.equal(await main().getByLabel(`Custom Period ${index} Active`).count(), 1);
  }

  await toggleFor('12 Weeks').click();
  await main().getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Minimum 2 ROS Calculation parameters should be Active', { exact: true }).waitFor();
  await toggleFor('12 Weeks').click();
  await main().getByLabel('Custom Period 1 Active').check();
  await main().getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Please Enter Days in Textbox to Make it Active.', { exact: true }).waitFor();

  await main().getByLabel('Custom Period 1 Days').fill('10');
  await main().getByLabel('Custom Period 2 Active').check();
  await main().getByLabel('Custom Period 2 Days').fill('30');
  await main().getByLabel('Custom Period 3 Active').check();
  await main().getByLabel('Custom Period 3 Days').fill('365');
  await main().getByLabel('ROS Calculation Hour').selectOption('23');
  await main().getByLabel('PUF/TUF').selectOption({ label: 'Round Down' });
  const saveResponse = page.waitForResponse((response) => response.url().includes('/api/ars') && response.request().method() === 'PUT' && response.status() === 200);
  await main().getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await (await saveResponse).json();
  assert.equal(saved.enable_ars, true);
  assert.equal(saved.calculation_hour, 23);
  assert.equal(saved.puf_tuf, '2');
  assert.equal(saved.custom_periods?.[0], '10');
  assert.equal(saved.custom_periods?.[1], '30');
  assert.equal(saved.custom_periods?.[2], '365');
  assert.deepEqual(saved.custom_period_enabled, [true, true, true]);
  assert.equal(saved.updated_by, username);
  assert.ok(saved.updated_date);
  await page.getByText('Configuration updated Successfully', { exact: true }).waitFor();

  const persisted = await persistedSettings(saved.id);
  assert.deepEqual(persisted, saved, 'MongoDB readback must match the saved ARS settings response.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await main().getByText('ARS Setting', { exact: true }).waitFor();
  assert.equal(await main().getByLabel('ROS Calculation Hour').inputValue(), '23');
  assert.equal(await main().getByLabel('PUF/TUF').inputValue(), '2');
  assert.equal(await main().getByLabel('Custom Period 1 Days').inputValue(), '10');
  assert.equal(await main().getByLabel('Custom Period 2 Days').inputValue(), '30');
  assert.equal(await main().getByLabel('Custom Period 3 Days').inputValue(), '365');
  assert.equal(await main().getByLabel('Custom Period 1 Active').isChecked(), true);
  assert.equal(await main().getByLabel('Custom Period 2 Active').isChecked(), true);
  assert.equal(await main().getByLabel('Custom Period 3 Active').isChecked(), true);
  assert.equal((await toggleFor('Enable ARS').innerText()).trim(), 'ON');
  assert.equal((await toggleFor('12 Weeks').innerText()).trim(), 'ON');
  assert.equal((await toggleFor('Life Time').innerText()).trim(), 'ON');
  if (errors.length) throw new Error(`Browser/API errors: ${errors.join(' | ')}`);
  console.log('PASS ARS Settings: real sign-in, exact controls/options, browser and API validation, authenticated actor/date, MongoDB readback, reload persistence, and clean console/API checks.');
} finally {
  await browser.close();
  await mongo.close();
}
