import { sendDatabaseUnavailable, cors, find, insert, remove } from './mongo.js';
import { locationPairs, transporterPairs } from './catalogs.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || ['-1', 'Select'].includes(text(query)) || text(value).toLowerCase().includes(text(query).toLowerCase());
const normalize = row => ({
  ...row, awbNo: row.awb_no || row.code || '', siteLocCode: row.site_loc_code || '',
  locationName: row.location_name || '', orderType: row.order_type || 'Prepaid',
  status: row.status || 'Free', awbSearchTransporter: row.transporter_name || '',
  transporterCode: row.transporter_code || '', courierType: row.courier_type || 'Forward',
});

function page(rows, body, key = 'rows') {
  const size = [20, 50, 100, 200].includes(+body.rows) ? +body.rows : 20;
  const current = Math.max(1, +body.page || 1);
  const records = rows.length;
  return { [key]: rows.slice((current - 1) * size, current * size), rows: size,
    page: current, total: Math.ceil(records / size), records,
    sidx: text(body.sidx) || 'awbNo', sord: text(body.sord) || 'asc' };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    const all = await find('generic_records', { module: 'manage-awb' });
    if (req.method === 'GET') return res.json({
      locations: await locationPairs(), transporters: await transporterPairs(),
      orderTypes: [['-1', '--- Select ---'], ['Non COD', 'Prepaid'], ['TRF', 'Normal'], ['COD', 'COD']],
      statuses: [['-1', '--- Select ---'], ['0', 'Free'], ['1', 'Issued']],
      courierTypes: [['Select', '--- Select ---'], ['1', 'Forward'], ['2', 'Reverse']],
    });

    if (req.method === 'POST' && ['search', 'summary'].includes(body.action)) {
      const awbs = text(body.fromAwbSearchNo).split(',').map(text).filter(Boolean);
      const rows = all.map(normalize).filter(row =>
        has(row.siteLocCode, body.locationCode) &&
        (!awbs.length || awbs.some(awb => has(row.awbNo, awb))) &&
        has(row.status, body.status === '0' ? 'Free' : body.status === '1' ? 'Issued' : body.status) &&
        has(row.orderType, body.orderType) && has(row.transporterCode, body.awbTransporter || body.transporter) &&
        has(row.courierType, body.awbReverse === '1' ? 'Forward' : body.awbReverse === '2' ? 'Reverse' : body.awbReverse));
      if (body.action !== 'summary') return res.json(page(rows, body, 'awbDetailSearchDTOs'));
      const grouped = new Map();
      for (const row of rows) {
        const key = [row.transporterCode, row.siteLocCode, row.orderType, row.status].join('|');
        const value = grouped.get(key) || { awbSearchTransporter: row.awbSearchTransporter,
          locationName: row.locationName, orderType: row.orderType, status: row.status, awbNo: 0 };
        value.awbNo += 1;
        grouped.set(key, value);
      }
      return res.json(page([...grouped.values()], body, 'awbSummarySearchDTOs'));
    }

    if (req.method === 'POST') {
      const selectedLocation = (await locationPairs()).find(([code]) => code === text(body.siteLocCode));
      const selectedTransporter = (await transporterPairs()).find(([code]) => code === text(body.transporterCode));
      if (!selectedLocation) return res.status(400).json({ error: 'Select a configured Site Location.' });
      if (!selectedTransporter) return res.status(400).json({ error: 'Select a configured Transporter.' });
      if (!text(body.orderType) || body.orderType === '-1') return res.status(400).json({ error: 'Order Type is mandatory' });
      let values;
      if (body.mode === 'single') {
        if (!text(body.singleAwb)) return res.status(400).json({ error: 'AWB No. is mandatory' });
        values = [text(body.singleAwb)];
      } else {
        if (!text(body.fromAwb) || !text(body.toAwb)) return res.status(400).json({ error: 'AWB series From and To are mandatory' });
        const first = +body.fromAwb, last = +body.toAwb;
        if (!Number.isInteger(first) || !Number.isInteger(last) || last < first || last - first > 499) return res.status(400).json({ error: 'Invalid AWB series' });
        values = Array.from({ length: last - first + 1 }, (_, index) => `${text(body.prefix)}${first + index}${text(body.suffix)}`);
      }
      const existing = new Set(all.map(row => normalize(row).awbNo));
      let count = 0;
      for (const awb of values) if (!existing.has(awb)) {
        await insert('generic_records', { module: 'manage-awb', code: awb, awb_no: awb,
          site_loc_code: selectedLocation[0], location_name: selectedLocation[1],
          transporter_code: selectedTransporter[0], transporter_name: selectedTransporter[1],
          order_type: body.orderType === 'Non COD' ? 'Prepaid' : body.orderType === 'TRF' ? 'Normal' : body.orderType,
          status: body.status === '1' ? 'Issued' : 'Free', courier_type: body.courierType === '2' ? 'Reverse' : 'Forward',
          created_date: new Date().toISOString() });
        count += 1;
      }
      return res.status(201).json({ jsonMessage: `${count} AWB record(s) saved successfully` });
    }

    if (req.method === 'DELETE') {
      for (const id of Array.isArray(body.ids) ? body.ids : []) {
        const row = all.find(candidate => candidate.id === +id);
        if (row && normalize(row).status === 'Free') await remove('generic_records', row.id);
      }
      return res.json({ jsonMessage: 'Selected free AWB record(s) deleted successfully' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Manage AWB error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
