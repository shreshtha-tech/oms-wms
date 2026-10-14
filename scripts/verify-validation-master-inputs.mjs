import assert from 'node:assert/strict';
delete process.env.MONGODB_URI;
delete process.env.MONGODB_DB;
process.env.NODE_ENV = 'test';
process.env.DMILLS_REQUIRE_PERSISTENCE = 'false';
const { default: handler } = await import('../api/lottable-validations.js');
const { find } = await import('../api/mongo.js');
const labels = ['Unique Batch Nos', 'Lottable2', 'Mfg Date', 'Lottable 04', 'Batch No', 'Recv Date', 'Lottable 07'];
const body = { lotValCode: 'INPUT', description: 'Original', isDefault: true, lottables: labels.map(label => ({ label, mandatory: false, outward: false, length: '50', mask: '' })) };
async function invoke(method, input) {
  const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method, body: input, headers: {} }, response);
  return response;
}
assert.equal((await invoke('POST', body)).code, 201);
const before = await find('generic_records', { module: 'lottable-validation' });
for (const value of ['false', 'true', 0, 1, null, {}]) assert.equal((await invoke('POST', { ...body, lotValCode: 'REJECT', isDefault: value })).code, 400);
for (const id of [undefined, 0, -1, 1.5, 'bad', { $ne: null }]) assert.equal((await invoke('PUT', { ...body, description: 'Must not change', id })).code, 400);
assert.deepEqual(await find('generic_records', { module: 'lottable-validation' }), before);
const saved = await invoke('PUT', { ...body, id: before[0].id, description: 'Updated', isDefault: false });
assert.equal(saved.code, 200);
assert.equal(saved.body.row.description, 'Updated');
assert.equal(saved.body.row.isDefault, false);
console.log('PASS: malformed default flags and PUT identities reject without changes; valid explicit update persists.');
