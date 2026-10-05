import { sendDatabaseUnavailable, find, findOne, insert, update, cors, actor } from './mongo.js';

const toTransporter = (p) => ({ ...p, transporter_code: p.transporter_code || p.code, transporter_name: p.transporter_name || p.name, transporter_company_name: p.transporter_company_name || '', transporter_type: p.transporter_type || 'Courier', country: p.country || 'INDIA', status: p.status || 'Active', is_active: p.is_active ?? true });
const clean = (b) => ({ ...b, code: b.transporter_code, name: b.transporter_name, type: 'Transporter', transporter_type: b.transporter_type, contact: b.contact_person || b.contact || '', phone: b.phone || '', email: b.email || '', city: b.city || '', state: b.state || '', gstin: b.gstin_cin || b.gstin || '' });
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') return res.status(200).json((await find('partners', { type: 'Transporter' }, { sort: { id: -1 } })).map(toTransporter));
    if (req.method === 'POST') {
      const { id: ignoredId, _id: ignoredMongoId, ...b } = req.body; const code = String(b.transporter_code || '').trim(); const name = String(b.transporter_name || '').trim();
      if (String(b.REQ_SEARCH_FLAG) === 'true') {
        const requestedType = { '2': 'Courier', '1': 'Own Fleet' }[String(b.type)] || b.type;
        const requestedStatus = String(b.status ?? '-1');
        const all = (await find('partners', { type: 'Transporter' }, { sort: { id: -1 } })).map(toTransporter);
        const matches = all.filter((row) => [[row.transporter_code, b.transporterCode], [row.transporter_name, b.transporterName], [row.transporter_company_name, b.transporterCompanyName], [row.transporter_type, requestedType], [row.country, b.country], [row.state, b.state], [row.city, b.city]].every(([actual, expected]) => !String(expected || '').trim() || String(actual || '').toLowerCase().includes(String(expected).trim().toLowerCase())) && (requestedStatus === '-1' || requestedStatus === '' || row.is_active === (requestedStatus === '1')));
        const rows = Math.max(1, Number(b.rows) || 20), page = Math.max(1, Number(b.page) || 1), total = Math.ceil(matches.length / rows), gridModel = matches.slice((page - 1) * rows, page * rows);
        return res.status(200).json({ country: b.country || '', countryMap: {}, gridModel: gridModel.length ? gridModel : null, loadonce: false, page, records: matches.length, rows, searchField: null, searchOper: null, searchString: null, sidx: b.sidx || 'transCode', sord: b.sord || 'asc', state: b.state || '', stateMap: null, total, transporterDTO: { city: b.city || null, client: b.client || '0', country: b.country || null, fromRecords: (page - 1) * rows, sortColumnName: b.sidx || 'transCode', sortType: b.sord || 'asc', state: b.state || null, status: requestedStatus === '-1' ? null : requestedStatus, toRecords: page * rows, transporterCode: b.transporterCode || null, transporterCompanyName: b.transporterCompanyName || null, transporterName: b.transporterName || null, type: b.type || null }, transporterEnquiryDTOs: gridModel.length ? gridModel : null, typeMap: {} });
      }
      if (!b.carrier_type || b.carrier_type === '--- Select ---') return res.status(400).json({ error: 'Please Select Transport Type' });
      if (!b.transporter_type || b.transporter_type === '--- Select ---') return res.status(400).json({ error: 'trans type is mandatory' });
      if (!code || !name) return res.status(400).json({ error: 'Transporter Code and Transporter Name are required' });
      if (!/^\d+$/.test(code)) return res.status(400).json({ error: 'pleas enter only numbers in transporter code' });
      if (await findOne('partners', { code })) return res.status(409).json({ error: `Transporter Code "${code}" already exists` });
      if ((await find('partners', { name })).some((p) => p.type === 'Transporter')) return res.status(409).json({ error: `Transporter Name "${name}" already exists` });
      return res.status(201).json(toTransporter(await insert('partners', { ...clean({ ...b, transporter_code: code, transporter_name: name }), status: b.is_active === false ? 'Inactive' : 'Active', is_active: b.is_active !== false, created_date: new Date().toISOString().slice(0, 10), created_by: actor(req), modified_date: '', modified_by: '' })));
    }
    if (req.method === 'PUT') {
      const { id, _id: ignoredMongoId, ...b } = req.body; const current = await findOne('partners', { id: Number(id) }); if (!current || current.type !== 'Transporter') return res.status(404).json({ error: 'Transporter not found' });
      const currentView = toTransporter(current); const next = clean({ ...currentView, ...b, transporter_code: currentView.transporter_code }); const code = String(next.code || '').trim(); const name = String(next.name || '').trim();
      if (!code || !name) return res.status(400).json({ error: 'Transporter Code and Transporter Name are required' });
      const duplicate = (await find('partners', { code })).find((p) => p.id !== Number(id)); if (duplicate) return res.status(409).json({ error: `Transporter Code "${code}" already exists` });
      const duplicateName = (await find('partners', { name })).find((p) => p.type === 'Transporter' && p.id !== Number(id));
      if (duplicateName) return res.status(409).json({ error: `Transporter Name "${name}" already exists` });
      // Fulfillment and shipment records preserve the carrier name observed when issued.
      const active = b.is_active ?? currentView.is_active;
      const [saved] = await update('partners', Number(id), { ...next, code, name, type: 'Transporter', transporter_code: code, transporter_name: name, status: active ? 'Active' : 'Inactive', is_active: active, created_date: current.created_date, created_by: current.created_by, modified_date: new Date().toISOString().slice(0, 10), modified_by: actor(req) }); return res.status(200).json(toTransporter(saved));
    }
    if (req.method === 'DELETE') return res.status(409).json({ error: 'Transporters cannot be deleted. Set Is Active off instead.' });
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return; console.error('transporters error:', { name: err?.name, code: err?.code }); res.status(500).json({ error: err.message }); }
}
