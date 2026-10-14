import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.MONGODB_URI = '';
process.env.MONGODB_DB = 'exports_test';
process.env.DMILLS_REQUIRE_PERSISTENCE = 'false';
process.env.NODE_ENV = 'test';
const mongo = await import('../api/mongo.js');
const { default: handler } = await import('../api/exports.js');
const legacy = await mongo.insert('generic_records', { module: 'pending-report', code: 'LEGACY', status: 'SUCCESS', content: '=HYPERLINK("fixture")' });
const before = (await mongo.find('generic_records', { module: 'pending-report' })).length;
const call = async (method, body, query = {}) => {
  const res = { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, body, query }, res);
  return res;
};
const meta = await call('GET', null, { action: 'meta' });
assert.equal(meta.statusCode, 200);
assert.equal(meta.body.available, false);
assert.deepEqual(meta.body.columns, ['Report ID','Status','Report Request Date','Report Names','Report Complete Date','Download','Error Msg']);
const list = await call('GET');
assert.equal(list.statusCode, 503);
assert.equal(list.body.error, 'REPORT_SERVICE_UNAVAILABLE');
const seed = await call('POST', { action: 'seed', reportID: 'FORGED', status: 'SUCCESS', content: 'forged' });
assert.equal(seed.statusCode, 403);
assert.equal(seed.body.error, 'REPORT_SEED_DISABLED');
for (const action of ['download', 'force']) {
  const response = await call('POST', { action, reportID: legacy.code, uuId: `EXPORT-${legacy.id}` });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, 'REPORT_SERVICE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(response.body), /HYPERLINK|fixture/);
}
assert.equal((await call('POST', { action: 'unknown' })).statusCode, 400);
assert.equal((await call('PUT')).statusCode, 405);
assert.equal((await mongo.find('generic_records', { module: 'pending-report' })).length, before);
assert.equal((await mongo.findOne('generic_records', { id: legacy.id })).content, '=HYPERLINK("fixture")');
const ui = await readFile(new URL('../src/eretail/admin/ExportsReplica.tsx', import.meta.url), 'utf8');
assert.match(ui, /Report generation and historical downloads are unavailable/);
assert.match(ui, /catch \(error\) \{ setRows\(\[\]\); setAvailable\(false\)/);
assert.match(ui, /available && \/success\/i\.test\(report\.status\)/);
console.log('PASS Exports boundary: no client-declared success, legacy content disclosure or false downloadable report');
