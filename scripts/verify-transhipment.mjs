import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../api/transhipment.js';
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
assert.deepEqual(metadata.body.tabs.map(([id]) => id), ['pending', 'received', 'qcPass', 'qcFail', 'shipped', 'displayAll']);
assert.deepEqual(metadata.body.pageSizes, [15, 50, 100, 200, 500, 1000]);

const fixture = await insert('generic_records', {
  module: 'transhipment', code: 'AUDIT-TRANS-LPN', docNo: 'AUDIT-TRANS-DOC', status: 'pending',
});
const search = await call('POST', { status: 'pending', lpn: 'AUDIT-TRANS', page: 1, rows: 15 });
assert.equal(search.code, 200);
assert.deepEqual(search.body.gridModel.map(row => row.id), [fixture.id]);

for (const body of [
  { action: 'ingest', lpn: 'MUST-NOT-BE-CREATED', status: 'pending' },
  { action: 'import', fileName: 'unverified.csv', fileContent: 'lpn\\nMUST-NOT-BE-CREATED' },
  { action: 'receive', lpn: 'AUDIT-TRANS-LPN', pass: true },
  { action: 'qc', lpn: 'AUDIT-TRANS-LPN', pass: true },
  { action: 'undo-qc', lpn: 'AUDIT-TRANS-LPN' },
  { action: 'reverse-receiving', lpn: 'AUDIT-TRANS-LPN' },
  { action: 'scan-manifest', manifestNo: 'AUDIT-MANIFEST', status: '1' },
  { action: 'print', docType: '1', docOrLpnNo: 'AUDIT-TRANS-LPN' },
  { action: 'export', filters: { status: 'pending' } },
  { action: 'manifest', manifestNo: 'AUDIT-MANIFEST' },
  { action: 'edit', id: fixture.id, lpn: 'AUDIT-TRANS-LPN' },
]) {
  const result = await call('POST', body);
  assert.equal(result.code, 501, `${body.action} must stay unavailable without its stock/document service`);
  assert.match(result.body.error, /Central Inventory|document services/i);
}

const udf = await call('POST', { action: 'udf', id: fixture.id, udf1: 'AUDIT-METADATA' });
assert.equal(udf.code, 200, 'metadata-only UDF editing remains available');
assert.equal(udf.body.message, 'User-defined fields saved.');
const persisted = await find('generic_records', { module: 'transhipment' });
assert.equal(persisted.length, 1, 'Unavailable actions must not ingest rows or jobs');
assert.equal(persisted[0].status, 'pending', 'Unavailable lifecycle actions must not mutate status');
assert.equal(persisted[0].udf1, 'AUDIT-METADATA');

const ui = await readFile(new URL('../src/eretail/wms/Transhipment.tsx', import.meta.url), 'utf8');
assert.match(ui, /This screen does not change stock/);
assert.match(ui, /Import is unavailable/);
assert.match(ui, /User Defined Fields.*?'udf'/s);
assert.match(ui, /Transhipment order editing is unavailable/);
assert.match(ui, /Export is unavailable/);
assert.doesNotMatch(ui, /Pending Report created:/);
console.log('PASS Transhipment: enquiry and metadata-only UDF edits work in isolated memory; stock, manifest, print, export, and ingest actions return 501 without fake state changes.');
