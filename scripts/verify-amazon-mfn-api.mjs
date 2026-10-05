import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../api/amazon-mfn.js';
import { find, getMode, insert, remove } from '../api/mongo.js';

if (process.env.MONGODB_URI) throw new Error('Run this verifier without a configured MongoDB database.');
assert.equal(getMode(), 'memory');

const call = async (method, body = {}, query = {}) => {
  const response = { code: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, body, query }, response);
  return response;
};

const config = await call('GET', {}, { entity: 'config' });
assert.equal(config.code, 200);
assert.equal(config.body[0].interface_status, 'Not Configured');
assert.equal(config.body[0].access_key_configured, false);
assert.equal(config.body[0].secret_key_configured, false);
assert.equal((await find('amazon_mfn_config', {})).length, 0, 'GET config must not persist a default record');
const marketplaceEndpoints = await call('GET', {}, { entity: 'marketplaces' });
assert.equal(marketplaceEndpoints.body.India.endpoint, 'https://sellingpartnerapi-eu.amazon.com');
assert.equal(marketplaceEndpoints.body.UAE.endpoint, 'https://sellingpartnerapi-eu.amazon.com');
assert.equal(marketplaceEndpoints.body.US.endpoint, 'https://sellingpartnerapi-na.amazon.com');

const legacy = await insert('amazon_mfn_config', {
  access_key: 'LEGACY-AUDIT-ACCESS', secret_key: 'LEGACY-AUDIT-SECRET',
  mws_token: 'LEGACY-AUDIT-TOKEN', panel_password: 'LEGACY-AUDIT-PASSWORD',
  interface_status: 'Configured',
});
const redacted = await call('GET', {}, { entity: 'config' });
assert.equal(redacted.body[0].legacy_secret_values_present, true);
assert.equal(redacted.body[0].interface_status, 'Configuration Recorded - Connector Not Configured', 'A legacy configured label is not proof of a live connector.');
for (const value of ['LEGACY-AUDIT-ACCESS', 'LEGACY-AUDIT-SECRET', 'LEGACY-AUDIT-TOKEN', 'LEGACY-AUDIT-PASSWORD']) {
  assert.doesNotMatch(JSON.stringify(redacted.body), new RegExp(value));
}
for (const field of ['access_key', 'secret_key', 'mws_token', 'panel_password']) assert.equal(Object.hasOwn(redacted.body[0], field), false);
assert.equal(redacted.body[0].access_key_configured, false, 'A legacy plaintext credential is not a configured secure secret.');
await remove('amazon_mfn_config', legacy.id);

await insert('generic_records', { module: 'location', location_code: 'AUD-AMAZON-WH', location_name: 'Amazon Audit Warehouse', status: 'Active' });
const channel = await insert('channels', { channel_code: 'AUD-AMAZON-CHANNEL', fulfilment_status: 'Online', channel_configured: 'Yes' });
const configuration = await call('PUT', { action: 'save-config', region: 'US', channel_name: 'Audit Seller',
  channel_code: 'AUD-AMAZON-CHANNEL',
  channel_type: 'Amazon US & Other Countries', country_code: 'US', endpoint: 'https://mws.amazonservices.com',
  marketplace_id: 'ATVPDKIKX0DER', seller_id: 'AUDIT-SELLER', developer_id: '123456', developer_name: 'Audit Developer',
  order_fulfillment_wh: 'Amazon Audit Warehouse', single_warehouse: true, order_sync: false, return_sync: false,
  inventory_sync: false, access_key: 'NEW-AUDIT-ACCESS', secret_key: 'NEW-AUDIT-SECRET',
  mws_token: 'NEW-AUDIT-TOKEN', panel_password: 'NEW-AUDIT-PASSWORD' });
assert.equal(configuration.code, 200);
assert.equal(configuration.body.interface_status, 'Configuration Recorded - Connector Not Configured');
assert.equal(configuration.body.access_key_configured, false);
assert.equal(configuration.body.legacy_secret_values_present, false);
assert.equal(configuration.body.endpoint, 'https://sellingpartnerapi-na.amazon.com');
for (const field of ['access_key', 'secret_key', 'mws_token', 'panel_password']) assert.equal(Object.hasOwn(configuration.body, field), false);
const savedConfig = (await find('amazon_mfn_config', {}))[0];
for (const value of ['NEW-AUDIT-ACCESS', 'NEW-AUDIT-SECRET', 'NEW-AUDIT-TOKEN', 'NEW-AUDIT-PASSWORD']) {
  assert.doesNotMatch(JSON.stringify(savedConfig), new RegExp(value));
}
const channelAfterSave = (await find('channels', { id: channel.id }))[0];
assert.equal(channelAfterSave.fulfilment_status, 'Not Connected');
assert.equal(channelAfterSave.channel_configured, 'No');

const providerActions = [
  'verify-otp', 'submit-inventory', 'process-feed', 'reconcile-inventory', 'pull-orders', 'confirm-order',
  'prefetch-label', 'pack-order', 'process-label', 'ship-order', 'cancel-order', 'pull-returns',
];
const originalError = console.error;
console.error = () => {};
try {
  for (const action of providerActions) {
    const response = await call('POST', { action });
    assert.equal(response.code, 503, `${action} must not simulate a successful provider action`);
    assert.match(response.body.error, /no live connector is configured or tested/i);
  }
} finally {
  console.error = originalError;
}

for (const entity of ['mappings', 'orders', 'inventoryLogs', 'returns', 'shipments']) {
  assert.deepEqual((await call('GET', {}, { entity })).body, [], `${entity} must remain empty without real provider data`);
}
for (const collection of ['amazon_mfn_inventory_logs', 'amazon_mfn_orders', 'amazon_mfn_returns', 'amazon_mfn_shipments', 'sale_orders', 'fulfillment_orders']) {
  assert.equal((await find(collection, {})).length, 0, `${collection} must not receive simulated records`);
}

const ui = await readFile(new URL('../src/eretail/modules/AmazonMFNWorkflow.tsx', import.meta.url), 'utf8');
assert.match(ui, /no live Amazon (?:SP-API )?connector/i);
assert.match(ui, /no feed is sent and no published quantity is inferred locally/i);
assert.match(ui, /legacy Amazon credential values/i);
assert.match(ui, /Not accepted here; secure connector setup is pending/);
assert.match(ui, /Login with Amazon \(OAuth 2\.0\)/);
assert.match(ui, /SP-API Endpoint/);
assert.doesNotMatch(ui, /value=\{secrets\./);
assert.doesNotMatch(ui, /Amazon inventory Feed processed successfully/);
console.log('PASS Amazon MFN: new secrets are not stored, legacy secrets are redacted and flagged, config saves as connector-not-configured, and provider operations return 503 without simulated artifacts.');
