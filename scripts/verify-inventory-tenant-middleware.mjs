import assert from 'node:assert/strict';
import { inventoryTenantBoundary } from '../inventory/tenant-boundary.js';
const prior = process.env.INVENTORY_ALLOWED_TENANT_ID;
try {
  process.env.INVENTORY_ALLOWED_TENANT_ID = 'tenant-a';
  for (const supplied of ['tenant-b', ['tenant-a'], { $ne: null }, null, 0, true]) {
    for (const location of ['body', 'query']) {
      let called = false;
      const response = { set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      inventoryTenantBoundary({ [location]: { tenantId: supplied } }, response, () => { called = true; });
      assert.equal(response.code, 403); assert.equal(called, false);
    }
  }
  for (const input of [{}, { body: { tenantId: 'tenant-a' } }, { query: { tenantId: 'tenant-a' } }]) {
    const req = { ...input, inventoryTenantId: 'tenant-b' };
    let called = false;
    const headers = {};
    inventoryTenantBoundary(req, { set(key, value) { headers[key] = value; } }, () => { called = true; });
    assert.equal(called, true); assert.equal(req.inventoryTenantId, 'tenant-a');
    assert.match(headers['Cache-Control'], /no-store/);
  }
  delete process.env.INVENTORY_ALLOWED_TENANT_ID;
  let called = false;
  const response = { set() {}, status(code) { this.code = code; return this; }, json() {} };
  inventoryTenantBoundary({}, response, () => { called = true; });
  assert.equal(response.code, 503); assert.equal(called, false);
} finally { if (prior === undefined) delete process.env.INVENTORY_ALLOWED_TENANT_ID; else process.env.INVENTORY_ALLOWED_TENANT_ID = prior; }
console.log('PASS: foreign/malformed tenant inputs reject; configured tenant overrides request state; missing configuration fails closed.');
