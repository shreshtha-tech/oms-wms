import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Use only an isolated in-memory store; never mutate a configured tenant.
process.env.MONGODB_URI = '';
process.env.DMILLS_REQUIRE_PERSISTENCE = '';
process.env.INVENTORY_DATABASE_URL = '';
process.env.INVENTORY_ALLOWED_TENANT_ID = '';
const { find, insert } = await import('../api/mongo.js');
const dispatchCheckpoint = (await import('../api/dispatch-checkpoint.js')).default;

async function invoke(method, body = {}, query = {}) {
  const response = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    setHeader() {},
  };
  await dispatchCheckpoint({ method, body, query, headers: {} }, response);
  return response;
}

const load = await insert('generic_records', {
  module: 'dispatch-checkpoint', code: 'UWH905010', loadId: 'UWH905010',
  vehicle_no: 'SAFE-VEHICLE', status: 'In Process', statusCode: '5', isB2bCode: '0',
  shipments: [{ id: 1, scanTrackingNo: 'SAFE-TRACK' }], invoices: [],
});
const meta = await invoke('GET');
assert.equal(meta.payload.available, false);
assert.equal(meta.payload.dataTrust, 'legacy-unverified');
assert.deepEqual(meta.payload.pageSizes, [20, 50, 100, 200]);

const search = await invoke('POST', { REQ_SEARCH_FLAG: true, loadId: load.loadId, rows: 20, page: 1 });
assert.equal(search.statusCode, 200);
assert.equal(search.payload.gridModel[0].loadId, load.loadId);
assert.equal(search.payload.gridModel[0].trust, 'legacy-unverified');
assert.equal(search.payload.gridModel[0].totalLpn, '', 'unknown target LPN total must remain blank');
const detail = await invoke('GET', {}, { loadId: load.loadId });
assert.equal(detail.payload.row.loadId, load.loadId);
assert.equal(detail.payload.row.trust, 'legacy-unverified');

for (const action of ['export', 'vehicle-scan', 'tracking-scan', 'remove-shipment', 'invoice-scan', 'lpn-scan', 'close-invoice', 'approve', 'complete']) {
  const result = await invoke('POST', { action, loadId: load.loadId, gridDataLen: 1 });
  assert.equal(result.statusCode, 501, `${action} must fail closed`);
}

assert.deepEqual(await find('generic_records', { module: 'dispatch-checkpoint' }), [load]);
assert.deepEqual(await find('generic_records', { module: 'pending-report' }), []);
const ui = await readFile(new URL('../src/eretail/wms/DispatchCheckpoint.tsx', import.meta.url), 'utf8');
assert.match(ui, /Dispatch Checkpoint is read-only/);
assert.match(ui, /dispatch-checkpoint-legacy-unverified\.csv/);
assert.doesNotMatch(ui, /Complete Loading|Add New|action: 'vehicle-scan'|action: 'tracking-scan'/);
console.log('PASS Dispatch Checkpoint: legacy enquiry/detail remain read-only, all physical or provider actions fail closed, and CSV export creates no server-side job.');
