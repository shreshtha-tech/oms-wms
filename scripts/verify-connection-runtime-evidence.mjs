import assert from 'node:assert/strict';
import { connectionReadiness } from '../inventory/connection-readiness.js';

const now = new Date().toISOString();
const stale = new Date(Date.now() - 21 * 60_000).toISOString();
const future = new Date(Date.now() + 60_000).toISOString();
for (const platform of ['shopify', 'woocommerce']) {
  const account = { platform, status: 'active', connection_state: 'verified', verified_at: now, settings: {} };
  const runtime = { workerHealthy: true, activeMappings: 2 };
  for (const lastInventoryWriteAt of [undefined, stale, future, 'invalid']) {
    const result = connectionReadiness(account, { ...runtime, lastInventoryWriteAt });
    assert.equal(result.inventoryWrite.state, 'starting', `${platform}: configuration must not prove recent publication`);
    if (lastInventoryWriteAt === future || lastInventoryWriteAt === 'invalid') assert.equal(result.inventoryWrite.lastConfirmedAt, null);
  }
  assert.equal(connectionReadiness(account, { ...runtime, lastInventoryWriteAt: now }).inventoryWrite.state, 'partial');
  assert.equal(connectionReadiness(account, { ...runtime, workerHealthy: false, lastInventoryWriteAt: now }).inventoryWrite.state, 'blocked');
  assert.equal(connectionReadiness(account, { ...runtime, activeMappings: 0, lastInventoryWriteAt: now }).inventoryWrite.state, 'blocked');
}
const pollAccount = { platform: 'shopify', status: 'inactive', connection_state: 'verified', verified_at: now, settings: { orderObservationEnabled: true } };
for (const orderCursorAt of [stale, future, 'invalid']) {
  assert.notEqual(connectionReadiness(pollAccount, { workerHealthy: true, orderCursorAt }).orders.state, 'live');
}
assert.equal(connectionReadiness(pollAccount, { workerHealthy: true, orderCursorAt: now }).orders.state, 'partial');
assert.match(connectionReadiness(pollAccount, { workerHealthy: true, orderCursorAt: now }).orders.detail, /does not enqueue reservation work/);
for (const verified_at of ['invalid', future]) {
  const result = connectionReadiness({ platform: 'woocommerce', verified_at });
  assert.equal(result.credentials.state, 'not_verified');
  assert.equal(result.credentials.lastConfirmedAt, null);
}
console.log('PASS runtime evidence: configuration, missing/stale/invalid/future evidence, completed publication, worker/mapping gates and order cursor freshness.');

for (const platform of ['shopify', 'woocommerce']) {
  const account = { platform, status: 'inactive', connection_state: 'verified', verified_at: now, settings: { orderObservationEnabled: true, webhooksReady: true } };
  for (const lastWebhookAt of [undefined, 'invalid', future]) assert.equal(connectionReadiness(account, { lastWebhookAt }).orders.state, 'starting');
  const confirmed = connectionReadiness(account, { lastWebhookAt: now });
  assert.equal(confirmed.orders.state, 'partial');
  assert.equal(confirmed.returns.lastConfirmedAt, null, 'order delivery does not prove a refund callback');
}
