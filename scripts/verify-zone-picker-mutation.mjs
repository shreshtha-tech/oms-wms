import assert from 'node:assert/strict';

process.env.MONGODB_URI = '';
process.env.MONGODB_DB = 'zone_picker_test';
process.env.DMILLS_REQUIRE_PERSISTENCE = 'false';
process.env.NODE_ENV = 'test';
const mongo = await import('../api/mongo.js');
const { default: handler } = await import('../api/wms-zones.js');
const picker = await mongo.insert('generic_records', { module: 'user-enquiry', code: 'OWNED-PICKER', name: 'Picker fixture', description: '' });
const zone = await mongo.insert('generic_records', { module: 'wms-zone', code: 'OWNED-ZONE', linked_pickers: [] });
const other = await mongo.insert('generic_records', { module: 'other-module', code: 'OTHER', linked_pickers: [] });
const call = async body => {
  const response = { statusCode: 200, body: undefined, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'PUT', body }, response);
  return response;
};
for (const body of [
  { action: 'link-pickers', id: true, pickers: [picker.code] },
  { action: 'link-pickers', id: zone.id, pickers: 'OWNED-PICKER' },
  { action: 'link-pickers', id: zone.id, pickers: [''] },
  { action: 'link-pickers', id: zone.id, pickers: Array(201).fill(picker.code) },
  { action: 'link-pickers', id: zone.id, pickers: ['UNKNOWN-PICKER'] },
]) assert.equal((await call(body)).statusCode, 400);
assert.deepEqual((await mongo.findOne('generic_records', { id: zone.id })).linked_pickers, []);
assert.equal((await call({ action: 'link-pickers', id: other.id, pickers: [picker.code] })).statusCode, 404);
assert.equal((await call({ action: 'link-pickers', id: zone.id, pickers: [picker.code] })).statusCode, 200);
assert.deepEqual((await mongo.findOne('generic_records', { id: zone.id })).linked_pickers, [picker.code]);
assert.equal((await call({ action: 'unlink-pickers', id: zone.id, pickers: [picker.code] })).statusCode, 200);
assert.deepEqual((await mongo.findOne('generic_records', { id: zone.id })).linked_pickers, []);
const legacy = await mongo.insert('generic_records', { module: 'wms-zone', code: 'LEGACY-ZONE', linked_pickers: picker.code });
assert.equal((await call({ action: 'link-pickers', id: legacy.id, pickers: [picker.code] })).statusCode, 409);
assert.equal((await mongo.findOne('generic_records', { id: legacy.id })).linked_pickers, picker.code);
const full = await mongo.insert('generic_records', { module: 'wms-zone', code: 'FULL-ZONE', linked_pickers: Array.from({ length: 1000 }, (_, i) => `P${i}`) });
assert.equal((await call({ action: 'link-pickers', id: full.id, pickers: [picker.code] })).statusCode, 413);
assert.equal((await mongo.findOne('generic_records', { id: full.id })).linked_pickers.length, 1000);
const duplicateFull = await mongo.insert('generic_records', { module: 'wms-zone', code: 'DUPLICATE-FULL', linked_pickers: Array(1000).fill('OLD') });
assert.equal((await call({ action: 'link-pickers', id: duplicateFull.id, pickers: [picker.code] })).statusCode, 413);
assert.equal((await mongo.findOne('generic_records', { id: duplicateFull.id })).linked_pickers.length, 1000);
const second = await mongo.insert('generic_records', { module: 'wms-zone', code: 'SECOND-ZONE', linked_pickers: [] });
const validLinks = [{ id: zone.id, zone: zone.code, picker: picker.code }, { id: second.id, zone: second.code, picker: picker.code }];
assert.equal((await call({ action: 'link-pickers-bulk', links: [...validLinks, validLinks[0]] })).statusCode, 400);
assert.equal((await call({ action: 'link-pickers-bulk', links: [{ ...validLinks[0], picker: 'UNKNOWN' }] })).statusCode, 400);
assert.equal((await call({ action: 'link-pickers-bulk', links: [validLinks[0], { ...validLinks[1], zone: 'WRONG' }] })).statusCode, 409);
assert.deepEqual((await mongo.findOne('generic_records', { id: zone.id })).linked_pickers, []);
assert.deepEqual((await mongo.findOne('generic_records', { id: second.id })).linked_pickers, []);
const committed = await call({ action: 'link-pickers-bulk', links: validLinks });
assert.equal(committed.statusCode, 200);
assert.deepEqual({ zones: committed.body.zones, links: committed.body.links }, { zones: 2, links: 2 });
assert.deepEqual((await mongo.findOne('generic_records', { id: zone.id })).linked_pickers, [picker.code]);
assert.deepEqual((await mongo.findOne('generic_records', { id: second.id })).linked_pickers, [picker.code]);
console.log('PASS zone-picker mutation: server validation, single-zone atomic guards and all-or-error memory batch');
