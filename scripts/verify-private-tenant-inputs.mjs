import assert from 'node:assert/strict';
import express from 'express';
import { inventoryPrivate } from '../inventory/http.js';

process.env.INVENTORY_ALLOWED_TENANT_ID = 'controlled-tenant';
const app = express();
app.use(express.json());
app.use(inventoryPrivate);
// Sentinel inspects middleware only; it performs no business mutation and does
// not establish authentication/role authorization for the server mount.
let accepted = 0;
app.all('/tenant-input-probe', (req, res) => { accepted++; res.json({ tenant: req.inventoryTenantId }); });
const server = await new Promise((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
const endpoint = `http://127.0.0.1:${server.address().port}/tenant-input-probe`;
try {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const tenantId of ['foreign-tenant', {}, ['controlled-tenant'], null]) {
      const response = await fetch(`${endpoint}?tenantId=controlled-tenant`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId }) });
      assert.equal(response.status, 403, `${method} must reject conflicting/malformed body tenant`);
    }
    const foreignQuery = await fetch(`${endpoint}?tenantId=foreign-tenant`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: 'controlled-tenant' }) });
    assert.equal(foreignQuery.status, 403, `${method} must independently check query tenant`);
    const valid = await fetch(endpoint, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).tenant, 'controlled-tenant');
    assert.match(valid.headers.get('cache-control'), /no-store/);
  }
  assert.equal(accepted, 4, 'denied requests must not reach downstream handlers');
  assert.equal((await fetch(`${endpoint}?tenantId=controlled-tenant&tenantId=foreign-tenant`)).status, 403);
  const privateMarker = 'controlled-private-file-content';
  const upload = await fetch(`http://127.0.0.1:${server.address().port}/partner-stock-file`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: 'fixture', fileName: 'snapshot.csv', base64: Buffer.from(`external_sku,external_location_id,available\n"${privateMarker}`).toString('base64') }) });
  assert.equal(upload.status, 400);
  const uploadError = await upload.text();
  assert.ok(!uploadError.includes(privateMarker), 'parser details must not echo uploaded contents');
  assert.match(uploadError, /Stock snapshot could not be accepted/);
  const unsupported = await fetch(`http://127.0.0.1:${server.address().port}/partner-stock-file`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: 'fixture', fileName: 'snapshot.csv', base64: Buffer.from('external_sku,external_location_id,available\nA,L,2\n').toString('base64') }) });
  assert.equal(unsupported.status, 501, 'a structurally valid file does not prove provider ordering authority');
  assert.equal((await unsupported.json()).error, 'SNAPSHOT_ORDERING_CONTRACT_UNVERIFIED');
  delete process.env.INVENTORY_ALLOWED_TENANT_ID;
  assert.equal((await fetch(endpoint)).status, 503);
  assert.equal(accepted, 4);
  console.log('PASS private tenant middleware HTTP: all mutation methods, independent body/query checks, malformed/duplicate values, configured tenant propagation, no-store and missing configuration. Authentication and role authorization are separate gates.');
} finally { await new Promise(resolve => server.close(resolve)); }
