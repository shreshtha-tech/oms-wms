import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/reportPrint.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { reportPrintHtml } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const payload = '</title></td><script>window.opener.location="https://example.invalid"</script><img src=x onerror=alert(1)>';
const html = reportPrintHtml({ title: payload, warehouse: payload, from: payload, to: payload,
  data: { columns: [payload, 'Quantity'], rows: [[payload, 0], ['A&B < "quoted" \'name\'', null]] } });
assert.equal(html.includes('<script>'), false);
assert.equal(html.includes('<img'), false);
assert.equal(html.includes(payload), false);
assert.equal((html.match(/&lt;script&gt;/g) || []).length, 7, 'all dynamic print fields must be escaped');
assert.ok(html.includes('<td>0</td>'));
assert.ok(html.includes('<td></td>'));
assert.ok(html.includes('A&amp;B &lt; &quot;quoted&quot; &#39;name&#39;'));
console.log('PASS report print: titles, filters, headings and database cells render as text; zero and empty values are retained.');
