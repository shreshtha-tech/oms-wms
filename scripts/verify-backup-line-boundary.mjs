import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { boundedBackupLines } from './mongo-backup-lines.mjs';
async function collect(chunks, limit) {
  const output = [];
  for await (const line of boundedBackupLines(Readable.from(chunks), limit)) output.push(line);
  return output;
}
assert.deepEqual(await collect([Buffer.from('first\r'), Buffer.from('\n\nlast')], 10), ['first', '', 'last']);
const utf8 = Buffer.from('é漢\n');
assert.deepEqual(await collect([utf8.subarray(0, 1), utf8.subarray(1, 3), utf8.subarray(3)], 5), ['é漢']);
assert.deepEqual(await collect([Buffer.from('12345678\n')], 8), ['12345678']);
await assert.rejects(collect([Buffer.from('1234'), Buffer.from('56789\n')], 8), /parsing limit/);
await assert.rejects(collect([Buffer.from([0xc3, 0x28, 10])], 8), /encoded data/);
let read = 0;
let closed = false;
async function* endless() { try { while (true) { read++; yield Buffer.from('1234'); } } finally { closed = true; } }
await assert.rejects(async () => { for await (const line of boundedBackupLines(endless(), 8)) void line; }, /parsing limit/);
assert.equal(read, 3);
assert.equal(closed, true, 'Oversized line closes upstream iteration');
console.log('PASS: backup line byte cap before decode, chunked UTF-8, CRLF/empty/final lines, exact boundary, invalid encoding and upstream cleanup');
