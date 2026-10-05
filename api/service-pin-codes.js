import { sendDatabaseUnavailable, cors, find, insert, update, remove } from './mongo.js';
import { locations, transporterPairs } from './catalogs.js';
import { currentUser } from './auth-session.js';

const t = (v) => String(v ?? '').trim();
const has = (v, q) => !t(q) || ['-1'].includes(t(q)) || t(v).toLowerCase().includes(t(q).toLowerCase());
const norm = (r) => ({
  ...r, pinCode: r.pin_code || r.code || '', pinCodeDel: r.pin_code || r.code || '',
  siteLocName: r.site_loc_name || '', siteLocCode: r.site_loc_code || '',
  displayFromEmbargoStartDate: r.embargo_start || '', displayFromEmbargoEndDate: r.embargo_end || '',
  areaCode: r.area_code || '', orderType: r.order_type || '', orderTypeCode: r.order_type_code || '',
  courierType: r.courier_type || '', courierTypeCode: r.courier_type_code || '',
  transporter: r.transporter || '', transporterCode: r.transporter_code || '', slaDays: r.sla_days || '', sellerPinCode: r.seller_pin_code || null,
});

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const b = req.body || {}, all = await find('generic_records', { module: 'service-pin-code' });
    if (req.method === 'GET') return res.json({
      locations: (await locations()).map(row => [row.code, row.name]),
      orderTypes: [['-1', '--- Select ---'], ['C', 'COD'], ['NC', 'Prepaid']],
      courierTypes: [['-1', '--- Select ---'], ['0', 'Reverse'], ['1', 'Forward']],
      transporters: [['-1', '--- Select ---'], ...await transporterPairs()],
    });
    if (req.method === 'POST' && (b.REQ_SEARCH_FLAG || b.action === 'search')) {
      let matches = all.map(norm).filter((x) =>
        (has(x.transporterCode, b.transporter) || has(x.transporter, b.transporter)) &&
        (has(x.orderTypeCode, b.orderType) || has(x.orderType, b.orderType)) &&
        (has(x.siteLocCode, b.siteLocCode) || has(x.siteLocName, b.siteLocCode)) &&
        has(x.pinCode, b.pinCode || b.sellerPinCode) && has(x.areaCode, b.areaCode) &&
        (has(x.courierTypeCode, b.courierType) || has(x.courierType, b.courierType)) && has(x.slaDays, b.slaDays) &&
        (!t(b.fromEmbargoStartDate) || x.displayFromEmbargoStartDate >= b.fromEmbargoStartDate) &&
        (!t(b.toEmbargoStartDate) || x.displayFromEmbargoStartDate <= b.toEmbargoStartDate) &&
        (!t(b.fromEmbargoEndDate) || x.displayFromEmbargoEndDate >= b.fromEmbargoEndDate) &&
        (!t(b.toEmbargoEndDate) || x.displayFromEmbargoEndDate <= b.toEmbargoEndDate));
      const sidx = t(b.sidx) || 'areapinmapPK.pinCode', sord = t(b.sord).toLowerCase() === 'desc' ? 'desc' : 'asc';
      const key = sidx.includes('pinCode') ? 'pinCode' : sidx;
      matches.sort((a, c) => String(a[key] ?? '').localeCompare(String(c[key] ?? ''), undefined, { numeric: true }) * (sord === 'desc' ? -1 : 1));
      const rows = [20, 50, 100, 200].includes(+b.rows) ? +b.rows : 20, page = Math.max(1, +b.page || 1), records = matches.length, total = Math.ceil(records / rows);
      const gridModel = matches.slice((page - 1) * rows, page * rows);
      return res.json({ gridModel, isError: null, jsonMessage: null, loadonce: false, page, records, rows, sidx, sord, total });
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      if (!t(b.siteLocCode) || b.siteLocCode === '-1') return res.status(400).json({ error: 'Please select the Location' });
      if (!t(b.transporterCode) || b.transporterCode === '-1') return res.status(400).json({ error: 'Please select the Transporter' });
      const configuredLocation = (await locations()).find(row => row.code === t(b.siteLocCode));
      if (!configuredLocation) return res.status(400).json({ error: 'Please select a configured Location' });
      const configuredTransporter = (await transporterPairs()).find(([code]) => code === t(b.transporterCode));
      if (!configuredTransporter) return res.status(400).json({ error: 'Please select a configured Transporter' });
      if (!t(b.orderTypeCode) || b.orderTypeCode === '-1') return res.status(400).json({ error: 'Please select the Order Type' });
      if (!t(b.courierTypeCode) || b.courierTypeCode === '-1') return res.status(400).json({ error: 'Please Select The Courier Type' });
      if (!t(b.pinCode)) return res.status(400).json({ error: 'Please Enter Pin Code' });
      if (!/^[a-z0-9]+$/.test(t(b.pinCode))) return res.status(400).json({ error: 'Pin Code must be numeric value' });
      if (!t(b.embargoStart) && t(b.embargoEnd)) return res.status(400).json({ error: 'Embargo Start Date is required' });
      if (!t(b.embargoEnd) && t(b.embargoStart)) return res.status(400).json({ error: 'Embargo End Date is required' });
      if (b.embargoStart && b.embargoEnd && b.embargoStart > b.embargoEnd) return res.status(400).json({ error: 'Embargo Start date cannot be greater than Embargo End date' });
      if (b.embargoEnd && b.embargoEnd < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'end date cannot be less than today' });
      const existing = b.id ? all.find((y) => y.id === +b.id) : all.find((y) => { const n = norm(y); return n.pinCode === t(b.pinCode) && n.siteLocCode === b.siteLocCode && n.orderTypeCode === b.orderTypeCode && n.courierTypeCode === b.courierTypeCode && n.transporterCode === b.transporterCode; });
      const fields = { module: 'service-pin-code', code: t(b.pinCode), pin_code: t(b.pinCode), site_loc_code: configuredLocation.code, site_loc_name: configuredLocation.name, transporter_code: configuredTransporter[0], transporter: configuredTransporter[1], order_type_code: b.orderTypeCode, order_type: b.orderTypeCode === 'C' ? 'COD' : 'Prepaid', courier_type_code: b.courierTypeCode, courier_type: b.courierTypeCode === '1' ? 'Forward' : 'Reverse', embargo_start: t(b.embargoStart), embargo_end: t(b.embargoEnd), area_code: t(b.areaCode), sla_days: t(b.slaDays), modified_by: currentUser(req)?.username || 'unknown', modified_date: new Date().toISOString() };
      if (existing) { const u = await update('generic_records', existing.id, fields); return res.json({ row: norm(u[0]), jsonMessage: 'pin code saved successfully' }); }
      const row = await insert('generic_records', { ...fields, created_by: currentUser(req)?.username || 'unknown', created_date: new Date().toISOString() });
      return res.status(201).json({ row: norm(row), jsonMessage: 'pin code saved successfully' });
    }
    if (req.method === 'DELETE') {
      const ids = Array.isArray(b.ids) ? b.ids : [];
      if (!ids.length) return res.status(400).json({ error: 'Please select Pin Code for delete' });
      for (const id of ids) { const x = all.find((y) => y.id === +id); if (x) await remove('generic_records', x.id); }
      return res.json({ jsonMessage: 'Pin Code Deleted Successfully' });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    if (sendDatabaseUnavailable(res, e)) return; console.error('Service Pin Code error:', { name: e?.name, code: e?.code }); res.status(500).json({ error: e.message }); }
}
