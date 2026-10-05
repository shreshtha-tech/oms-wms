import assert from 'node:assert/strict';
import handler from '../api/common-import.js';
import { find } from '../api/mongo.js';

if (process.env.MONGODB_URI) throw new Error('Run this verifier with an isolated, unconfigured memory store.');
const call = async (method, body = {}, query = {}) => {
  const response = { code: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method, body, query }, response);
  return response;
};

const metadata = await call('GET');
assert.equal(metadata.body.importTypes.length, 47);
assert.deepEqual(metadata.body.pageSizes, [20, 50, 100, 200]);
assert.equal((await call('POST', { action: 'import', importType: '-1' })).body.error, 'Please Select Import Type');
assert.equal((await call('POST', { action: 'import', importType: '30', subtype: '0', classification: '1' })).body.error, 'No file chosen to import.');
const config = await call('POST', { action: 'config', importType: '46' });
assert.equal(config.body.notes[0], '**Note : 1 Asn can have maximum of rows : 1200');
assert.equal((await call('POST', { action: 'config', importType: '67' })).body.templateHidden, true);

const template = await call('POST', { action: 'template', importType: '30' });
assert.equal(template.code, 501);
assert.match(template.body.error, /storage is not connected/i);
const attempted = await call('POST', { action: 'import', importType: '30', subtype: '0', classification: '1', fileName: 'orders.csv', content: 'ROW-1,ORDER-1\nROW-2,ORDER-FAIL,invalid' });
assert.equal(attempted.code, 501);
assert.match(attempted.body.error, /No business processor is connected/i);
assert.equal((await find('admin_records', { type: 'common-import-batch' })).length, 0);
assert.equal((await find('admin_records', { type: 'common-import-detail' })).length, 0);
assert.equal((await call('POST', { action: 'search', fromDate: '29/09/2026', toDate: '29/09/2026' })).code, 501);
assert.equal((await call('POST', { action: 'details', batchId: 'fake-batch' })).code, 501);
console.log('PASS Common Import: metadata and validation remain available; template/import report unavailable service and create no false file or processed batch.');
