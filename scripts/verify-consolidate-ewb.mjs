import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Use only an isolated in-memory store; never mutate a configured tenant.
process.env.MONGODB_URI = '';
process.env.DMILLS_REQUIRE_PERSISTENCE = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { find, insert } = await import('../api/mongo.js');
const consolidateEwb = (await import('../api/consolidate-ewb.js')).default;

async function invoke(method, body = {}) {
  const response = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    setHeader() {},
  };
  await consolidateEwb({ method, body, query: {}, headers: {} }, response);
  return response;
}

const order = await insert('fulfillment_orders', {
  order_no: 'SAFE-CEWB-ORDER', delivery_no: 'SAFE-CEWB-DELIVERY',
  invoice_no: 'SAFE-CEWB-INVOICE', ewb_no: 'SAFE-EWB', status: 'Packed', qty: 1,
});
const legacy = await insert('generic_records', {
  module: 'consolidate-ewb', code: 'OLD-CEWB', cewb_no: 'OLD-CEWB',
  delivery_ids: [order.id], created_date: '2026-01-01T00:00:00.000Z',
});

const meta = await invoke('GET');
assert.equal(meta.payload.available, false);
assert.equal(meta.payload.dataTrust, 'legacy-unverified');

const generateSearch = await invoke('POST', { action: 'search', tab: 'generate', rows: 20, page: 1 });
assert.equal(generateSearch.statusCode, 200);
assert.equal(generateSearch.payload.rows[0].ewbNo, 'SAFE-EWB');
assert.equal(generateSearch.payload.rows[0].documentNo, 'SAFE-CEWB-INVOICE');

const historySearch = await invoke('POST', { action: 'search', tab: 'history', rows: 20, page: 1 });
assert.equal(historySearch.payload.trust, 'legacy-unverified');
assert.equal(historySearch.payload.rows[0].trust, 'legacy-unverified');
const linked = await invoke('POST', { action: 'deliveries', id: legacy.id, cewbNo: legacy.cewb_no });
assert.equal(linked.payload.transmitLogDTOs[0].documentNo, 'SAFE-CEWB-INVOICE');
assert.equal(linked.payload.trust, 'legacy-unverified');

for (const body of [
  { action: 'generate', ids: [order.id], transMode: '1', vehicleNo: 'SAFE-VEHICLE' },
  { action: 'regenerate', id: legacy.id, transMode: '1', vehicleNo: 'SAFE-VEHICLE', reason: '4', remarks: 'Safe test' },
]) {
  const result = await invoke('POST', body);
  assert.equal(result.statusCode, 501);
  assert.match(result.payload.error, /verified government e-way bill connector/);
}

assert.equal((await find('fulfillment_orders', { id: order.id }))[0].consolidate_ewb_no, undefined);
assert.deepEqual(await find('generic_records', { module: 'consolidate-ewb' }), [legacy]);
const ui = await readFile(new URL('../src/eretail/modules/ConsolidateEwb.tsx', import.meta.url), 'utf8');
assert.match(ui, /CEWB generation and regeneration are unavailable/);
assert.doesNotMatch(ui, /action: 'generate'|Print CEWB|Re-generate CEWB/);
console.log('PASS Consolidate EWB: enquiry and legacy links are read-only, generation fails closed, and no CEWB number or history row is fabricated.');
