import assert from 'node:assert/strict';
import { decodeStockSnapshotUpload } from '../inventory/snapshot-upload.js';
import { ingestPartnerStockFile } from '../inventory/partner-file.js';
const base64 = Buffer.from('external_sku,external_location_id,available\nA,L,2\n').toString('base64');
assert.equal(decodeStockSnapshotUpload({ fileName: 'snapshot.csv', base64 }).bytes.toString('base64'), base64);
for (const fileName of [undefined, {}, '../snapshot.csv', 'C:\\snapshot.csv', 'snapshot.csv\0', 'snapshot.exe']) assert.throws(() => decodeStockSnapshotUpload({ fileName, base64 }), TypeError);
for (const encoding of [undefined, {}, '', '%%%%', base64 + '\n', 'Zh==', 'a'.repeat(13_333_340)]) assert.throws(() => decodeStockSnapshotUpload({ fileName: 'snapshot.json', base64: encoding }), TypeError);
for (const rows of [[null], [[]], [{ external_sku: {}, external_location_id: 'L', available: 1 }], [{ external_sku: 'A', external_location_id: 'L', available: 2 }, { external_sku: 'A', external_location_id: 'L', available: 3 }]]) {
  await assert.rejects(ingestPartnerStockFile({ tenantId: 'fixture', accountId: 'fixture', fileName: 'snapshot.json', bytes: Buffer.from(JSON.stringify(rows)) }), TypeError);
}
console.log('PASS snapshot upload: canonical bounded base64, safe filename, malformed row and ambiguous duplicate mapping rejection before database access.');

for (const fileName of ['snapshot.json', 'snapshot.csv']) {
  const bytes = fileName.endsWith('.json') ? Buffer.from(JSON.stringify([{ external_sku: 'A', external_location_id: 'L', available: 2 }])) : Buffer.from('external_sku,external_location_id,available\nA,L,2\n');
  await assert.rejects(ingestPartnerStockFile({ tenantId: 'fixture', accountId: 'fixture', fileName, bytes }), error => error.status === 501 && error.code === 'SNAPSHOT_ORDERING_CONTRACT_UNVERIFIED');
}
