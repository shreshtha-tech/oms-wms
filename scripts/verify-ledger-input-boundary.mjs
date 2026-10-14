import assert from 'node:assert/strict';
import { applyInventoryEventInTransaction } from '../inventory/ledger.js';
const base = { tenantId: 'owned', masterSkuId: 'owned-sku', locationId: 'owned-location', eventKey: 'owned-event', eventType: 'count', source: 'owned-fixture' };
let queries = 0;
const sentinel = Error('valid-input-reached-store');
const db = { query: async () => { queries++; throw sentinel; } };
for (const column of ['on_hand', 'reserved_order', 'reserved_cart', 'damaged', 'quarantined', 'safety_stock']) {
  for (const value of [true, false, [], [1], {}, null, '', ' ', NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(applyInventoryEventInTransaction(db, { ...base, [`delta_${column}`]: value }), TypeError);
  }
}
assert.equal(queries, 0, 'Invalid deltas must fail before store access');
for (const value of [0, 1, -1, '1', '-1']) await assert.rejects(applyInventoryEventInTransaction(db, { ...base, delta_on_hand: value }), error => error === sentinel);
assert.equal(queries, 5);
console.log('PASS: six ledger delta fields reject coercible/noninteger values before DB access; numeric scalar compatibility retained');
