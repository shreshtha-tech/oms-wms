import assert from 'node:assert/strict';
import { createDictionary } from '../inventory/sku-parser.mjs';
import { buildVariantBackfillPlan } from '../inventory/variant-backfill-plan.mjs';

const dictionary = createDictionary({ values: [
  ...['ACME', 'ZED', 'NOVA'].map(code => ({ kind: 'brand', code })),
  { kind: 'category', code: 'JEANS' }, { kind: 'type', code: 'SLIM' },
  { kind: 'color', code: 'BLACK' }, { kind: 'size', code: '32' },
] });
const masters = [
  { id: '00000000-0000-4000-8000-000000000003', sku: 'NOVA-JEANS-SLIM-TEAL-32', on_hand: '0', active_reservations: '0' },
  { id: '00000000-0000-4000-8000-000000000002', sku: 'ZED-JEANS-SLIM-BLACK-32', on_hand: '7', active_reservations: '1', opening_stock_active: true },
  { id: '00000000-0000-4000-8000-000000000001', sku: 'ACME-JEANS-SLIM-BLACK-32', on_hand: '5', active_reservations: '0' },
];
const first = buildVariantBackfillPlan({ tenantId: 'fixture', masters, mongoSkus: [], dictionary });
const second = buildVariantBackfillPlan({ tenantId: 'fixture', masters: [...masters].reverse(), mongoSkus: [], dictionary });
assert.equal(first.summary.sha256, second.summary.sha256, 'Input row order must not change a reviewed plan');
assert.equal(first.variants.length, 1);
assert.equal(first.variants[0].total_on_hand, 12);
assert.deepEqual(first.mergeable[0].source_ids, masters.slice(1).reverse().map(row => row.id));
assert.equal(first.mergeable[0].blocked, true);
assert.equal(first.review[0].sku, 'NOVA-JEANS-SLIM-TEAL-32');
const canonical = { id: '00000000-0000-4000-8000-000000000004', sku: 'JEANS-SLIM-BLACK-32', variant_key: 'JEANS|SLIM|BLACK|32', category: 'JEANS', product_type: 'SLIM', color: 'BLACK', size: '32', on_hand: '2', active_reservations: '0' };
const withCanonical = buildVariantBackfillPlan({ tenantId: 'fixture', masters: [...masters, canonical], mongoSkus: [], dictionary });
assert.equal(withCanonical.variants[0].target_id, canonical.id);
assert.equal(withCanonical.variants[0].total_on_hand, 14);
const changed = buildVariantBackfillPlan({ tenantId: 'fixture', masters: masters.map(row => row.id.endsWith('1') ? { ...row, on_hand: '6' } : row), mongoSkus: [], dictionary });
assert.notEqual(first.summary.sha256, changed.summary.sha256, 'Stock changes must invalidate the reviewed plan');
const conflict = buildVariantBackfillPlan({ tenantId: 'fixture', masters, mongoSkus: [{ sku_code: 'ACME-JEANS-SLIM-BLACK-32', brand: 'ACME', category: 'JEANS', style: 'SLIM', color: 'NAVY-BLUE', size: '32' }], dictionary });
assert.equal(conflict.conflicts.length, 1);
assert.equal(conflict.variants[0].total_on_hand, 7, 'Conflicted stock must never silently join the pool');
console.log('PASS variant backfill planner: stable hash, stock drift changes hash, reservations block merging, unknown and conflicting SKU review');
