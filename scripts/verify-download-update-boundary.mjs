import assert from 'node:assert/strict';
delete process.env.MONGODB_URI; delete process.env.MONGODB_DB;
process.env.NODE_ENV = 'test'; process.env.DMILLS_REQUIRE_PERSISTENCE = 'false';
const { default: handler } = await import('../api/downloads.js');
const { insert, findOne } = await import('../api/mongo.js');
const row = await insert('downloads', { filename: 'fixture.csv', content: 'original', exported_by: 'fixture-actor', status: 'Completed' });
async function invoke(body) {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ method: 'PUT', body, headers: {}, user: { username: 'fixture-actor' } }, response);
  return response;
}
for (const fields of [{ content: {} }, { row_count: -1 }, { size: 1.5 }, { status: 'Completed' }, { exported_by: 'forged' }, { created_at: 'forged' }, { unknown: true }, {}]) assert.equal((await invoke({ id: row.id, ...fields })).code, 400);
assert.equal((await invoke({ id: row.id, content: 'é'.repeat(6 * 1024 * 1024) })).code, 413);
assert.deepEqual(await findOne('downloads', { id: row.id }), row);
assert.equal((await invoke({ id: row.id + 100000, filename: 'missing.csv' })).code, 404);
const valid = await invoke({ id: row.id, filename: 'updated.csv', row_count: 2 });
assert.equal(valid.code, 200); assert.equal(valid.body.filename, 'updated.csv');
assert.equal(valid.body.exported_by, 'fixture-actor');
const foreign = { method: 'PUT', body: { id: row.id, filename: 'stolen.csv' }, headers: {}, user: { username: 'other-actor' } };
const denied = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
await handler(foreign, denied);
assert.equal(denied.code, 404);
assert.equal((await findOne('downloads', { id: row.id })).filename, 'updated.csv');
async function request(method, username, query = {}, body = {}) {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, user: { username }, query, body, headers: {} }, response);
  return response;
}
assert.equal((await request('GET', 'other-actor', { id: row.id })).code, 404);
assert.deepEqual((await request('GET', 'other-actor')).body, []);
assert.equal((await request('DELETE', 'other-actor', {}, { id: row.id })).code, 404);
assert.equal((await request('DELETE', 'fixture-actor', {}, { all: true })).code, 403);
assert.ok(await findOne('downloads', { id: row.id }));
const created = await request('POST', 'other-actor', {}, { filename: 'own.csv', format: 'CSV', module: 'Fixture', row_count: 1, size: 7, content: 'fixture', mime: 'text/csv', exported_by: 'fixture-actor', status: 'Processing' });
assert.equal(created.code, 201);
assert.equal(created.body.exported_by, 'other-actor');
assert.equal(created.body.status, 'Stored');
assert.equal(created.body.source, 'client-submitted');
assert.equal(created.body.content, undefined, 'The create response returns metadata without echoing the file bytes');
assert.equal((await request('POST', 'other-actor', {}, { filename: 'unsafe.html', format: 'HTML', module: 'Fixture', row_count: 1, size: 0, content: '<script>', mime: 'text/html' })).code, 400);
assert.equal((await request('GET', 'fixture-actor', { id: created.body.id })).code, 404);
assert.equal((await request('DELETE', 'other-actor', {}, { id: created.body.id })).code, 200);
assert.equal((await request('GET', 'other-actor', { id: created.body.id })).code, 404);
console.log('PASS: download updates reject malformed, excessive and protected fields; missing IDs return 404; valid metadata preserves provenance.');
