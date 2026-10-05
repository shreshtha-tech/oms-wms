import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../api/transhipment-old.js';
import { find, getMode, insert } from '../api/mongo.js';

if (process.env.MONGODB_URI) throw new Error('Run this verifier without a configured MongoDB database.');
assert.equal(getMode(), 'memory');

const call = async (method, body = {}) => {
  const response = {
    code: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await handler({ method, body }, response);
  return response;
};

const metadata = await call('GET');
assert.equal(metadata.code, 200);
assert.deepEqual(metadata.body.tabs.map(([, label]) => label), [
  'Pending To Receive', 'Received', 'QC Passed', 'QC Failed', 'Packed', 'Dispatch Completed', 'All',
]);
assert.deepEqual(metadata.body.pageSizes, [20, 50, 100, 200]);
assert.deepEqual(metadata.body.importFields, [
  'orderNo', 'docNo', 'docDate', 'senderName', 'receiverName', 'itemName', 'itemDescription', 'batchNo', 'expectedReceiveDate',
]);

const clientId = 'AUDIT-TRANS-CLIENT';
await insert('partners', { type: 'Client', client_id: clientId, client_name: 'Isolated verifier', status: 'Active', is_active: true });
const csv = [
  'orderNo,docNo,senderName,receiverName,itemName,batchNo',
  'AUDIT-TRANS-ORDER,DOC-AUDIT,Sender,Receiver,SKU-AUDIT,BATCH-AUDIT',
].join('\n');
const imported = await call('POST', {
  action: 'import', clientId, fileName: 'audit-transhipment.csv', fileContent: csv,
});
assert.equal(imported.code, 201);
assert.equal(imported.body.imported, 1);

const listing = await call('POST', { status: 'pending', orderNo: 'AUDIT-TRANS-ORDER', page: 1, rows: 20 });
assert.equal(listing.code, 200);
assert.equal(listing.body.records, 1);
const row = listing.body.gridModel[0];
assert.equal(row.orderNo, 'AUDIT-TRANS-ORDER');
assert.equal(row.status, 'pending');

const duplicate = await call('POST', {
  action: 'import', clientId, fileName: 'audit-transhipment.csv', fileContent: csv,
});
assert.equal(duplicate.code, 409);

for (const body of [
  { action: 'ingest', orderNo: 'MUST-NOT-BE-CREATED' },
  { action: 'transition', from: 'pending', to: 'received', ids: [row.id] },
  { action: 'transition', from: 'received', to: 'qcPass', ids: [row.id], qcFailedQty: 1 },
  { action: 'transition', from: 'packed', to: 'dispatched', ids: [row.id] },
  { action: 'pod', ids: [row.id], pod: 'delivered', delDate: '2026-09-29' },
]) {
  const result = await call('POST', body);
  assert.equal(result.code, 501, `${body.action} must stay unavailable without Central Inventory lifecycle integration`);
  assert.match(result.body.error, /Central Inventory/i);
}

const exported = await call('POST', { action: 'export', status: 'pending' });
assert.equal(exported.code, 200, 'CSV export is based on recorded logistics rows');
assert.equal(exported.body.rows.length, 1);
assert.equal(exported.body.rows[0].orderNo, 'AUDIT-TRANS-ORDER');

const stored = await find('generic_records', { module: 'transhipment-old' });
assert.equal(stored.length, 1, 'Only the explicit isolated CSV row should exist');
assert.equal(stored[0].status, 'pending', 'Blocked transitions and POD must not mutate imported status');
const ui = await readFile(new URL('../src/eretail/wms/TranshipmentOld.tsx', import.meta.url), 'utf8');
assert.match(ui, /CSV import and export manage logistics records only/);
assert.doesNotMatch(ui, /qcFailedQty:\s*1/);
console.log('PASS Transhipment Old: explicit CSV import/search/export work in isolated memory; direct fake ingest and stock lifecycle transitions fail closed without changing status.');
