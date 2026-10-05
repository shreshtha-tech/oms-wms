import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';
import { activeLocations } from './catalogs.js';
import { currentUser } from './auth-session.js';

const entityMap = {
  buyers: 'procurement_buyers',
  invoices: 'vendor_invoices',
  otb: 'otb_budgets',
};

const clean = (value) => String(value ?? '').trim();
const today = () => new Date().toISOString().slice(0, 10);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const entity = clean(req.query.entity || req.body?.entity);
    const collection = entityMap[entity];
    if (!collection) return res.status(400).json({ error: 'Unknown procurement entity.' });

    if (req.method === 'GET') {
      return res.status(200).json(await find(collection, {}, { sort: { id: -1 } }));
    }

    if (req.method === 'POST') {
      if (entity === 'buyers') {
        const { buyer_name, description, email, phone, alternate_phone, active, categories, udf } = req.body;
        if (!clean(buyer_name)) return res.status(400).json({ error: 'Buyer Name is required.' });
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid Email.' });
        const rows = await find(collection);
        if (rows.some((row) => clean(row.buyer_name).toLowerCase() === clean(buyer_name).toLowerCase())) return res.status(409).json({ error: 'Buyer Name already exists.' });
        const buyer_code = String(Math.max(0, ...rows.map((r) => Number(r.buyer_code) || 0)) + 1);
        return res.status(201).json(await insert(collection, {
          buyer_code, buyer_name: clean(buyer_name), description: clean(description), email: clean(email), phone: clean(phone),
          alternate_phone: clean(alternate_phone), active: active !== false, categories: Array.isArray(categories) ? categories : [],
          udf: Array.isArray(udf) ? udf.slice(0, 5) : ['', '', '', '', ''], location: '', created_by: currentUser(req)?.username || 'unknown', created_date: today(),
        }));
      }
      if (entity === 'invoices') {
        const { vendor_code, vendor_name, vendor_invoice_no, invoice_date, posting_date, invoice_amount, currency, grn_codes } = req.body;
        if (!clean(vendor_code) || !clean(vendor_invoice_no) || !invoice_date || !posting_date || !(Number(invoice_amount) >= 0)) {
          return res.status(400).json({ error: 'Vendor, Vendor Invoice No., Invoice Date, Posting Date and Invoice Amount are required.' });
        }
        return res.status(201).json(await insert(collection, {
          document_invoice_no: `VIN${Date.now().toString().slice(-8)}`, vendor_code, vendor_name, vendor_invoice_no, invoice_date,
          posting_date, invoice_amount: Number(invoice_amount), currency: currency || 'INR', grn_codes: grn_codes || [], status: 'Pending', created_date: today(),
        }));
      }
      if (entity === 'otb') {
        const { description, location, vendor_code, start_date, end_date, operand_type, operand, total_budget } = req.body;
        if (!clean(description) || !clean(location) || !start_date || !end_date || !clean(operand_type) || !clean(operand) || !(Number(total_budget) > 0)) {
          return res.status(400).json({ error: 'Description, Location, dates, Operand Type, Operand and Total Budget are required.' });
        }
        if (!(await activeLocations()).some((item) => item.name === clean(location))) return res.status(400).json({ error: 'Select a configured active location.' });
        if (end_date < start_date) return res.status(400).json({ error: 'End Date cannot be before Start Date.' });
        const rows = await find(collection);
        return res.status(201).json(await insert(collection, {
          otb_id: String(Math.max(0, ...rows.map((r) => Number(r.otb_id) || 0)) + 1), description: clean(description), location: clean(location),
          vendor_code: clean(vendor_code), start_date, end_date, status: 'Pending', operand_type, operand, total_budget: Number(total_budget),
          consumed: 0, open_to_buy: Number(total_budget), updated_by: currentUser(req)?.username || 'unknown', updated_date: today(),
        }));
      }
    }

    if (req.method === 'PUT') {
      const id = Number(req.body.id);
      const row = await findOne(collection, { id });
      if (!row) return res.status(404).json({ error: 'Record not found.' });
      const { entity: _entity, id: _id, ...fields } = req.body;
      if (fields.action === 'confirm') {
        if (!['Pending', 'Pending Confirmation'].includes(row.status)) return res.status(409).json({ error: 'Only a pending record can be confirmed.' });
        fields.status = 'Confirmed'; delete fields.action;
      }
      if (fields.action === 'release') {
        if (row.status !== 'Confirmed') return res.status(409).json({ error: 'Only a confirmed record can be released.' });
        fields.status = 'Released'; delete fields.action;
      }
      const changed = await update(collection, id, fields);
      return res.status(200).json(changed[0]);
    }
    res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Procurement API error:', { name: error?.name, code: error?.code });
    res.status(500).json({ error: error.message || 'Procurement request failed.' });
  }
}
