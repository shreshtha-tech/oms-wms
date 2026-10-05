import { sendDatabaseUnavailable, cors, find } from './mongo.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const eligible = order => Boolean(text(order.ewb_no));

function normalize(order) {
  return {
    id: order.id,
    integrationType: order.integration_type || '',
    clientId: order.client_id || '',
    updDate: order.ewb_updated_date || order.ship_date || order.order_date || '',
    documentType: order.document_type || '',
    documentNo: order.invoice_no || '',
    referenceNo: order.delivery_no || order.ob_del_no || order.order_no || '',
    referenceNo2: order.order_no || '',
    vehicleNo: order.vehicle_no || '',
    ewbNo: order.ewb_no || '',
    ewbValidity: order.ewb_validity || '',
    referenceType: order.order_type || '',
    isCewbGenerated: order.consolidate_ewb_no ? 'Yes' : 'No',
    consolidateEwbNo: order.consolidate_ewb_no || '',
  };
}

function page(rows, body, root = 'transmitLogDTOs') {
  const size = [20, 50, 100, 200].includes(+body.rows) ? +body.rows : 20;
  const current = Math.max(1, +body.page || 1);
  const records = rows.length;
  const slice = rows.slice((current - 1) * size, current * size);
  return { [root]: slice, gridModel: slice, rows: slice, page: current, total: Math.ceil(records / size), records };
}

function matches(row, body) {
  return has(row.integrationType, body.integrationType) && has(row.documentNo, body.documentNo) &&
    has(row.referenceNo, body.referenceNo) && has(row.referenceNo2, body.referenceNo2) &&
    has(row.vehicleNo, body.vehicleNo) && has(row.ewbNo, body.ewbNo) &&
    has(row.referenceType, body.referenceType) && has(row.isCewbGenerated, body.isCewbGenerated) &&
    has(row.consolidateEwbNo, body.consolidateEwbNo) &&
    (!text(body.fromUpdDate) || row.updDate >= body.fromUpdDate) &&
    (!text(body.toUpdDate) || row.updDate <= body.toUpdDate);
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    const orders = await find('fulfillment_orders');
    const source = orders.filter(eligible);
    const rows = source.map(normalize);

    if (req.method === 'GET') {
      return res.json({
        available: false,
        dataTrust: 'legacy-unverified',
        reason: 'Consolidated e-way bill creation requires a verified government e-way bill connector.',
        integrationTypes: ['E-Way Bill'],
        transportModes: [['1', 'Road'], ['2', 'Rail'], ['3', 'Air'], ['4', 'Ship']],
        reasons: [['4', 'Others']],
        pageSizes: [20, 50, 100, 200],
        counts: { generate: rows.length, history: new Set(rows.map(row => row.consolidateEwbNo).filter(Boolean)).size },
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (body.action === 'search' || body.REQ_SEARCH_FLAG) {
      if (body.tab === 'history') {
        const audits = await find('generic_records', { module: 'consolidate-ewb' });
        const history = audits.map(row => ({
          id: row.id, cewbNo: row.cewb_no, cewbVehicleNo: row.vehicle_no,
          key5: row.trans_mode, transMode: row.trans_mode_name,
          viewDeliveries: 'View Deliveries', crtDate: row.created_date,
          deliveryIds: row.delivery_ids || [], trust: 'legacy-unverified',
        })).filter(row => has(row.cewbNo, body.cewbNo) && has(row.cewbVehicleNo, body.cewbVehicleNo) && has(row.transMode, body.transMode));
        history.sort((left, right) => text(left.crtDate).localeCompare(text(right.crtDate)) * (text(body.sord) === 'asc' ? 1 : -1));
        return res.json({ ...page(history, body), trust: 'legacy-unverified' });
      }
      const results = rows.filter(row => matches(row, body));
      results.sort((left, right) => text(left[body.sidx] || left.updDate).localeCompare(text(right[body.sidx] || right.updDate)) * (text(body.sord) === 'asc' ? 1 : -1));
      return res.json(page(results, body));
    }

    if (body.action === 'deliveries') {
      const audit = (await find('generic_records', { module: 'consolidate-ewb' })).find(row => row.id === +body.id || row.cewb_no === text(body.cewbNo));
      if (!audit) return res.status(404).json({ error: 'Consolidated e-way bill record not found.' });
      const deliveries = source.filter(order => (audit.delivery_ids || []).includes(order.id)).map(order => ({
        documentNo: order.invoice_no || '', referenceNo: order.delivery_no || order.ob_del_no || order.order_no || '',
        ewbNo: order.ewb_no || '',
      }));
      return res.json({ transmitLogDTOs: deliveries, trust: 'legacy-unverified' });
    }

    if (body.action === 'generate' || body.action === 'regenerate') {
      return res.status(501).json({ error: 'Consolidated e-way bill generation is unavailable until a verified government e-way bill connector can create and read back the CEWB.' });
    }
    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Consolidate EWB error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
