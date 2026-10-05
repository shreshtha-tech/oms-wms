import { sendDatabaseUnavailable, cors, find, insert, update, remove } from './mongo.js';
import { locations } from './catalogs.js';
import { currentUser } from './auth-session.js';

const RULE_UOMS = ['Kg', 'Each', 'Case', 'INNER PACK', 'CASEPACK10', 'palette', 'KGS', 'Litres'];
const METHODS = new Set(['1', '2']);
const PARAMETERS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
const BUCKETS = new Set(['10', '20', '30', '40']);
const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());

const normalize = (row) => ({
  ...row,
  ruleId: row.rule_id || row.code || '',
  ruleDesc: row.rule_desc || row.name || '',
  locCode: row.loc_code || '',
  location: row.location || '',
  method: row.method || 'Approx Qty',
  methodId: row.method_id || '1',
  uom: row.uom || 'Kg',
  active: row.active !== false,
  ruleParameter: row.rule_parameter || '1',
  merchHierarchy: row.merch_hierarchy || '',
  skuCode: row.sku_code || '',
  brand: row.brand || '',
  vendor: row.vendor || '',
  skuGroup: row.sku_group || '',
  skuLocationTags: row.sku_location_tags || [],
  skuNature: row.sku_nature || '-1',
  isFragile: !!row.is_fragile,
  isCICO: !!row.is_cico,
  searchPriorities: row.search_priorities || ['10', '20', '30', '40', '50', '60'],
  noOfIteration: row.no_of_iteration || '1',
  steps: Array.isArray(row.steps) ? row.steps : [],
});

function headerError(body) {
  if (!text(body.ruleDesc)) return 'Please Enter Rule Description.';
  if (text(body.ruleDesc).length > 50) return 'Rule Description cannot exceed 50 characters.';
  if (!text(body.locCode) || body.locCode === '-1') return 'Please select location';
  if (!METHODS.has(text(body.methodId))) return 'PutAway Method cannot be empty.';
  if (!RULE_UOMS.includes(text(body.uom))) return 'Please select uom';
  if (!PARAMETERS.has(text(body.ruleParameter))) return 'Priority Can Not be Blank';
  if (body.ruleParameter === '2' && !text(body.skuCode)) return 'SKU Code is Mandatory.';
  if (['3', '4', '5'].includes(body.ruleParameter) && !text(body.merchHierarchy)) return 'Please select any one Hierarchy except parent level Hierarchy.';
  if (body.ruleParameter === '6' && !text(body.brand)) return 'Please select Brand.';
  if (body.ruleParameter === '7' && !text(body.vendor)) return 'Please Enter Vendor Code';
  if (body.ruleParameter === '8' && !text(body.skuGroup)) return 'Please Enter SKU Group';
  if (body.ruleParameter === '9' && (!Array.isArray(body.skuLocationTags) || body.skuLocationTags.length === 0)) return 'Please select SKU Location Tag';
  if (!Array.isArray(body.steps) || body.steps.length === 0) return 'At least one PutAway step is required.';
  return '';
}

function stepError(step, steps = []) {
  if (!step || typeof step !== 'object') return 'Please enter Step No.';
  const number = text(step.stepNo);
  if (!number) return 'Please enter Step No.';
  if (!/^\d+$/.test(number) || Number(number) < 1) return 'Please enter a valid Step No.';
  if (steps.some((row) => Number(row.stepNo) === Number(number))) return 'step no already exists';
  const bucket = text(step.invBucket) || '-1';
  if (bucket !== '-1' && !BUCKETS.has(bucket)) return 'Please select a valid Good Inventory Bucket.';
  const zone = text(step.zone) || '-1';
  const fromBin = text(step.fromBin);
  const toBin = text(step.toBin);
  if (bucket === '-1' && zone === '-1' && !fromBin && !toBin) return 'Please fill either Zone or Bin';
  if (bucket === '-1' && zone === '-1' && !fromBin) return 'Please enter From Bin.';
  if (bucket === '-1' && zone === '-1' && !toBin) return 'Please enter To Bin.';
  return '';
}

