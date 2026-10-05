import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
import { buildFile } from '../src/lib/exporters.ts';
const cells = ['=1+1', '+1+1', '-1+1', '@SUM(1)', ' \t=1+1', 'safe\t=1+1', 'safe\n=1+1', 'quoted "field"', 'comma,value', 'ordinary', -5, 0];
for (const format of ['csv', 'txt']) {
  const result = buildFile(format, 'Controlled export', { columns: ['=header', 'value'], rows: cells.map(value => ['identity', value]) });
  const decoded = parse(result.content, { delimiter: format === 'csv' ? ',' : '\t' });
  assert.equal(decoded.length, cells.length + 1);
  assert.equal(decoded.every(row => row.length === 2), true, 'embedded separators/newlines cannot create extra cells or rows');
  assert.equal(decoded[0][0], "'=header");
  for (const [index, value] of cells.entries()) {
    const expected = typeof value === 'string' && /^\s*[=+\-@]/.test(value) ? `'${value}` : String(value);
    assert.equal(decoded[index + 1][1], expected);
  }
}
const html = buildFile('html', '<script>fixture</script>', { columns: ['<img src=x onerror=fixture>'], rows: [['<svg onload=fixture>']] }).content;
assert.equal(html.includes('<script>'), false);
assert.equal(html.includes('<img src=x'), false);
assert.equal(html.includes('<svg onload='), false);
assert.equal(html.includes('&lt;svg'), true);
console.log('PASS CSV/TXT export boundary: formula text guards, header guards, quoted embedded separators/newlines, preserved numeric values and HTML escaping. Spreadsheet-client behavior remains a separate acceptance layer.');
