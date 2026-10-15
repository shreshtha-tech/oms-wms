import assert from 'node:assert/strict';
import { buildDictionary, createDictionary, normalizeSkuCode, parseSku, profile } from '../inventory/sku-parser.mjs';

const values = [
  ...['ACME', 'ZED', 'NOVA', 'ACME-PLUS'].map(code => ({ kind: 'brand', code })),
  ...['JEANS', 'TEE-SHIRT'].map(code => ({ kind: 'category', code })),
  ...['SLIM', 'ROUND-NECK'].map(code => ({ kind: 'type', code })),
  ...['BLACK', 'NAVY-BLUE'].map(code => ({ kind: 'color', code })),
  ...['32', 'EXTRA-LARGE'].map(code => ({ kind: 'size', code })),
];
const aliases = [
  { kind: 'category', alias_norm: 'DENIM', code: 'JEANS' },
  { kind: 'color', alias_norm: 'NAVY', code: 'NAVY-BLUE' },
  { kind: 'size', alias_norm: 'XL', code: 'EXTRA-LARGE' },
];
const noise = [
  { platform: 'amazon', kind: 'prefix', token_norm: 'FBA' },
  { platform: 'amazon', kind: 'suffix', token_norm: 'AMAZON' },
];
const dictionary = createDictionary({ values, aliases, noise });
let golden = 0;
for (const brand of ['ACME', 'ZED', 'NOVA']) for (const category of ['JEANS', 'TEE-SHIRT'])
  for (const type of ['SLIM', 'ROUND-NECK']) for (const color of ['BLACK', 'NAVY-BLUE'])
    for (const size of ['32', 'EXTRA-LARGE']) {
      const result = parseSku([brand, category, type, color, size].join('-'), dictionary);
      assert.equal(result.attrStatus, 'parsed');
      assert.equal(result.variantKey, `${category}|${type}|${color}|${size}`);
      assert.equal(result.canonicalSku, `${category}-${type}-${color}-${size}`);
      assert.deepEqual(result.issues, []);
      golden++;
    }
assert.equal(golden, 48);
assert.equal(parseSku('ACME-PLUS-JEANS-SLIM-BLACK-32', dictionary).brand, 'ACME-PLUS');
assert.equal(parseSku(' acme / denim / slim / navy / xl ', dictionary).variantKey, 'JEANS|SLIM|NAVY-BLUE|EXTRA-LARGE');
assert.equal(normalizeSkuCode(' navy_blue / extra  large '), 'NAVY-BLUE-EXTRA-LARGE');
const noisy = parseSku('FBA-ZED-TEE-SHIRT-ROUND-NECK-NAVY-BLUE-EXTRA-LARGE-AMAZON', dictionary, { platform: 'amazon' });
assert.equal(noisy.variantKey, 'TEE-SHIRT|ROUND-NECK|NAVY-BLUE|EXTRA-LARGE');
assert.deepEqual(noisy.removedNoise, [{ kind: 'suffix', token: 'AMAZON' }, { kind: 'prefix', token: 'FBA' }]);
assert.equal(parseSku('FBA-ZED-JEANS-SLIM-BLACK-32', dictionary).attrStatus, 'review');
const unknown = parseSku('ZED-JEANS-SLIM-TEAL-32', dictionary);
assert.equal(unknown.attrStatus, 'review');
assert.equal(unknown.variantKey, null);
assert.deepEqual(unknown.issues, [{ code: 'UNKNOWN_COLOR', field: 'color', value: 'TEAL' }]);
const matching = parseSku('ACME-JEANS-SLIM-BLACK-32', dictionary, { mongo: { brand: 'Acme', category: 'Jeans', style: 'Slim', color: 'Black', size: '32' } });
assert.equal(matching.attrStatus, 'verified');
const conflict = parseSku('ACME-JEANS-SLIM-BLACK-32', dictionary, { mongo: { brand: 'Acme', category: 'Jeans', style: 'Slim', color: 'Navy Blue', size: '32' } });
assert.equal(conflict.attrStatus, 'review');
assert.equal(conflict.variantKey, null);
assert.deepEqual(conflict.issues, [{ code: 'SOURCE_CONFLICT', field: 'color', parsed: 'BLACK', mongo: 'NAVY-BLUE' }]);
assert.throws(() => createDictionary({ values, aliases: [...aliases, { kind: 'color', alias_norm: 'NAVY', code: 'BLACK' }] }), /Ambiguous color alias/);
assert.throws(() => createDictionary({ values, aliases: [{ kind: 'color', alias_norm: 'TEAL', code: 'TEAL' }] }), /Invalid or inactive/);
const queries = [];
const loaded = await buildDictionary({ query: async (sql, args) => { queries.push({ sql, args });return { rows: sql.includes('ci_attribute_alias') ? aliases : sql.includes('ci_sku_noise_rule') ? noise : values }; } }, 'tenant-a');
assert.equal(queries.length, 3);
assert.ok(queries.every(query => query.args[0] === 'tenant-a'));
assert.equal(parseSku('ZED-JEANS-SLIM-BLACK-32', loaded).brand, 'ZED');
assert.deepEqual(profile(['ACME-JEANS-SLIM-BLACK-32', 'ZED-JEANS-SLIM-BLACK-32']).find(row => row.token === 'JEANS'), { token: 'JEANS', count: 2 });
console.log(`PASS variant SKU parser: ${golden} golden SKUs across three brands, longest tokens, noise, normalization, unknown review, two-source conflicts and tenant dictionary loading`);
