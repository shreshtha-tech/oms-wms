import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readRestoreManifest } from './mongo-restore-manifest.mjs';
const row = { name: 'owned', file: '0.ndjson', count: 0, sha256: 'a'.repeat(64) };
const manifest = collections => ({ format: 'dmills-canonical-ejson-v1', complete: true, collections });
const parse = value => readRestoreManifest(Readable.from([Buffer.from(JSON.stringify(value))]));
assert.deepEqual(await parse(manifest([row])), manifest([row]));
for (const invalid of [null, [], { ...row, name: '' }, { ...row, name: 'system.fixture' }, { ...row, name: 'a\0b' }, { ...row, file: '../0.ndjson' }, { ...row, count: -1 }, { ...row, count: '0' }, { ...row, count: 0.5 }, { ...row, sha256: 'invalid' }]) await assert.rejects(parse(manifest([invalid])), /Invalid collection/);
await assert.rejects(parse(manifest([row, { ...row, name: 'other' }])), /Invalid collection/);
await assert.rejects(parse(manifest([{ ...row, count: Number.MAX_SAFE_INTEGER }, { ...row, name: 'other', file: '1.ndjson', count: 1 }])), /supported range/);
await assert.rejects(parse(manifest(Array(10001).fill(row))), /bounded/);
let closed = false;
async function* oversized() { try { for (let i = 0; i < 66; i++) yield Buffer.alloc(65536, 32); } finally { closed = true; } }
await assert.rejects(readRestoreManifest(oversized()), /4 MiB/);
assert.equal(closed, true);
console.log('PASS: bounded manifest read, metadata validation, duplicate files, total-count overflow and upstream cleanup');
