import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../api/ajio.js';
import { find, getMode, insert } from '../api/mongo.js';

if (process.env.MONGODB_URI) throw new Error('Run this verifier without a configured MongoDB database.');
assert.equal(getMode(), 'memory');

const call = async (method, body = {}, query = {}) => {
  const response = {
    code: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await handler({ method, body, query }, response);
  return response;
};

const configRead = await call('GET', {}, { entity: 'config' });
assert.equal(configRead.code, 200);
assert.equal(configRead.body[0].interface_status, 'Not Configured');
assert.equal((await find('ajio_config')).length, 0, 'reading blank AJIO config must not write a default document');

for (const entity of ['mappings', 'backorders', 'orders', 'deliveries', 'invoices', 'manifests']) {
  const result = await call('GET', {}, { entity });
  assert.equal(result.code, 200);
  assert.deepEqual(result.body, []);
}

const secret = 'AUDIT-AJIO-SECRET-NEVER-STORED';
await insert('generic_records', {
  module: 'location', location_code: 'AUDIT-AJIO-LOC', location_name: 'Audit AJIO location', status: 'Active',
});
const savedConfig = await call('PUT', {
  action: 'save-config', seller_id: 'DV123', password: secret, channel_name: 'AJIO audit',
  order_fulfillment_wh: 'Audit AJIO location', b2b_invoice_series: 'AUDIT', is_b2b: true,
  sku_sync: 'Pull', sku_create: 'Moderate', scan_lpn_on_picking: true,
  lpn_reuse_after_ship: true, unpack_access: false, order_sync: false, return_sync: false,
});
assert.equal(savedConfig.code, 200);
assert.equal(savedConfig.body.password_configured, true);
assert.equal(savedConfig.body.interface_status, 'Credentials Saved - Connection Not Tested');
assert.equal(savedConfig.body.message, 'Configuration saved locally; AJIO connection not tested.');
assert.equal(Object.hasOwn(savedConfig.body, 'password'), false);
assert.equal((await find('ajio_config')).some(row => Object.values(row).includes(secret)), false, 'AJIO credentials must not be persisted as plaintext');

const sku = await insert('skus', { sku_code: 'AUDIT-AJIO-SKU', name: 'Isolated verifier SKU' });
const mapping = await insert('ajio_sku_mappings', {
  article_code: 'AUDIT-ARTICLE', channel_sku_code: 'AUDIT-CHANNEL-SKU', channel_product_id: 'PROD~VARIANT',
  mapping_status: 'Un-Mapped', inventory_sync: 'Success', published_inventory: 88, last_sync: '2026-09-01T00:00:00Z',
});
const mappingRead = await call('GET', {}, { entity: 'mappings' });
assert.equal(mappingRead.body[0].inventory_sync, 'Not Connected');
assert.equal(mappingRead.body[0].published_inventory, null);
assert.equal(mappingRead.body[0].last_sync, null);
const mapped = await call('PUT', {
  action: 'map-sku', id: mapping.id, sku_code: sku.sku_code,
  channel_sku_code: 'AUDIT-CHANNEL-SKU', channel_product_id: 'PROD~VARIANT',
});
assert.equal(mapped.code, 200);
assert.equal(mapped.body.mapping_status, 'Mapped');
assert.equal(mapped.body.inventory_sync, 'Not Connected');
assert.equal(mapped.body.published_inventory, null);
assert.equal(mapped.body.last_sync, null);
assert.equal(mapped.body.message, 'SKU mapping saved locally; AJIO connection not tested.');

for (const action of [
  'inventory-sync', 'inventory-reconciliation', 'prefetch-label', 'pull-backorders', 'release-po',
  'generate-picklist', 'scan', 'close-box', 'delivery-split', 'pack', 'request-manifest', 'cancel', 'handover',
]) {
  const result = await call('POST', { action });
  assert.equal(result.code, 503, `${action} must stay disabled without a connector and central transaction`);
  assert.match(result.body.error, /live AJIO|Central Inventory/i);
}

assert.equal((await find('ajio_orders')).length, 0);
assert.equal((await find('ajio_deliveries')).length, 0);
assert.equal((await find('ajio_invoices')).length, 0);
assert.equal((await find('ajio_manifests')).length, 0);
const source = await readFile(new URL('../src/eretail/modules/AJIOWorkflow.tsx', import.meta.url), 'utf8');
assert.match(source, /not connected to a live seller account/i);
assert.match(source, /mapped locally/i);
assert.match(source, /not connected to a live seller account or Central Inventory workflow/i);
assert.doesNotMatch(source, /result\.message\s*\|\|\s*ok/);
assert.match(source, /AJIO shipping label/i);
assert.match(source, /AJIO manifest download/i);
assert.match(source, /is unavailable until the AJIO connector and document service/i);
assert.doesNotMatch(source, /requestDownload/);
assert.doesNotMatch(source, /All pending items scanned into/);
assert.doesNotMatch(await readFile(new URL('../api/ajio.js', import.meta.url), 'utf8'), /async function (reserveBackorders|scanItem|packDelivery|requestManifest)/);
console.log('PASS AJIO: blank config reads are side-effect free, credentials are not stored, local SKU mappings show no feed success, and every provider-dependent action returns 503 without creating fulfillment artifacts.');
