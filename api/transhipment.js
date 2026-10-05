import { sendDatabaseUnavailable, cors, find, update } from './mongo.js';

const text = value => String(value ?? '').trim();
const labels = { pending: 'Pending', received: 'Received', qcPass: 'QC Passed', qcFail: 'QC Failed', shipped: 'Shipped' };
const normalize = row => ({
  ...row,
  lpn: row.lpn || row.code || '',
  docNo: row.docNo || row.doc_no || '',
  docNo2: row.docNo2 || row.doc_no2 || '',
  status: row.status || '',
  statusLabel: labels[row.status] || row.status || '',
  priority: row.priority || '',
  fragile: row.fragile == null ? '' : row.fragile ? 'Yes' : 'No',
  shipTogether: row.shipTogether == null ? '' : row.shipTogether ? 'Yes' : 'No',
  originLocation: row.originLocation || '',
  destLocation: row.destLocation || '',
  transhipmentType: row.transhipmentType === '1' ? 'Return' : row.transhipmentType === '0' ? 'Order' : '',
});
const all = async () => (await find('generic_records', { module: 'transhipment' })).map(normalize);
const page = (rows, body) => {
  const size = [15, 50, 100, 200, 500, 1000].includes(Number(body.rows)) ? Number(body.rows) : 15;
  const current = Math.max(1, Number(body.page) || 1);
  const records = rows.length;
  return { gridModel: rows.slice((current - 1) * size, current * size), page: current, total: Math.ceil(records / size), records };
};
const unavailable = res => res.status(501).json({ error: 'Transhipment stock, manifest, print, and export actions are unavailable until their Central Inventory and document services are connected.' });

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.json({
        tabs: [['pending', 'Pending'], ['received', 'Received'], ['qcPass', 'QC Passed'], ['qcFail', 'QC Failed'], ['shipped', 'Dispatched'], ['displayAll', 'All']],
        durations: [['30', '1 Month'], ['365', '1 Year'], ['90', '3 Month'], ['180', '6 Month'], ['0', 'ALL']],
        pageSizes: [15, 50, 100, 200, 500, 1000],
        qcReasons: [['-1', '--- Select ---'], ['1', 'Damaged'], ['3', 'LPN not found'], ['2', 'Seal Broken']],
        printTypes: [['-1', '--- Select ---'], ['1', 'Doc No'], ['2', 'Doc No2'], ['3', 'LPN']],
        scanStatuses: [['-1', '--- Select ---'], ['7', 'Cancelled'], ['9', 'Deleted'], ['1', 'Pending'], ['25', 'QC Failed'], ['20', 'QC Passed'], ['10', 'Received'], ['30', 'Shipped']],
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    if (body.action && body.action !== 'udf') {
      return unavailable(res);
    }

    const rows = await all();
    if (body.action === 'udf') {
      const row = rows.find(item => item.id === Number(body.id));
      if (!row) return res.status(404).json({ error: 'No data found.' });
      const fields = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`udf${index + 1}`, text(body[`udf${index + 1}`])]));
      await update('generic_records', row.id, fields);
      return res.json({ message: 'User-defined fields saved.', jsonMessage: null });
    }

    const filtered = rows.filter(row =>
      (body.status === 'displayAll' || !body.status || row.status === body.status) &&
      (!text(body.lpn) || row.lpn.toLowerCase().includes(text(body.lpn).toLowerCase())) &&
      (!text(body.docNo) || row.docNo.toLowerCase().includes(text(body.docNo).toLowerCase())) &&
      (!text(body.docNo2) || row.docNo2.toLowerCase().includes(text(body.docNo2).toLowerCase())),
    );
    return res.json(page(filtered, body));
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('transhipment error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
