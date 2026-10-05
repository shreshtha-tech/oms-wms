import assert from 'node:assert/strict';
import { connectionReadiness } from '../inventory/connection-readiness.js';

const now = new Date().toISOString();
const shopify = {
  platform: 'shopify', status: 'active', connection_state: 'verified', verified_at: now,
  settings: { orderObservationEnabled: true, webhooksReady: true },
};

const activeButUnverified = connectionReadiness({ ...shopify, verified_at: null });
assert.notEqual(activeButUnverified.orders.state, 'live', 'an active flag must not prove provider access');
assert.notEqual(activeButUnverified.inventoryWrite.state, 'live', 'an active flag must not prove a healthy stock writer');

const verifiedShopify = connectionReadiness(shopify, { workerHealthy: true, activeMappings: 4, lastWebhookAt: now, lastInventoryReadAt: now, lastInventoryWriteAt: now });
assert.equal(verifiedShopify.orders.state, 'live');
assert.equal(verifiedShopify.returns.state, 'partial');
assert.match(verifiedShopify.returns.detail, /return requests.*not connected/i);
assert.equal(verifiedShopify.inventoryRead.state, 'partial');
assert.equal(verifiedShopify.inventoryWrite.state, 'partial');

const noOrderFeed = connectionReadiness({ ...shopify, settings: {} }, { workerHealthy: true });
assert.equal(noOrderFeed.orders.state, 'setup_required', 'valid credentials without an intake configuration are not a live order feed');
const pollStarting = connectionReadiness({ ...shopify, settings: { orderObservationEnabled: true, webhooksReady: false } }, { workerHealthy: true });
assert.equal(pollStarting.orders.state, 'starting', 'a worker that has not completed its first poll is starting, not live');

const woocommerceReadOnly = connectionReadiness({
  platform: 'woocommerce', status: 'inactive', connection_state: 'verified', verified_at: now,
  settings: { orderObservationEnabled: true, webhooksReady: true },
}, { workerHealthy: false, lastWebhookAt: now });
assert.equal(woocommerceReadOnly.orders.state, 'live', 'signed read-only order webhooks do not require inventory activation');
assert.equal(woocommerceReadOnly.returns.state, 'partial');
assert.equal(woocommerceReadOnly.inventoryWrite.state, 'blocked');

const amazon = connectionReadiness({
  platform: 'amazon', status: 'active', connection_state: 'verified', verified_at: now,
  settings: { observationEnabled: true, lastObservationAt: now },
}, { workerHealthy: true, activeMappings: 10 });
assert.equal(amazon.orders.state, 'setup_required', 'Amazon queue intake is not activated by API credentials alone');
assert.equal(amazon.inventoryWrite.state, 'blocked', 'the UI activation path is not implemented for Amazon');

const meesho = connectionReadiness({
  platform: 'meesho', status: 'inactive', connection_state: 'report_observed', verified_at: null, settings: {},
});
assert.equal(meesho.orders.state, 'partial');
assert.equal(meesho.inventoryWrite.state, 'blocked');

console.log('PASS connection readiness: credentials, feed setup, worker evidence, partial returns, Amazon queue/activation limits, and Meesho report-only intake are distinguished.');

assert.match(verifiedShopify.inventoryRead.detail, /mismatch may remain/i);
assert.match(verifiedShopify.inventoryWrite.detail, /require separate mapping-level evidence/i);
