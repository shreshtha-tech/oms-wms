import assert from 'node:assert/strict';
import express from 'express';
import { inventoryPrivate } from '../inventory/http.js';

const previous = process.env.INVENTORY_ALLOWED_TENANT_ID;
process.env.INVENTORY_ALLOWED_TENANT_ID = 'test-tenant';
const app = express();
app.use(express.json());
app.use('/api/inventory-sync', inventoryPrivate);
const server = app.listen(0, '127.0.0.1');
try {
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/inventory-sync/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantId: 'test-tenant', masterSkuId: 'sku', locationId: 'location',
      eventKey: 'arbitrary-stock-credit', eventType: 'receipt', source: 'caller',
      delta_on_hand: 100,
    }),
  });
  assert.equal(response.status, 501);
  assert.match((await response.json()).error, /Direct inventory events are unavailable/);
  const missingKey = await fetch(`http://127.0.0.1:${server.address().port}/api/inventory-sync/central/adjustments`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ masterSkuId: 'sku', locationId: 'location', mode: 'delta', quantity: 1, reason: 'test' }),
  });
  assert.equal(missingKey.status, 400);
  assert.match((await missingKey.json()).error, /request ID/i);
  console.log('PASS direct caller-supplied inventory event route fails closed');
} finally {
  await new Promise(resolve => server.close(resolve));
  if (previous === undefined) delete process.env.INVENTORY_ALLOWED_TENANT_ID;
  else process.env.INVENTORY_ALLOWED_TENANT_ID = previous;
}
