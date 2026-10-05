import { sendDatabaseUnavailable, find, findOne, insert, update, remove, cors } from './mongo.js';

const MODULE = 'tax-zone';

async function listZones() {
  const [zones, mappings] = await Promise.all([
    find('generic_records', { module: MODULE }, { sort: { id: -1 } }),
    find('tax_zone_states', {}),
  ]);
  return zones.map((zone) => {
    const states = mappings
      .filter((mapping) => mapping.zone_id === zone.id)
      .sort((left, right) => left.sequence - right.sequence)
      .map((mapping) => mapping.state);
    return { ...zone, states, no_of_states: states.length };
  });
}

function normalizeStates(value) {
  if (!Array.isArray(value) || !value.length) return { error: 'Please Select State' };
  const states = value.map((state) => String(state ?? '').trim()).filter(Boolean);
  if (!states.length) return { error: 'Please Select State' };
  if (new Set(states.map((state) => state.toLowerCase())).size !== states.length) return { error: 'A State can only be added once.' };
  if (states.length > 100) return { error: 'A Tax Zone cannot contain more than 100 states.' };
  return { states };
}

function validate(body, code) {
  if (!/^\d+$/.test(String(code || ''))) return 'Please Enter Only Numerics in Tax Zone Code!';
  if (!String(body.name || '').trim()) return 'Please Enter Tax Zone Name';
  if (String(body.name).trim().length > 100) return 'Tax Zone Name cannot exceed 100 characters.';
  if (!String(body.country || '').trim()) return 'Please Select Country';
  if (!['Active', 'Inactive'].includes(body.status)) return 'Invalid status';
  return null;
}

async function replaceStates(zoneId, states) {
  const previous = await find('tax_zone_states', { zone_id: zoneId });
  try {
    for (const mapping of previous) await remove('tax_zone_states', mapping.id);
    for (const [index, state] of states.entries()) {
      await insert('tax_zone_states', { zone_id: zoneId, state, sequence: index + 1 });
    }
  } catch (error) {
    const current = await find('tax_zone_states', { zone_id: zoneId });
    for (const mapping of current) await remove('tax_zone_states', mapping.id);
    for (const mapping of previous) {
      const { id, ...fields } = mapping;
      await insert('tax_zone_states', fields);
    }
    throw error;
  }
  return previous;
}

async function restoreStates(zoneId, previous) {
  const current = await find('tax_zone_states', { zone_id: zoneId });
  for (const mapping of current) await remove('tax_zone_states', mapping.id);
  for (const mapping of previous) {
    const { id, ...fields } = mapping;
    await insert('tax_zone_states', fields);
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const { code, name, status } = req.query;
      const rows = await listZones();
      return res.status(200).json(rows.filter((zone) => (
        (!code || String(zone.code).includes(String(code)))
        && (!name || zone.name.toLowerCase().includes(String(name).toLowerCase()))
        && (!status || zone.status === status)
      )));
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = req.body || {};
      const zones = await find('generic_records', { module: MODULE });
      let current = null;
      let code = String(body.code || '').trim();
      if (req.method === 'POST' && (!code || code === '0')) {
        code = String(Math.max(0, ...zones.map((zone) => Number(zone.code) || 0)) + 1);
      }
      if (req.method === 'PUT') {
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'A valid Tax Zone ID is required.' });
        current = await findOne('generic_records', { id });
        if (!current || current.module !== MODULE) return res.status(404).json({ error: 'Tax Zone not found' });
        code = String(body.code ?? current.code).trim();
      }

      const validationError = validate(body, code);
      if (validationError) return res.status(400).json({ error: validationError });
      const normalized = normalizeStates(body.states);
      if (normalized.error) return res.status(400).json({ error: normalized.error });
      const name = String(body.name).trim();
      if (zones.some((zone) => zone.id !== current?.id && String(zone.code || '').trim() === code)) return res.status(409).json({ error: 'Tax Zone Code already exists.' });
      if (zones.some((zone) => zone.id !== current?.id && String(zone.name || '').trim().toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'Tax Zone Name already exists.' });

      const fields = {
        code,
        name,
        description: String(body.description || '').trim(),
        country: String(body.country).trim(),
        status: body.status,
        udf1: String(body.udf1 || ''),
        udf2: String(body.udf2 || ''),
        udf3: String(body.udf3 || ''),
      };

      if (req.method === 'POST') {
        const zone = await insert('generic_records', {
          module: MODULE,
          ...fields,
          created_date: new Date().toISOString().slice(0, 10),
        });
        try {
          await replaceStates(zone.id, normalized.states);
        } catch (error) {

          await remove('generic_records', zone.id);
          throw error;
        }
        return res.status(201).json((await listZones()).find((row) => row.id === zone.id));
      }

      if (code !== String(current.code || '').trim()) {
        const [taxApplications, locations] = await Promise.all([find('tax_application', {}), find('locations', {})]);
        const usedByApplication = taxApplications.some((application) => String(application.tax_zone || '') === String(current.code));
        const usedByLocation = locations.some((location) => String(location.tax_zone || '') === String(current.code));
        if (usedByApplication || usedByLocation) return res.status(409).json({ error: 'Tax Zone Code cannot be changed while Tax Applications or Locations use it.' });
      }

      const previousFields = {
        code: current.code,
        name: current.name,
        description: current.description || '',
        country: current.country,
        status: current.status,
        udf1: current.udf1 || '',
        udf2: current.udf2 || '',
        udf3: current.udf3 || '',
      };
      const previousStates = await find('tax_zone_states', { zone_id: current.id });
      try {
        await replaceStates(current.id, normalized.states);
        await update('generic_records', current.id, {
          ...fields,
          updated_date: new Date().toISOString().slice(0, 10),
        });
      } catch (error) {

        await restoreStates(current.id, previousStates);
        await update('generic_records', current.id, previousFields);
        throw error;
      }
      return res.status(200).json((await listZones()).find((row) => row.id === current.id));
    }

    if (req.method === 'DELETE') return res.status(409).json({ error: 'Tax Zones are maintained by status; deletion is not available.' });
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('tax zones error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message || 'Tax Zone request failed.' });
  }
}