function stepReferenceError(step, locationCode, generic) {
  const zone = text(step.zone);
  if (zone && zone !== '-1') {
    const configured = generic.some((row) => row.module === 'wms-zone'
      && text(row.code || row.zone_code) === zone
      && text(row.location || row.loc_code) === locationCode);
    if (!configured) return 'Please select a zone configured for this location.';
  }
  for (const field of ['fromBin', 'toBin']) {
    const code = text(step[field]);
    if (!code) continue;
    const configured = generic.some((row) => ['bin-enquiry', 'bin-create-edit'].includes(row.module)
      && text(row.bin_code || row.code) === code
      && text(row.loc_code || row.location) === locationCode);
    if (!configured) return 'Please select a bin configured for this location.';
  }
  return '';
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    const all = await find('generic_records', { module: 'putaway-rule' });
    if (req.method === 'GET') {
      const [generic, partners, skus, configuredLocations] = await Promise.all([
        find('generic_records'), find('vendors'), find('skus'), locations(),
      ]);
      return res.json({
        zones: generic.filter((row) => row.module === 'wms-zone').map((row) => ({ code: row.code, description: row.description || row.name })),
        bins: generic.filter((row) => ['bin-enquiry', 'bin-create-edit'].includes(row.module)).map((row) => row.code).filter(Boolean),
        rules: all.map(normalize),
        locations: configuredLocations,
        uoms: RULE_UOMS,
        brands: [...new Set(skus.map((row) => row.brand || row.brand_name).filter(Boolean))],
        skuLocationTags: [...new Set(skus.flatMap((row) => row.location_tags || row.sku_location_tags || []).filter(Boolean))],
        skus: skus.map((row) => ({ code: row.sku_code || row.code, name: row.name || row.sku_description || '' })),
        vendors: partners.map((row) => ({ code: row.vendor_code || row.code || String(row.id), name: row.vendor_name || row.name || '' })),
      });
    }

    if (req.method === 'POST' && (body.REQ_SEARCH_FLAG || body.action === 'search')) {
      let rows = all.map(normalize).filter((row) => has(row.ruleId, body.ruleId)
        && has(row.ruleDesc, body.ruleDesc)
        && has(row.locCode, body.locCode)
        && has(row.methodId, body.methodId || body.methodIdDisplay)
        && has(row.ruleParameter, body.ruleParameter)
        && has(row.merchHierarchy, body.merchHierarchy)
        && has(row.skuCode, body.skuCode)
        && has(row.brand, body.brand)
        && has(row.vendor, body.vendor)
        && has(row.steps?.[0]?.zone, body.zone)
        && has(row.steps?.[0]?.fromBin, body.bin)
        && (body.isActive !== true && body.isActive !== 'true' || row.active));
      rows.sort((a, b) => text(a.ruleId).localeCompare(text(b.ruleId)) * (text(body.sord) === 'asc' ? 1 : -1));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = rows.length;
      const putAwayEnquiryDTOs = rows.slice((page - 1) * size, page * size);
      return res.json({
        gridModel: putAwayEnquiryDTOs,
        putAwayEnquiryDTOs,
        rows: size,
        page,
        records,
        total: Math.ceil(records / size),
        sidx: text(body.sidx) || 'id.ruleId',
        sord: text(body.sord) || 'asc',
      });
    }

    if (req.method === 'POST' && body.action === 'validate-step') {
      const error = stepError(body.step, Array.isArray(body.steps) ? body.steps : []);
      return error ? res.status(400).json({ error }) : res.json({ ok: true });
    }

    if ((req.method === 'POST' && body.action === 'save') || req.method === 'PUT') {
      const error = headerError(body);
      if (error) return res.status(400).json({ error });
      const configuredLocation = (await locations()).find((row) => row.code === text(body.locCode));
      if (!configuredLocation) return res.status(400).json({ error: 'Please select a configured location' });
      const generic = await find('generic_records');
      for (let index = 0; index < body.steps.length; index += 1) {
        const step = body.steps[index];
        const stepValidation = stepError(step, body.steps.slice(0, index));
        if (stepValidation) return res.status(400).json({ error: stepValidation });
        const referenceValidation = stepReferenceError(step, configuredLocation.code, generic);
        if (referenceValidation) return res.status(400).json({ error: referenceValidation });
      }
      if (req.method === 'PUT' && !body.id) return res.status(400).json({ error: 'PutAway Rule id is required.' });
      const existing = body.id ? all.find((row) => row.id === Number(body.id)) : null;
      if (req.method === 'PUT' && !existing) return res.status(404).json({ error: 'PutAway Rule was not found.' });
      if (req.method === 'POST' && body.ruleId && all.some((row) => normalize(row).ruleId === text(body.ruleId))) {
        return res.status(409).json({ error: 'PutAway Rule id already exists.' });
      }
      const next = Math.max(0, ...all.map((row) => Number(text(normalize(row).ruleId).replace(/\D/g, '')) || 0)) + 1;
      const ruleId = existing ? normalize(existing).ruleId : `PAR${String(next).padStart(6, '0')}`;
      const fields = {
        module: 'putaway-rule',
        code: ruleId,
        rule_id: ruleId,
        name: text(body.ruleDesc),
        rule_desc: text(body.ruleDesc),
        loc_code: text(body.locCode),
        location: configuredLocation.name,
        method_id: text(body.methodId),
        method: body.methodId === '2' ? 'Cubic Volume' : 'Approx Qty',
        uom: text(body.uom),
        active: body.active !== false,
        rule_parameter: text(body.ruleParameter),
        merch_hierarchy: text(body.merchHierarchy),
        sku_code: text(body.skuCode),
        brand: text(body.brand),
        vendor: text(body.vendor),
        sku_group: text(body.skuGroup),
        sku_location_tags: body.skuLocationTags || [],
        sku_nature: text(body.skuNature),
        is_fragile: !!body.isFragile,
        is_cico: !!body.isCICO,
        search_priorities: Array.isArray(body.searchPriorities) ? body.searchPriorities : [],
        no_of_iteration: text(body.noOfIteration || '1'),
        steps: body.steps,
        modified_by: currentUser(req)?.username || 'unknown',
        modified_date: new Date().toISOString(),
      };
      if (existing) {
        const changed = await update('generic_records', existing.id, fields);
        return res.json({ row: normalize(changed[0]), jsonMessage: 'Data saved successfully.' });
      }
      const row = await insert('generic_records', {
        ...fields,
        created_by: currentUser(req)?.username || 'unknown',
        created_date: new Date().toISOString(),
      });
      return res.status(201).json({ row: normalize(row), jsonMessage: 'Data saved successfully.' });
    }

    if (req.method === 'DELETE') {
      const current = all.find((row) => row.id === Number(body.id));
      if (!current) return res.status(404).json({ error: 'PutAway Rule was not found.' });
      await remove('generic_records', current.id);
      return res.json({ jsonMessage: 'PutAway Rule deleted successfully.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('PutAway Rule error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
