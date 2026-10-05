import { sendDatabaseUnavailable, cors, find } from './mongo.js';
import { locationPairs, transporterPairs } from './catalogs.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const normalize = row => ({
  ...row,
  siteLocName: row.site_loc_name || '', siteLocCode: row.site_loc_code || '',
  pinCode: row.pin_code || '', orderType: row.order_type || '', orderTypeCode: row.order_type_code || '',
  transporter: row.transporter || '', transporterCode: row.transporter_code || '',
  courierType: row.courier_type || '', prefOrder: row.pref_order || '',
  createdBy: row.created_by || '', recordUpby: row.modified_by || '', updatedDate: row.modified_date || '',
});

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const [locations, transporters] = await Promise.all([locationPairs(), transporterPairs()]);
      return res.json({
        locations,
        orderTypes: [['', '- Select -'], ['C', 'COD'], ['NC', 'Prepaid']],
        transporters: [['', '- Select -'], ...transporters],
        courierTypes: [['-1', '- Select -'], ['1', 'Forward'], ['0', 'Reverse']],
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    const all = await find('generic_records', { module: 'transporter-preference' });
    const matches = all.map(normalize).filter(row =>
      has(row.pinCode, body.pinCode) && has(row.siteLocCode, body.siteLocCode)
      && has(row.transporterCode, body.transporter) && has(row.orderTypeCode, body.orderType)
      && has(row.courierType, body.courierType === '1' ? 'Forward' : body.courierType === '0' ? 'Reverse' : body.courierType));
    const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
    const page = Math.max(1, Number(body.page) || 1);
    const records = matches.length, total = Math.ceil(records / size);
    const gridModel = matches.slice((page - 1) * size, page * size);
    return res.json({ gridModel, transporterPreferenceDTOs: gridModel, rows: size, page, total, records, sidx: text(body.sidx) || 'locCode', sord: text(body.sord) || 'asc' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Transporter Preference error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
