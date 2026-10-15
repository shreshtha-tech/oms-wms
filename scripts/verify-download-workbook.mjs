import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import ts from 'typescript';
if (process.env.MONGODB_URI) throw new Error('Run this fixture without a configured MongoDB.');
const { default: handler } = await import('../api/downloads.js');
const call = async (method, body = {}, query = {}) => {
  const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method, body, query, user: { username: 'fixture-actor' } }, res);
  return res;
};
const data = { columns: ['SKU', 'Quantity', 'Note'], rows: [['00123', 0, '=1+1'], ['<script>alert(1)</script>', 3, null]] };
const response = await call('POST', { action: 'generate-xlsx', title: 'Fixture report', baseName: '../fixture', data, exported_by: 'spoofed' });
assert.equal(response.code, 201);
assert.equal(response.body.exported_by, 'fixture-actor');
const bytes = Buffer.from(response.body.content, 'base64');
assert.equal(bytes.subarray(0, 2).toString(), 'PK');
assert.equal(response.body.size, bytes.length);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(bytes);
assert.deepEqual(workbook.worksheets[0].getRow(2).values.slice(1), data.rows[0]);
assert.equal(workbook.worksheets[0].getCell('A3').value, data.rows[1][0]);
assert.equal(workbook.worksheets[0].getCell('C2').type, ExcelJS.ValueType.String);
const history = await call('GET');
assert.equal(history.body[0].content, undefined, 'History metadata must omit base64 file content.');
const detail = await call('GET', {}, { id: String(response.body.id) });
assert.equal(detail.body.content, response.body.content);
const loadTs = async path => {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};
const { downloadBlob } = await loadTs('../src/lib/downloadBlob.ts');
for (const filename of ['old.pdf', 'old.xlsx']) {
  assert.throws(() => downloadBlob({ filename, content: '<html>Old placeholder export</html>', mime: 'text/html' }), /Generate the export again/);
}
assert.throws(() => downloadBlob({ filename: 'missing.txt' }), /content is unavailable/);
assert.deepEqual(Buffer.from(await downloadBlob(detail.body).arrayBuffer()), bytes);
const { buildFile } = await loadTs('../src/lib/exporters.ts');
for (const format of ['html']) {
  const file = buildFile(format, '<img src=x onerror=alert(1)>', data);
  assert.equal(file.content.includes('<script>'), false);
  assert.equal(file.content.includes('<img'), false);
  assert.ok(file.content.includes('&lt;script&gt;'));
}
assert.ok(buildFile('csv', 'Fixture', { columns: ['Value'], rows: [['line\rbreak']] }).content.includes('"line\rbreak"'));
assert.equal(buildFile('csv', 'Fixture', { columns: ['Value'], rows: [['=2+2'], [' +cmd'], ['-HYPERLINK()'], ['@cmd'], [-5]] }).content, "Value\n'=2+2\n' +cmd\n'-HYPERLINK()\n'@cmd\n-5");
assert.throws(() => buildFile('excel', 'Fixture', data), /download service/);
assert.equal((await call('POST', { action: 'generate-xlsx', title: 'Bad fixture', data: { columns: ['A'], rows: [[{ formula: '1+1' }]] } })).code, 400);
const oversizedContent = 'x'.repeat(10 * 1024 * 1024 + 1);
const tooLarge = await call('POST', { filename: 'too-large.txt', format: 'TXT', module: 'fixture', row_count: 1, size: Buffer.byteLength(oversizedContent), content: oversizedContent, mime: 'text/plain' });
assert.equal(tooLarge.code, 413, 'Oversized content must not be inserted into download history.');
assert.equal((await call('GET')).body.length, 1);
console.log('PASS XLSX: real workbook bytes, typed cells, literal formula text, authenticated actor, metadata-only history, exact detail re-download and HTML escaping.');
