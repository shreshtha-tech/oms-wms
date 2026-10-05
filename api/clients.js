import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';
import { currentUser } from './auth-session.js';

const text = value => String(value ?? '').trim();
const isClient = row => row.type === 'Client' || row.partner_type === 'Client';
const clientStatus = value => {
  const status = text(value).toLowerCase();
  if (status === '1' || status === 'active') return 'Active';
  if (status === '0' || status === 'inactive') return 'Inactive';
  return '';
};

function normalize(row) {
  const status = clientStatus(row.status) || (row.is_active === false ? 'Inactive' : 'Active');
  return {
    ...row,
    client_id: row.client_id || row.code,
    client_name: row.client_name || row.name,
    client_short_name: row.client_short_name || '',
    status,
    is_active: row.is_active ?? status === 'Active',
  };
}

function clean(body) {
  return {
    ...body,
    code: text(body.client_id), name: text(body.client_name), type: 'Client', partner_type: 'Client',
    client_id: text(body.client_id), client_name: text(body.client_name), client_short_name: text(body.client_short_name),
    contact: text(body.contact_person), phone: text(body.phone), email: text(body.email), city: text(body.city),
    state: text(body.state), gstin: text(body.gstin),
  };
}

function validate(body, { requireStatus = true } = {}) {
  const id = text(body.client_id);
  if (!/^\d{1,10}$/.test(id)) return 'Client Id must be a numeric value of at most 10 digits.';
  for (const [key, label] of [
    ['client_name', 'Client Name'], ['client_short_name', 'Client Short Name'], ['client_currency', 'Client Currency'],
    ['address1', 'Address1'], ['phone', 'Phone'], ['country', 'Country'], ['state', 'State'], ['city', 'City'], ['pincode', 'Pin Code'],
  ]) if (!text(body[key]) || text(body[key]) === '-1' || text(body[key]) === '--- Select ---') return `${label} is mandatory.`;
  if (requireStatus && !clientStatus(body.status)) return 'Status is mandatory.';
  if (text(body.email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text(body.email))) return 'Wrong Email.';
  if (text(body.shelf_life_receiving) && !/^\d+$/.test(text(body.shelf_life_receiving))) return 'Shelf Life Receiving must be an integer value';
  return '';
}

function duplicateName(rows, name, exceptId = null) {
  const normalizedName = text(name).toLowerCase();
  return rows.some(row => isClient(row) && row.id !== exceptId && text(row.client_name || row.name).toLowerCase() === normalizedName);
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const clients = (await find('partners')).filter(isClient).sort((left, right) => Number(right.id || 0) - Number(left.id || 0));

    if (req.method === 'GET') return res.status(200).json(clients.map(normalize));

    if (req.method === 'POST' && String(req.body?.REQ_SEARCH_FLAG) === 'true') {
      const body = req.body;
      const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
      const filtered = clients.map(normalize).filter(row =>
        has(row.client_id, body.clientId) && has(row.client_name, body.clientName)
        && has(row.client_short_name, body.clientShortName) && has(row.status, body.status)
        && has(row.country, body.country) && has(row.state, body.state) && has(row.city, body.city));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = filtered.length;
      const gridModel = filtered.slice((page - 1) * size, page * size);
      return res.status(200).json({
        gridModel: gridModel.length ? gridModel : null, rows: gridModel.length ? gridModel : null,
        page, records, total: Math.ceil(records / size), sidx: String(body.sidx || 'clientId'), sord: String(body.sord || 'desc'),
      });
    }

    if (req.method === 'POST') {
      const { id: ignoredId, _id: ignoredMongoId, ...body } = req.body || {};
      const error = validate(body);
      if (error) return res.status(400).json({ error });
      const id = text(body.client_id);
      if (clients.some(row => text(row.client_id || row.code) === id)) return res.status(409).json({ error: 'Client Id Already Exist.' });
      if (duplicateName(clients, body.client_name)) return res.status(409).json({ error: 'Client Name Already Exist.' });
      const actor = currentUser(req)?.username || 'unknown';
      const timestamp = new Date().toISOString();
      const status = clientStatus(body.status);
      const row = await insert('partners', {
        ...clean(body), status, is_active: status === 'Active', created_date: timestamp,
        created_by: actor, modified_date: timestamp, modified_by: actor,
      });
      return res.status(201).json(normalize(row));
    }

    if (req.method === 'PUT') {
      const { id, _id: ignoredMongoId, ...body } = req.body || {};
      const current = await findOne('partners', { id: Number(id) });
      if (!current || !isClient(current)) return res.status(404).json({ error: 'Client not found' });
      const merged = { ...normalize(current), ...body, client_id: text(body.client_id ?? current.client_id ?? current.code) };
      const error = validate(merged);
      if (error) return res.status(400).json({ error });
      const otherRows = clients.filter(row => row.id !== Number(id));
      if (otherRows.some(row => text(row.client_id || row.code) === merged.client_id)) return res.status(409).json({ error: 'Client Id Already Exist.' });
      if (duplicateName(clients, merged.client_name, Number(id))) return res.status(409).json({ error: 'Client Name Already Exist.' });
      const status = clientStatus(merged.status);
      const actor = currentUser(req)?.username || 'unknown';
      const [saved] = await update('partners', Number(id), {
        ...clean(merged), status, is_active: status === 'Active',
        created_date: current.created_date, created_by: current.created_by,
        modified_date: new Date().toISOString(), modified_by: actor,
      });
      return res.status(200).json(normalize(saved));
    }

    if (req.method === 'DELETE') return res.status(409).json({ error: 'Clients cannot be deleted. Set Status to Inactive instead.' });
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('clients error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
