import assert from 'node:assert/strict';
import { readTallyCatalog } from '../inventory/tally-bridge.js';

const valid = '<ENVELOPE><!-- <ignored> --><BODY><COMPANY NAME="A &amp; B"/><STOCKITEM NAME="SKU"><GUID>id</GUID></STOCKITEM></BODY></ENVELOPE>';
assert.equal(readTallyCatalog(valid).items[0].id, 'id');
assert.equal(readTallyCatalog('<ENVELOPE><BODY><![CDATA[<not-a-tag>]]></BODY></ENVELOPE>').voucherCount, 0);
assert.equal(readTallyCatalog('<ENVELOPE><COMPANY NAME="A > B"/></ENVELOPE>').companies.length, 1);
for (const xml of ['', '<ENVELOPE><BODY>', '<ENVELOPE><BODY></ENVELOPE>', '<ENVELOPE/><ENVELOPE/>', '<!DOCTYPE x SYSTEM "file:///private/fixture"><ENVELOPE/>', '<!DOCTYPE x [<!ENTITY a "fixture">]><ENVELOPE>&a;</ENVELOPE>', '<ENVELOPE>' + '<N>'.repeat(128) + '</N>'.repeat(128) + '</ENVELOPE>', '<ENVELOPE>' + '<N/>'.repeat(100001) + '</ENVELOPE>', '<ENVELOPE>' + '€'.repeat(1_000_001) + '</ENVELOPE>']) {
  assert.throws(() => readTallyCatalog(xml), /Invalid Tally XML export|structural limits|response envelope/);
}
console.log('PASS Tally XML boundary: valid catalog/comments/CDATA/quoted markup, malformed/multiple roots, entities/DTD, depth/tag limits and UTF-8 byte size.');
