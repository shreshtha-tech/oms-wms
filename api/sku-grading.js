import { sendDatabaseUnavailable, cors, find, insert, update } from './mongo.js';
import { locationPairs } from './catalogs.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
const parseDate = value => {
  const valueText = text(value).slice(0, 10);
  const match = valueText.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? new Date(`${valueText}T00:00:00Z`) : null;
};
const normalize = row => ({
  ...row,
  gradeId: row.gradeId || row.grade_id || row.code || '',
  inboundCode: row.inboundCode || row.inbound_no || '',
  crtDate: row.crtDate || row.created_date || '',
  status: String(row.status_code ?? row.status ?? '1'),
  statusText: row.statusText || ({ 1: 'Pending', 4: 'Confirmed' }[row.status_code ?? row.status] || row.status || 'Pending'),
  locCode: row.locCode || row.location_code || '',
  details: row.details || [],
});
const gradeRows = async () => (await find('generic_records', { module: 'sku-grading' })).map(normalize);
const nextId = rows => `SG${String(Math.max(0, ...rows.filter(row => /^SG\d+$/.test(row.gradeId)).map(row => Number(row.gradeId.slice(2)))) + 1).padStart(9, '0')}`;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const rows = await gradeRows();
    if (req.method === 'GET') {
      const id = text(req.query?.gradeId);
      if (id) return res.json({ row: rows.find(row => row.gradeId === id) || null });
      const [locations, grns] = await Promise.all([locationPairs(), find('grn')]);
      const inbound = grns.filter(row => row.inbound_no || row.grn_no).map(row => ({
        id: row.id,
        inboundCode: row.inbound_no || row.grn_no,
        inboundType: row.inbound_type || '',
        inboundDate: row.inbound_date || row.created_date || '',
        locationCode: row.location_code || row.warehouse || '',
      }));
      return res.json({
        available: false,
        message: 'SKU grading is paused until bin, LPN, lot, and grade movements are mapped to Central Inventory.',
        statuses: [['-1', '--- Select ---'], ['4', 'Confirmed'], ['1', 'Pending']],
        locations: [['-1', '--- Select ---'], ...locations],
        pageSizes: [20, 50, 100, 200],
        inboundTypes: ['--- Select ---', 'With QC', 'Against ASN', 'Delivered Return', 'Non Delivered Return', 'With PO', 'With STO', 'Without PO'],
        inbound, inventory: [], exportFields: ['GradeId', 'Inbound No', 'Status', 'Creation Date', 'OrgId', 'locCode'],
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};

    if (['create-line', 'confirm'].includes(body.action)) {
      return res.status(501).json({ error: 'SKU grading is paused until bin, LPN, lot, and grade movements are mapped to Central Inventory.' });
    }

    if (body.action === 'create-line') {
      if (!text(body.inboundNo)) return res.status(400).json({ error: 'Please Select Inbound No' });
      if (!text(body.fromSku) || !text(body.fromBin) || !text(body.toSku) || !text(body.toBin) || !text(body.qty) || !text(body.unitPrice)) {
        return res.status(400).json({ error: 'Invalid Data' });
      }
      if (Number(body.availableQty) < Number(body.qty)) return res.status(400).json({ error: 'Sku available quantity is less than converted quantity.' });
      if (text(body.fromBin).toUpperCase() !== text(body.toBin).toUpperCase() && text(body.fromLpn) === text(body.toLpn)) {
        return res.status(400).json({ error: 'From LPN and To LPN can not be same for different bin code.' });
      }
      let grade = rows.find(row => row.gradeId === text(body.gradeId));
      if (!grade) {
        const location = (await locationPairs()).find(([code]) => code === text(body.locCode));
        if (!location) return res.status(400).json({ error: 'Select a configured location.' });
        const gradeId = nextId(rows);
        const created = await insert('generic_records', {
          module: 'sku-grading', code: gradeId, gradeId,
          inboundCode: text(body.inboundNo), inbound_no: text(body.inboundNo),
          status_code: '1', statusText: 'Pending', locCode: location[0],
          created_date: new Date().toISOString(), details: [],
        });
        grade = normalize(created);
      }
      const line = {
        id: Date.now(), fromLineNo: grade.details.length + 1,
        displaySku: text(body.fromSku), sku: text(body.fromSku), skuDesc: text(body.fromSkuDesc),
        fromBinLoc: text(body.fromBin), fromIdCode: text(body.fromLpn), fromLotNo: text(body.fromLot),
        mrp: Number(body.mrp || 0).toFixed(2), wac: Number(body.wac || 0).toFixed(2),
        rcvdQty: Number(body.qty).toFixed(2), unitPrice: Number(body.unitPrice).toFixed(2),
        toSkuCode: text(body.toSku), toSkuBin: text(body.toBin), toIdCode: text(body.toLpn),
        toLottables: body.lottables || [],
      };
      const details = [...grade.details, line];
      await update('generic_records', grade.id, { details });
      return res.json({ row: { ...grade, details }, message: 'Record Saved Successfully' });
    }
    if (body.action === 'remove') {
      const grade = rows.find(row => row.gradeId === text(body.gradeId));
      if (!grade) return res.status(404).json({ error: 'Grade not found' });
      const details = grade.details.filter(line => String(line.id) !== String(body.id));
      await update('generic_records', grade.id, { details });
      return res.json({ row: { ...grade, details } });
    }
    if (body.action === 'confirm') {
      const grade = rows.find(row => row.gradeId === text(body.gradeId));
      if (!grade || !grade.details.length) return res.status(400).json({ error: 'Invalid Data' });
      await update('generic_records', grade.id, { status_code: '4', statusText: 'Confirmed', confirmed_date: new Date().toISOString() });
      return res.json({ row: { ...grade, status: '4', statusText: 'Confirmed' }, message: 'Record Saved Successfully' });
    }
    if (!body.REQ_SEARCH_FLAG) return res.status(400).json({ error: 'REQ_SEARCH_FLAG is required' });
    const from = parseDate(body.fromCrtDate);
    const to = parseDate(body.toCrtDate);
    let filtered = rows.filter(row => has(row.gradeId, body.gradeId) && has(row.inboundCode, body.inboundCode)
      && (!text(body.status) || text(body.status) === '-1' || row.status === text(body.status))
      && (!text(body.locCode) || text(body.locCode) === '-1' || row.locCode === text(body.locCode)));
    if (from && to) filtered = filtered.filter(row => { const date = parseDate(row.crtDate); return date && date >= from && date <= to; });
    const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
    const page = Math.max(1, Number(body.page) || 1);
    const data = filtered.slice((page - 1) * size, page * size);
    return res.json({
      response: { result: { data, total: Math.ceil(filtered.length / size), rows: data.length }, responseMessage: 'Success', responseCode: 0 },
      gridModel: data, rows: size, page, records: filtered.length, total: Math.ceil(filtered.length / size),
    });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('sku grading error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
