import { sendDatabaseUnavailable, find, insert, removeIfPresent, ensureIndex, cors, actor } from './mongo.js';

const MODULE = 'sku-company-link';
const text = (value) => String(value ?? '').trim();
const keyOf = (value) => text(value).toLocaleLowerCase('en');
const includes = (value, query) => !text(query) || text(value).toLocaleLowerCase('en').includes(text(query).toLocaleLowerCase('en'));
const active = (value) => !text(value) || /^active$/i.test(text(value));
const today = () => new Date().toISOString().slice(0, 10);
const fail = (res, status, error) => res.status(status).json({ error });
let linkIndex;
async function ensureLinkIndex() {
  if (!linkIndex) {
    linkIndex = ensureIndex('generic_records', { module: 1, company_location: 1, sku_code: 1 }, {
      name: 'uq_sku_company_link',
      unique: true,
      partialFilterExpression: { module: MODULE, company_location: { $type: 'string' }, sku_code: { $type: 'string' } },
      collation: { locale: 'en', strength: 2 },
    }).catch(error => { linkIndex = null; throw error; });
  }
  return linkIndex;
}

async function references() {
  const [organizations, locations, skus] = await Promise.all([
    find('generic_records', { module: 'org-hierarchy' }),
    find('generic_records', { module: 'location' }),
    find('skus', {}),
  ]);
  return {
    companies: organizations.filter((row) => row.hierarchy_type === 'Company'),
    locations,
    skus,
  };
}

function findCompany(rows, code) {
  return rows.find((row) => keyOf(row.code) === keyOf(code)) || null;
}

function locationCode(row) {
  return row.location_code || row.code;
}

function findLocation(rows, code) {
  return rows.find((row) => keyOf(locationCode(row)) === keyOf(code)) || null;
}

function findSku(rows, code) {
  return rows.find((row) => keyOf(row.sku_code) === keyOf(code)) || null;
}

function validateScope(company, location, refs, { requireActive = false } = {}) {
  const companyRow = findCompany(refs.companies, company);
  if (!companyRow) return { error: 'Company must be selected from Organization Hierarchy.' };
  const locationRow = findLocation(refs.locations, location);
  if (!locationRow) return { error: 'Location must be selected from Location Master.' };
  if (requireActive && !active(companyRow.status)) return { error: 'Inactive Company cannot receive SKU links.' };
  if (requireActive && !active(locationRow.status)) return { error: 'Inactive Location cannot receive SKU links.' };
  return {
    company: text(companyRow.code),
    location: text(locationCode(locationRow)),
    companyRow,
    locationRow,
  };
}

function normalizeCodes(value) {
  if (!Array.isArray(value) || value.length === 0) return { error: 'Select at least one SKU.' };
  if (value.length > 200) return { error: 'A maximum of 200 SKUs can be changed at a time.' };
  const codes = value.map(text);
  if (codes.some((code) => !code || code.length > 160)) return { error: 'Every SKU Code must be a non-empty valid value.' };
  const unique = new Set(codes.map(keyOf));
  if (unique.size !== codes.length) return { error: 'Duplicate SKU Codes were supplied.' };
  return { codes };
}

function mapSku(row) {
  return {
    id: row.id,
    sku_code: row.sku_code,
    display_sku: row.master_sku_code || row.sku_code,
    sku_desc: row.name,
    mfg_sku_code: row.sku_mfg_code || '',
    brand: row.brand || '',
    status: row.status || 'Active',
  };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    if (req.method === 'GET') {
      const [refs, links] = await Promise.all([
        references(),
        find('generic_records', { module: MODULE }),
      ]);
      return res.status(200).json({
        companies: refs.companies,
        locations: refs.locations,
        records: links.length,
      });
    }

    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

    const body = req.body || {};
    const refs = await references();
    const scope = validateScope(body.company, body.location, refs);
    if (scope.error) return fail(res, 400, scope.error);
    const linkKey = `${scope.company}:${scope.location}`;

    if (body.action === 'search') {
      const links = await find('generic_records', { module: MODULE });
      const linkedCodes = new Set(links
        .filter((row) => row.company_location === linkKey)
        .map((row) => keyOf(row.sku_code)));
      const filteredSkus = refs.skus.filter((row) => includes(row.sku_code, body.skuCode) && includes(row.name, body.skuName));
      const available = filteredSkus.filter((row) => !linkedCodes.has(keyOf(row.sku_code))).map(mapSku);
      const linked = filteredSkus.filter((row) => linkedCodes.has(keyOf(row.sku_code))).map(mapSku);
      return res.status(200).json({ available, linked, availableRecords: available.length, linkedRecords: linked.length });
    }

    if (body.action === 'add') {
      await ensureLinkIndex();
      const activeScope = validateScope(body.company, body.location, refs, { requireActive: true });
      if (activeScope.error) return fail(res, 400, activeScope.error);
      const parsed = normalizeCodes(body.skuCodes);
      if (parsed.error) return fail(res, 400, parsed.error);
      const skuRows = parsed.codes.map((code) => findSku(refs.skus, code));
      if (skuRows.some((row) => !row)) return fail(res, 400, 'Every SKU Code must exist in Master SKU.');
      if (skuRows.some((row) => !active(row.status))) return fail(res, 400, 'Inactive SKUs cannot be newly linked.');

      const existing = await find('generic_records', { module: MODULE, company_location: linkKey });
      const existingCodes = new Set(existing.map((row) => keyOf(row.sku_code)));
      let added = 0;
      const date = today();
      for (const sku of skuRows) {
        if (existingCodes.has(keyOf(sku.sku_code))) continue;
        try { await insert('generic_records', {
          module: MODULE,
          code: `${linkKey}:${sku.sku_code}`,
          name: sku.sku_code,
          company_location: linkKey,
          company: activeScope.company,
          location: activeScope.location,
          sku_code: sku.sku_code,
          status: 'Active',
          created_by: actor(req),
          created_date: date,
          modified_by: actor(req),
          modified_date: date,
        }); } catch (error) {

          if (error?.code === 11000 && (error.keyPattern?.sku_code || String(error.message).includes('uq_sku_company_link'))) {
            existingCodes.add(keyOf(sku.sku_code));
            continue;
          }
          throw error;
        }
        existingCodes.add(keyOf(sku.sku_code));
        added += 1;
      }
      return res.status(200).json({ added });
    }

    if (body.action === 'remove') {
      const parsed = normalizeCodes(body.skuCodes);
      if (parsed.error) return fail(res, 400, parsed.error);
      const selectedCodes = new Set(parsed.codes.map(keyOf));
      const links = await find('generic_records', { module: MODULE, company_location: linkKey });
      const targets = links.filter((row) => selectedCodes.has(keyOf(row.sku_code)));
      let removed = 0;
      for (const row of targets) if (await removeIfPresent('generic_records', row.id)) removed += 1;
      return res.status(200).json({ removed });
    }

    return fail(res, 400, 'Unknown SKU Company Link action.');
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('SKU Company Link API error:', { name: error?.name, code: error?.code });
    return fail(res, 500, error.message || 'SKU Company Link request failed.');
  }
}
