import { sendDatabaseUnavailable, cors, find } from './mongo.js';
import { COD_TRANSPORTERS } from './cod-reconciliation-transporters.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());

function parseDate(value) {
  const input = text(value).slice(0, 10);
  const dmy = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T00:00:00Z`) : null;
}

function normalize(row) {
  const shipments = Array.isArray(row.shipments) ? row.shipments : [];
  const invoices = Array.isArray(row.invoices) ? row.invoices : [];
  const flowCode = String(row.isB2bCode ?? row.flow_code ?? '');
  return {
    id: row.id,
    loadId: row.loadId || row.load_id || row.code || '',
    createdDateString: row.createdDateString || row.created_date || '',
    closedDateString: row.closedDateString || row.closed_date || '',
    vehicleNo: row.vehicleNo || row.vehicle_no || '',
    transporter: row.transporter_name || row.transporter || '',
    transporterCode: row.transporterCode || row.transporter_code || '',
    status: row.status || '',
    statusCode: row.statusCode || '',
    scannedLpn: String(row.scanedLPN ?? row.scanned_box ?? (shipments.length || '')),
    totalLpn: String(row.totalLPN ?? row.total_box ?? ''),
    flowCode,
    flow: row.isB2b || (flowCode === '1' ? 'B2B Flow' : flowCode === '0' ? 'B2C Flow' : ''),
    shipments,
    invoices,
    trust: 'legacy-unverified',
  };
}

async function getRows() {
  return (await find('generic_records', { module: 'dispatch-checkpoint' }))
    .map(normalize)
    .filter(row => /^UWH\d+$/.test(row.loadId));
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const rows = await getRows();
      const loadId = text(req.query?.loadId);
      if (loadId) return res.json({ row: rows.find(row => row.loadId === loadId) || null, trust: 'legacy-unverified' });
      return res.json({
        available: false,
        dataTrust: 'legacy-unverified',
        reason: 'Vehicle, carrier, invoice, and LPN dispatch events require verified sources and a Central Inventory dispatch transaction.',
        transporters: COD_TRANSPORTERS,
        statuses: [['-1', '--- Select ---'], ['1', 'Approval Pending'], ['15', 'Closed'], ['5', 'In Process']],
        flows: [['-1', '--- Select ---'], ['0', 'B2C Flow'], ['1', 'B2B Flow']],
        pageSizes: [20, 50, 100, 200],
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    if (body.action || body.REQ_SEARCH_FLAG !== true) {
      return res.status(501).json({ error: 'Dispatch Checkpoint is read-only until vehicle, carrier, proof-of-delivery, and Central Inventory event sources are connected.' });
    }

    if (!text(body.loadId) && !text(body.fromCreatedDate) && (!text(body.status) || text(body.status) === '-1') &&
      (!text(body.transporter) || text(body.transporter) === '-1') && !text(body.vehicleNo) &&
      (!text(body.isB2b) || text(body.isB2b) === '-1') && !text(body.fromCloseDate)) {
      return res.status(400).json({ error: 'Select at least one search field.' });
    }

    const from = parseDate(body.fromCreatedDate);
    const to = parseDate(body.toCreatedDate);
    const closeFrom = parseDate(body.fromCloseDate);
    const closeTo = parseDate(body.toCloseDate);
    if ((from && to && (to - from) / 86400000 > 90) || (closeFrom && closeTo && (closeTo - closeFrom) / 86400000 > 90)) {
      return res.status(400).json({ error: 'Date range cannot be greater than 90 days.' });
    }

    let rows = (await getRows()).filter(row =>
      has(row.loadId, body.loadId) && has(row.vehicleNo, body.vehicleNo) &&
      (!text(body.status) || text(body.status) === '-1' || row.statusCode === text(body.status)) &&
      (!text(body.transporter) || text(body.transporter) === '-1' || row.transporterCode === text(body.transporter)) &&
      (!text(body.isB2b) || text(body.isB2b) === '-1' || row.flowCode === text(body.isB2b)));
    if (from && to) rows = rows.filter(row => { const date = parseDate(row.createdDateString); return date && date >= from && date <= to; });
    if (closeFrom && closeTo) rows = rows.filter(row => { const date = parseDate(row.closedDateString); return date && date >= closeFrom && date <= closeTo; });
    rows.sort((left, right) => text(right.createdDateString).localeCompare(text(left.createdDateString)));

    const size = [20, 50, 100, 200].includes(+body.rows) ? +body.rows : 20;
    const page = Math.max(1, +body.page || 1);
    const records = rows.length;
    return res.json({
      gridModel: rows.slice((page - 1) * size, page * size), rows: size, page,
      records, total: Math.ceil(records / size), trust: 'legacy-unverified',
    });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Dispatch Checkpoint error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
