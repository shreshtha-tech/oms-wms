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
assert.equal(verifiedShopify.orders.state, 'partial');
assert.match(verifiedShopify.orders.detail, /does not recover missed reservation work/);
assert.equal(verifiedShopify.returns.state, 'partial');
assert.match(verifiedShopify.returns.detail, /return requests.*not connected/i);
assert.equal(verifiedShopify.inventoryRead.state, 'partial');
assert.equal(verifiedShopify.inventoryWrite.state, 'partial');
assert.deepEqual(Object.keys(verifiedShopify.capabilities),['AUTH','IDENTITY','CATALOG','LOCATION','LISTING','ORDER_FEED','RETURN_FEED','CANCELLATION','FULFILLMENT','INVENTORY_READ','INVENTORY_WRITE','INVENTORY_READBACK','WEBHOOK','POLLING','RECONCILIATION']);
assert.equal(verifiedShopify.capabilities.AUTH.state,'verified');
assert.equal(verifiedShopify.capabilities.ORDER_FEED.state,'partial');
assert.equal(verifiedShopify.capabilities.INVENTORY_READBACK.state,'unverified');
assert.equal(verifiedShopify.capabilities.RECONCILIATION.state,'unverified');
assert.equal(verifiedShopify.capabilities.WEBHOOK.state,'partial');

const noOrderFeed = connectionReadiness({ ...shopify, settings: {} }, { workerHealthy: true });
assert.equal(noOrderFeed.orders.state, 'setup_required', 'valid credentials without an intake configuration are not a live order feed');
const pollStarting = connectionReadiness({ ...shopify, settings: { orderObservationEnabled: true, webhooksReady: false } }, { workerHealthy: true });
assert.equal(pollStarting.orders.state, 'starting', 'a worker that has not completed its first poll is starting, not live');

const woocommerceReadOnly = connectionReadiness({
  platform: 'woocommerce', status: 'inactive', connection_state: 'verified', verified_at: now,
  settings: { orderObservationEnabled: true, webhooksReady: true },
}, { workerHealthy: false, lastWebhookAt: now });
assert.equal(woocommerceReadOnly.orders.state, 'partial', 'signed order webhooks lack general missed-event recovery');
assert.equal(woocommerceReadOnly.returns.state, 'partial');
assert.equal(woocommerceReadOnly.inventoryWrite.state, 'blocked');

const amazon = connectionReadiness({
  platform: 'amazon', status: 'active', connection_state: 'verified', verified_at: now,
  settings: { observationEnabled: true, lastObservationAt: now },
}, { workerHealthy: true, activeMappings: 10 });
assert.equal(amazon.orders.state, 'setup_required', 'Amazon queue intake is not activated by API credentials alone');
assert.equal(amazon.inventoryWrite.state, 'blocked', 'the UI activation path is not implemented for Amazon');

const flipkartBase = { platform: 'flipkart', status: 'inactive', connection_state: 'verified', verified_at: now, settings: { orderObservationEnabled: true, flipkartHistoryFrom: '1970-01-01T00:00:00.000Z', flipkartHistoryCompletedAt: now, lastFlipkartOrderObservationAt: now } };
const flipkartOrderAxisOnly = connectionReadiness(flipkartBase, { workerHealthy: true, lastFlipkartOrderObservationAt: now });
assert.equal(flipkartOrderAxisOnly.orders.state, 'starting', 'order history alone must not imply cancellation history completed');
const flipkartBothAxes = connectionReadiness({ ...flipkartBase, settings: { ...flipkartBase.settings, flipkartCancellationHistoryCompletedAt: now } }, { workerHealthy: true, lastFlipkartOrderObservationAt: now });
assert.equal(flipkartBothAxes.orders.state, 'partial', 'both date axes may report completed while provider coverage remains partial');
assert.match(flipkartBothAxes.orders.detail, /order-date and cancellation-date history/i);

const meesho = connectionReadiness({
  platform: 'meesho', status: 'inactive', connection_state: 'report_observed', verified_at: null, settings: {},
});
assert.equal(meesho.orders.state, 'partial');
assert.equal(meesho.inventoryWrite.state, 'blocked');

console.log('PASS connection readiness: credentials, feed setup, worker evidence, partial returns, Amazon queue/activation limits, and Meesho report-only intake are distinguished.');

assert.match(verifiedShopify.inventoryRead.detail, /mismatch may remain/i);
assert.match(verifiedShopify.inventoryWrite.detail, /require separate mapping-level evidence/i);
