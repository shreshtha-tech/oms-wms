import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../api/mp-inventory-log.js';
import { find, getMode, insert } from '../api/mongo.js';

if (process.env.MONGODB_URI) throw new Error('Run this verifier without a configured MongoDB database.');
assert.equal(getMode(), 'memory');

const call = async (method, body = {}, query = {}) => {
  const response = { code: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, body, query }, response);
  return response;
};

const metadata = await call('GET');
assert.equal(metadata.code, 200);
assert.deepEqual(metadata.body.pageSizes, [20, 50, 100, 200]);
assert.deepEqual(metadata.body.channelTypes, []);
assert.deepEqual(metadata.body.channels, []);
assert.deepEqual(metadata.body.brands, []);

const missingFilters = await call('POST', { REQ_SEARCH_FLAG: true });
assert.equal(missingFilters.code, 400);
assert.equal(missingFilters.body.error, 'interface is mandatory.');
const emptySearch = await call('POST', {
  REQ_SEARCH_FLAG: true,
  intFace: '1',
  channelType: 'marketplace-under-test',
  crtDate: '01/01/2026 - 10/01/2026',
  date: '01/01/2026 - 10/01/2026',
  rows: 20,
  page: 1,
});
assert.equal(emptySearch.code, 200);
assert.deepEqual(emptySearch.body.gridModel, []);

await insert('generic_records', {
  module: 'mp-inventory-log', code: 'AUDIT-MP-IN-RANGE', sku_code: 'AUDIT-SKU-1', channel_sku: 'AUDIT-CHANNEL-SKU',
  channel_product_id: 'AUDIT-PRODUCT-1', channel_type: 'marketplace-under-test', channel_code: 'AUDIT-CHANNEL',
  inventory: 5, request_date: '2026-01-05T12:00:00.000Z', updated_date: '2026-01-08T14:00:00.000Z', status: 'Success',
});
await insert('generic_records', {
  module: 'mp-inventory-log', code: 'AUDIT-MP-OUT-OF-RANGE', sku_code: 'AUDIT-SKU-2', channel_sku: 'AUDIT-CHANNEL-SKU',
  channel_product_id: 'AUDIT-PRODUCT-2', channel_type: 'marketplace-under-test', channel_code: 'AUDIT-CHANNEL',
  inventory: 9, request_date: '2026-03-05T12:00:00.000Z', updated_date: '2026-03-08T14:00:00.000Z', status: 'Success',
});
const datedSearch = await call('POST', {
  REQ_SEARCH_FLAG: true,
  searchType: '1',
  intFace: '1',
  channelType: 'marketplace-under-test',
  crtDate: '01/01/2026 - 10/01/2026',
  date: '01/01/2026 - 10/01/2026',
  rows: 20,
  page: 1,
});
assert.equal(datedSearch.code, 200);
assert.deepEqual(datedSearch.body.gridModel.map(row => row.code), ['AUDIT-MP-IN-RANGE']);
const archival = await call('POST', {
  REQ_SEARCH_FLAG: true,
  searchType: '2',
  intFace: '1',
  channelType: 'marketplace-under-test',
  crtDate: '01/01/2026 - 10/01/2026',
  date: '01/01/2026 - 10/01/2026',
});
assert.equal(archival.code, 501);
assert.match(archival.body.error, /archive service is connected/i);

for (const body of [
  { action: 'ingest' },
  { action: 'ingest', sku: 'SKU-MP-VERIFY', channelSku: 'CH-SKU', channelProductId: 'PID-1', channelType: 'marketplace-under-test', channelCode: 'CHANNEL-VERIFY', inventory: 7 },
  { action: 'force-push', ids: [1] },
  { action: 'retransmit', ids: [1] },
  { action: 'manual-push', channelType: 'marketplace-under-test', skuPushData: 'SKU-MP-VERIFY' },
  { action: 'export', searchType: '1' },
]) {
  const result = await call('POST', body);
  assert.equal(result.code, 501, `Expected ${body.action} to fail closed`);
  assert.match(result.body.error, /unavailable|requires a configured and verified integration/i);
}

assert.equal((await find('generic_records', { module: 'mp-inventory-log' })).length, 2, 'Only explicit isolated fixtures should exist');
assert.equal((await find('generic_records', { module: 'pending-report' })).length, 0);
const ui = await readFile(new URL('../src/eretail/wms/MpInventoryLog.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(ui, /Pending Report created/);
assert.match(ui, /Archival \(unavailable\)/);
console.log('PASS MP Inventory Log: empty configured source stays empty; ingest, push, retransmit and export fail closed without fabricated logs or report jobs.');
