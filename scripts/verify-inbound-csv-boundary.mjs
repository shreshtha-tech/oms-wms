import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { parse } from 'csv-parse/browser/esm/sync';
const source = await readFile(new URL('../src/lib/inboundCsv.ts', import.meta.url), 'utf8');
const exports = {};
new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports, () => ({ parse }));
const file = text => ({ size: Buffer.byteLength(text), text: async () => text });
let read = false;
await assert.rejects(exports.readInboundCsv({ size: 1048577, text: async () => { read = true; return ''; } }), /at most 1 MiB/);
assert.equal(read, false, 'Reject oversized files before loading their content');
await assert.rejects(exports.readInboundCsv({ size: 1, text: async () => 'é'.repeat(524289) }), /at most 1 MiB/);
for (const count of [1, 200]) {
  const rows = await exports.readInboundCsv(file('sku_code,qty\n' + Array.from({ length: count }, (_, i) => `SKU-${i},1`).join('\n')));
  assert.equal(rows.length, count);
}
await assert.rejects(exports.readInboundCsv(file('sku_code,qty\n' + 'SKU,1\n'.repeat(201))), /Max 200/);
await assert.rejects(exports.readInboundCsv(file('sku_code,qty\n' + 'x'.repeat(40000) + ',1')), /Max Record Size/);
await assert.rejects(exports.readInboundCsv(file('sku_code,qty\n')), /no inbound lines/);
await assert.rejects(exports.readInboundCsv(file('other,qty\nSKU,1')), /must contain/);
for (const headers of ['sku_code,qty,qty', 'sku_code,qty, Qty ', 'sku_code,sku_code,qty']) {
  await assert.rejects(exports.readInboundCsv(file(`${headers}\nSKU-X,1,999`)), /duplicate column names/);
}
for (const quantity of ['0x10', '0b10', '1e2']) {
  await assert.rejects(exports.readInboundCsv(file(`sku_code,qty\nSKU-X,${quantity}`)), /decimal notation/);
}
for (const quantity of ['16', '0016', '+16', '16.0', '-1', '1.5']) {
  const rows = await exports.readInboundCsv(file(`sku_code,qty\nSKU-X,${quantity}`));
  assert.equal(rows[0].qty, quantity, 'Decimal whole values and row-level invalid quantities retain existing parsing behavior');
}
await assert.rejects(exports.readInboundCsv(file('sku_code,qty\n"unterminated,1')), /Quote Not Closed/);
assert.deepEqual(await exports.readInboundCsv(file('\ufeffsku_code,qty\r\n"SKU,quoted",2\r\n')), [{ sku_code: 'SKU,quoted', qty: '2' }]);
console.log('PASS: pre-read byte cap, actual UTF-8 cap, 200-row boundary, oversized record, duplicate-header and ambiguous integer-notation rejection, malformed/header/empty rejection and quoted BOM CSV');
