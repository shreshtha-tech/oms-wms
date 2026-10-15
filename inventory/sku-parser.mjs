export function normalizeSkuCode(value) {
  if (typeof value !== 'string') throw new TypeError('SKU and dictionary values must be strings');
  return value.trim().toUpperCase().replace(/[\s_/]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

const kinds = ['brand', 'category', 'type', 'color', 'size'];
const compareLength = (a, b) => b.alias.length - a.alias.length || a.alias.localeCompare(b.alias);

export function createDictionary({ values = [], aliases = [], noise = [] } = {}) {
  const byKind = Object.fromEntries(kinds.map(kind => [kind, new Map()]));
  const active = new Set();
  for (const row of values) {
    if (!kinds.includes(row.kind) || row.active === false) continue;
    const code = normalizeSkuCode(row.code);
    if (!code || code.includes('|') || code !== row.code) throw new Error(`Invalid ${row.kind} dictionary code`);
    active.add(`${row.kind}:${code}`);
    byKind[row.kind].set(code, code);
  }
  for (const row of aliases) {
    if (!kinds.includes(row.kind)) throw new Error('Unknown dictionary alias kind');
    const alias = normalizeSkuCode(row.alias_norm ?? row.alias);
    const code = normalizeSkuCode(row.code);
    if (!alias || alias.includes('|') || !active.has(`${row.kind}:${code}`)) throw new Error('Invalid or inactive dictionary alias');
    const prior = byKind[row.kind].get(alias);
    if (prior && prior !== code) throw new Error(`Ambiguous ${row.kind} alias: ${alias}`);
    byKind[row.kind].set(alias, code);
  }
  const compiled = Object.fromEntries(kinds.map(kind => [kind, [...byKind[kind]].map(([alias, code]) => ({ alias, code })).sort(compareLength)]));
  const noiseRules = noise.filter(row => row.active !== false).map(row => {
    if (!['prefix', 'suffix'].includes(row.kind) || typeof row.platform !== 'string' || !row.platform.trim()) throw new Error('Invalid platform noise rule');
    const token = normalizeSkuCode(row.token_norm ?? row.token);
    if (!token) throw new Error('Empty platform noise rule');
    return { platform: row.platform.trim().toLowerCase(), kind: row.kind, token };
  }).sort((a, b) => b.token.length - a.token.length);
  return { byKind, compiled, noiseRules };
}

export async function buildDictionary(db, tenantId) {
  if (!tenantId) throw new TypeError('Tenant is required for SKU dictionary');
  const [values, aliases, noise] = await Promise.all([
    db.query('SELECT kind,code,active FROM ci_attribute_value WHERE tenant_id=$1', [tenantId]),
    db.query('SELECT kind,alias_norm,code FROM ci_attribute_alias WHERE tenant_id=$1', [tenantId]),
    db.query('SELECT platform,kind,token_norm,active FROM ci_sku_noise_rule WHERE tenant_id=$1', [tenantId]),
  ]);
  return createDictionary({ values: values.rows, aliases: aliases.rows, noise: noise.rows });
}

function matchEdge(value, entries, side) {
  for (const entry of entries) {
    if (value === entry.alias) return { code: entry.code, rest: '' };
    if (side === 'prefix' && value.startsWith(`${entry.alias}-`)) return { code: entry.code, rest: value.slice(entry.alias.length + 1) };
    if (side === 'suffix' && value.endsWith(`-${entry.alias}`)) return { code: entry.code, rest: value.slice(0, -entry.alias.length - 1) };
  }
  return null;
}

function removeNoise(sku, dictionary, platform) {
  let value = sku;
  const removed = [];
  const rules = dictionary.noiseRules.filter(rule => rule.platform === String(platform || '').toLowerCase());
  for (let pass = 0; pass < rules.length; pass++) {
    let changed = false;
    for (const rule of rules) {
      const match = matchEdge(value, [{ alias: rule.token, code: rule.token }], rule.kind);
      if (!match || !match.rest) continue;
      value = match.rest;
      removed.push({ kind: rule.kind, token: rule.token });
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return { value, removed };
}

function compareMongo(parsed, mongo, dictionary, issues) {
  if (!mongo) return false;
  const fields = [
    ['brand', mongo.brand, 'brand'],
    ['category', mongo.category, 'category'],
    ['productType', mongo.product_type ?? mongo.productType ?? mongo.style, 'type'],
    ['color', mongo.color ?? mongo.colour, 'color'],
    ['size', mongo.size, 'size'],
  ];
  let complete = true;
  for (const [field, raw, kind] of fields) {
    if (raw == null || raw === '') { complete = false; continue; }
    const normalized = normalizeSkuCode(String(raw));
    const candidate = dictionary.byKind[kind].get(normalized) ?? normalized;
    if (candidate !== parsed[field]) issues.push({ code: 'SOURCE_CONFLICT', field, parsed: parsed[field], mongo: candidate });
  }
  return complete;
}

export function parseSku(rawSku, dictionary, { platform = null, mongo = null } = {}) {
  if (!dictionary?.compiled || !dictionary?.byKind) throw new TypeError('A validated SKU dictionary is required');
  const normalizedSku = normalizeSkuCode(rawSku);
  const { value, removed } = removeNoise(normalizedSku, dictionary, platform);
  const issues = [];
  const parsed = { brand: null, category: null, productType: null, color: null, size: null };
  let remainder = value;
  for (const [field, kind, side] of [['brand', 'brand', 'prefix'], ['size', 'size', 'suffix'], ['color', 'color', 'suffix'], ['category', 'category', 'prefix']]) {
    const match = matchEdge(remainder, dictionary.compiled[kind], side);
    if (!match || !match.rest) {
      issues.push({ code: `UNKNOWN_${kind.toUpperCase()}`, field, value: side === 'prefix' ? remainder.split('-')[0] : remainder.split('-').at(-1) });
      break;
    }
    parsed[field] = match.code;
    remainder = match.rest;
  }
  if (!issues.length) {
    parsed.productType = dictionary.byKind.type.get(remainder) ?? null;
    if (!parsed.productType) issues.push({ code: 'UNKNOWN_TYPE', field: 'productType', value: remainder });
  }
  const mongoComplete = !issues.length && compareMongo(parsed, mongo, dictionary, issues);
  const attrStatus = issues.length ? 'review' : mongoComplete ? 'verified' : 'parsed';
  const variantKey = issues.length ? null : [parsed.category, parsed.productType, parsed.color, parsed.size].join('|');
  return {
    ...parsed, normalizedSku, strippedSku: value, removedNoise: removed,
    attrStatus, variantKey,
    canonicalSku: variantKey ? [parsed.category, parsed.productType, parsed.color, parsed.size].join('-') : null,
    issues,
  };
}

export function profile(skus) {
  if (!Array.isArray(skus)) throw new TypeError('SKU profile requires an array');
  const counts = new Map();
  for (const sku of skus) for (const token of normalizeSkuCode(sku).split('-').filter(Boolean)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts].map(([token, count]) => ({ token, count })).sort((a, b) => b.count - a.count || a.token.localeCompare(b.token));
}
