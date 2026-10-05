import { sendDatabaseUnavailable, find, findOne, insertCustomer, update, cors, actor } from './mongo.js';

const normalizeType = (value) => ({ '0-Last': '0 - Last', '1-B2C': '1 - B2C', '2-B2B': '2 - B2B', '0': '0 - Last', '1': '1 - B2C', '2': '2 - B2B' }[String(value)] || value);
const toCustomer = (p) => ({ ...p, customer_code: p.customer_code || p.code, customer_name: p.customer_name || p.name, is_active: p.is_active ?? true, type: normalizeType(p.customer_type || (p.type === 'Customer' ? '1 - B2C' : p.type) || '1 - B2C'), primary_contact: p.primary_contact || p.contact || '', primary_email: p.primary_email || p.email || '', gstin_tin: p.gstin_tin || p.gstin || '', created_date: p.created_date || '' });
const clean = (b) => ({ ...b, code: b.customer_code, name: b.customer_name, customer_type: b.type, contact: b.primary_contact, email: b.primary_email, gstin: b.gstin_tin, city: b.shipping_city || b.city || '', state: b.shipping_state || b.state || '', phone: b.shipping_phone || b.phone || '' });
async function validateGroup(code, currentCode = '') {
  if (!code) return null;
  const group = await findOne('generic_records', { module: 'customer-group', code });
  if (!group) return 'Customer Group does not exist';
  if (group.status !== 'Active' && code !== currentCode) return 'Inactive Customer Group cannot be assigned';
  return null;
}

export default async function handler(req, res) {
    if (cors(req, res)) return;
  try {
    if (req.method === 'GET') return res.status(200).json((await find('partners', { type: 'Customer' }, { sort: { id: -1 } })).map(toCustomer));
    if (req.method === 'POST') {
      const { id: ignoredId, _id: ignoredMongoId, ...b } = req.body;
      if (String(b.REQ_SEARCH_FLAG) === 'true') {
        const requestedType = normalizeType(b.type || '');
        const requestedActive = String(b.isActive ?? '-1');
        const all = (await find('partners', { type: 'Customer' }, { sort: { id: -1 } })).map(toCustomer);
        const tests = (customer) => [
          [customer.customer_code, b.customerCode, true], [customer.customer_name, b.customerName],
          [customer.ext_customer_code, b.extCustomerCode], [customer.type, requestedType],
          [customer.primary_contact, b.primaryContact], [customer.primary_email, b.primaryEmail],
          [customer.gstin_tin, b.gstIn_tinNo],
        ].every(([actual, expected, begins]) => !String(expected || '').trim() || (begins ? String(actual || '').toLowerCase().startsWith(String(expected).trim().toLowerCase()) : String(actual || '').toLowerCase().includes(String(expected).trim().toLowerCase())))
          && (requestedActive === '-1' || requestedActive === '' || customer.is_active === (requestedActive === '1'));
        const matches = all.filter(tests), rows = Math.max(1, Number(b.rows) || 20), page = Math.max(1, Number(b.page) || 1), total = Math.ceil(matches.length / rows), gridModel = matches.slice((page - 1) * rows, page * rows);
        return res.status(200).json({ customerEnquiryDTOs: gridModel.length ? gridModel : null, gridModel: gridModel.length ? gridModel : null, loadonce: false, page: matches.length ? page : 0, records: matches.length, rows, searchField: null, searchOper: null, searchString: null, sidx: b.sidx || 'id.customerCode', sord: b.sord || 'desc', total });
      }
      if (!String(b.customer_name || '').trim()) return res.status(400).json({ error: 'Please Enter Customer Name' });
      if (!b.type || b.type === '--- Select ---') return res.status(400).json({ error: 'Please Enter Type' });
      const groupError = await validateGroup(b.customer_group_code); if (groupError) return res.status(400).json({ error: groupError });
      for (const [key, label] of [['primary_email', 'Email'], ['primary_contact', 'Phone'], ['gstin_tin', 'GSTIN/TIN']]) if (b[key] && (await findOne('partners', { [key === 'primary_email' ? 'email' : key === 'primary_contact' ? 'contact' : 'gstin']: b[key] }))) return res.status(409).json({ error: `${label} already exists for another customer` });
      const saved = await insertCustomer({ ...clean(b), type: 'Customer', created_date: new Date().toISOString().slice(0, 10), created_by: actor(req), modified_date: '', modified_by: '', is_active: b.is_active !== false });
      return res.status(201).json(toCustomer(saved));
    }
    if (req.method === 'PUT') {
      const { id, _id: ignoredMongoId, ...b } = req.body; const current = await findOne('partners', { id: Number(id) }); if (!current || current.type !== 'Customer') return res.status(404).json({ error: 'Customer not found' });
      const next = clean({ ...toCustomer(current), ...b, customer_code: current.customer_code || current.code });
      if (!String(next.name || '').trim()) return res.status(400).json({ error: 'Please Enter Customer Name' });
      const groupError = await validateGroup(next.customer_group_code, current.customer_group_code || ''); if (groupError) return res.status(400).json({ error: groupError });
      for (const [field, label] of [['email', 'Email'], ['contact', 'Phone'], ['gstin', 'GSTIN/TIN']]) { if (next[field]) { const duplicate = (await find('partners', { [field]: next[field] })).find((p) => p.type === 'Customer' && p.id !== Number(id)); if (duplicate) return res.status(409).json({ error: `${label} already exists for another customer` }); } }
      // Orders and returns retain the customer name recorded at transaction time.
      // A name match alone cannot safely identify every historical customer.
      const [saved] = await update('partners', Number(id), { ...next, type: 'Customer', customer_code: current.customer_code || current.code, code: current.customer_code || current.code, created_date: current.created_date, created_by: current.created_by, modified_date: new Date().toISOString().slice(0, 10), modified_by: actor(req) });
      return res.status(200).json(toCustomer(saved));
    }
    if (req.method === 'DELETE') return res.status(409).json({ error: 'Customers cannot be deleted. Set Is Active off instead.' });
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return; console.error('customers error:', { name: err?.name, code: err?.code }); res.status(500).json({ error: err.message }); }
}
