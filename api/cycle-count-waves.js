import { sendDatabaseUnavailable, cors, find, insert, update } from './mongo.js';
import { locationPairs } from './catalogs.js';
import { currentUser } from './auth-session.js';

const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const norm = (row) => ({
  ...row,
  waveId: row.wave_id || row.code || '',
  waveDesc: row.wave_desc || row.name || '',
  locCode: row.loc_code || '',
  location: row.location || '',
  waveType: row.wave_type || 'Bin',
  schMethod: row.sch_method || '',
  startDate: row.start_date || '',
  endDate: row.end_date || '',
  lastRunTime: row.last_run_time || '',
  status: row.status || '',
});
const ruleParameters = new Set(['1', '2', '3', '4', '5', '6', '7', '8']);
const ruleFields = {
  '1': ['categoryName', 'SKU Category'],
  '2': ['skuGroup', 'SKU Group'],
  '3': ['sku', 'SKU Code'],
  '4': ['brandCode', 'Brand'],
  '6': ['fromBinRange', 'From Bin Range'],
  '8': ['skuLocationTag', 'SKU-Location Tag'],
};
const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    const all = await find('generic_records', { module: 'cycle-count-wave' });

    if (req.method === 'GET') {
      const [locations, zones] = await Promise.all([
        locationPairs(),
        find('generic_records', { module: 'wms-zone' }),
      ]);
      return res.json({
        locations,
        statuses: [['1', 'Active'], ['0', 'InActive']],
        periodTypes: [['1', 'Permanent'], ['2', 'Temporary']],
        waveTypes: [['1', 'Bin']],
        ruleParameters: [['-1', '--- Select ---'], ['1', 'Sku category'], ['2', 'Sku group'], ['3', 'Sku'], ['4', 'Brand'], ['5', 'Zone'], ['6', 'Bin Range'], ['7', 'Bin'], ['8', 'SKU-Location Tag']],
        schedulingMethods: [['-1', '--- Select ---'], ['1', 'Action Triggered'], ['2', 'Periodic']],
        priorities: [['-1', '--- Select ---'], ['2', 'Bin nomenclature'], ['1', 'Bin seq'], ['4', 'High to low'], ['3', 'Low to high']],
        frequencies: [['-1', '--- Select ---'], ['1', 'Daily'], ['2', 'Weekly'], ['3', 'Fortnightly'], ['4', 'Monthly'], ['5', 'Bimonthly'], ['6', 'Quarterly'], ['7', 'Half Yearly'], ['8', 'Yearly']],
        zones: zones.map((row) => row.code).filter(Boolean),
      });
    }

    if (req.method === 'POST' && (body.REQ_SEARCH_FLAG || body.action === 'search')) {
      let rows = all.map(norm).filter((row) =>
        has(row.locCode, body.locCode) && has(row.waveId, body.waveId) && has(row.waveDesc, body.waveDesc) &&
        has(row.waveType, body.wavetype) && has(row.schMethod, body.schMethod) &&
        has(row.status, body.status === '1' ? 'Active' : body.status === '0' ? 'InActive' : body.status) &&
        (!text(body.fromStartDate) || row.startDate >= body.fromStartDate) &&
        (!text(body.toStartDate) || row.startDate <= body.toStartDate) &&
        (!text(body.fromEndDate) || row.endDate >= body.fromEndDate) &&
        (!text(body.toEndDate) || row.endDate <= body.toEndDate));
      rows.sort((left, right) => text(left[body.sidx] || left.waveId).localeCompare(text(right[body.sidx] || right.waveId)) * (body.sord === 'desc' ? -1 : 1));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = rows.length;
      const total = Math.ceil(records / size);
      const gridModel = rows.slice((page - 1) * size, page * size);
      return res.json({ cycleCountDTOs: gridModel, gridModel, rows: size, page, total, records, sidx: text(body.sidx) || 'updDate', sord: text(body.sord) || 'desc' });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      if (!text(body.waveName)) return res.status(400).json({ error: 'Cycle Wave Name is mandatory' });
      const startDate = text(body.startDate);
      const endDate = text(body.endDate);
      if (!startDate) return res.status(400).json({ error: 'Start Date is mandatory' });
      if (!validDate(startDate)) return res.status(400).json({ error: 'Enter a valid Start Date.' });
      if (!endDate) return res.status(400).json({ error: 'End Date is mandatory' });
      if (!validDate(endDate)) return res.status(400).json({ error: 'Enter a valid End Date.' });
      if (endDate <= startDate) return res.status(400).json({ error: 'End Date should be greater than Start Date' });
      if (!ruleParameters.has(text(body.ruleParameter))) return res.status(400).json({ error: 'Rule Parameter is mandatory' });
      if (!['1', '2'].includes(text(body.schedulingMethod))) return res.status(400).json({ error: 'Scheduling Method is mandatory' });
      if (!['1', '2'].includes(text(body.periodType || '1'))) return res.status(400).json({ error: 'Select a valid Period Type.' });

      const locations = await locationPairs();
      const location = locations.find(([code]) => code === text(body.locCode));
      if (!location) return res.status(400).json({ error: 'Select a configured location' });

      const zones = await find('generic_records', { module: 'wms-zone' });
      const pickZone = text(body.pickZone);
      if (!pickZone || pickZone === '-1') return res.status(400).json({ error: 'Pick Zone is mandatory.' });
      if (!zones.some((zone) => text(zone.code) === pickZone)) return res.status(400).json({ error: 'Select a configured Pick Zone.' });

      const [field, label] = ruleFields[text(body.ruleParameter)] || [];
      if (field && !text(body[field])) return res.status(400).json({ error: `${label} is mandatory for the selected rule parameter.` });
      if (text(body.ruleParameter) === '6' && !text(body.toBinRange)) return res.status(400).json({ error: 'To Bin Range is mandatory for the selected rule parameter.' });
      if (text(body.ruleParameter) === '7') {
        const configuredBins = await find('generic_records', { module: 'bin-enquiry' });
        const bin = configuredBins.find((row) => text(row.loc_code) === location[0] && text(row.bin_code || row.code).toLowerCase() === text(body.bin).toLowerCase());
        if (!bin) return res.status(400).json({ error: 'Select a configured Bin for this location.' });
      }

      const existing = body.id ? all.find((row) => row.id === Number(body.id)) : null;
      if (req.method === 'PUT' && !existing) return res.status(404).json({ error: 'Cycle Count Wave was not found.' });
      const sequence = Math.max(0, ...all.map((row) => Number(text(norm(row).waveId).replace(/\D/g, '')) || 0)) + 1;
      const waveId = existing ? norm(existing).waveId : `CCW${String(sequence).padStart(6, '0')}`;
      const fields = {
        module: 'cycle-count-wave', code: waveId, wave_id: waveId,
        name: text(body.waveName), wave_desc: text(body.waveName),
        loc_code: location[0], location: location[1], wave_type: 'Bin',
        sch_method: text(body.schedulingMethod) === '1' ? 'Action Triggered' : 'Periodic',
        start_date: startDate, end_date: endDate,
        status: text(body.waveStatus) === '0' ? 'InActive' : 'Active',
        details: body, modified_by: currentUser(req)?.username || 'unknown', modified_date: new Date().toISOString(),
      };
      if (existing) {
        const [saved] = await update('generic_records', existing.id, fields);
        return res.json({ row: norm(saved), jsonMessage: 'Cycle Count Wave updated successfully' });
      }
      const row = await insert('generic_records', { ...fields, created_by: currentUser(req)?.username || 'unknown', created_date: new Date().toISOString() });
      return res.status(201).json({ row: norm(row), jsonMessage: 'Cycle Count Wave saved successfully' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Cycle Count Wave error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
