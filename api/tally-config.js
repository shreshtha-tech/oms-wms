import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';

const CONFIG_MODULE = 'tally-config';
const ALIAS_MODULE = 'tally-alias';
const AUDIT_MODULE = 'tally-audit';

const defaults = {
  sales_voucher_type: '', sales_voucher_number: 'Invoice Number', sales_reference_number: 'Extern orderno', sales_date: 'Invoice Date',
  sales_return_voucher_type: '', sales_return_voucher_number: 'Return Number', sales_return_reference_number: 'Extern orderno', sales_return_date: 'Return Date',
  sales_ledger_type: 'Local/Interstate', sales_with_tax_percent: true, sales_ledger_name: '', sales_local_ledger: '', sales_interstate_ledger: '',
  sales_tax_with_percent: false, sales_sgst_ledger: '', sales_cgst_ledger: '', sales_igst_ledger: '', sales_party_type: 'Marketplace',
  purchase_voucher_type: '', purchase_voucher_number: 'Inbound Number', purchase_reference_number: 'PO Code', purchase_date: 'Inbound Date',
  purchase_return_voucher_type: '', purchase_return_voucher_number: 'Return Number', purchase_return_date: 'Return Date',
  purchase_ledger_type: 'Item wise', purchase_with_tax_percent: false, purchase_ledger_name: '', purchase_local_ledger: '', purchase_interstate_ledger: '',
  purchase_tax_with_percent: false, purchase_sgst_ledger: '', purchase_cgst_ledger: '', purchase_igst_ledger: '', purchase_party_type: 'Vendor',
};

const required = [
  'sales_voucher_number', 'sales_reference_number', 'sales_date', 'sales_return_voucher_number', 'sales_return_reference_number', 'sales_return_date',
  'sales_ledger_type', 'sales_sgst_ledger', 'sales_cgst_ledger', 'sales_igst_ledger',
  'purchase_voucher_number', 'purchase_reference_number', 'purchase_date', 'purchase_return_voucher_number', 'purchase_return_date',
  'purchase_ledger_type', 'purchase_sgst_ledger', 'purchase_cgst_ledger', 'purchase_igst_ledger',
];

function validate(config) {
  const missing = required.filter((key) => !String(config[key] ?? '').trim());
  if (config.sales_ledger_type === 'Item wise' && !String(config.sales_ledger_name || '').trim()) missing.push('sales_ledger_name');
  if (config.sales_ledger_type === 'Local/Interstate') {
    if (!String(config.sales_local_ledger || '').trim()) missing.push('sales_local_ledger');
    if (!String(config.sales_interstate_ledger || '').trim()) missing.push('sales_interstate_ledger');
  }
  if (config.purchase_ledger_type === 'Item wise' && !String(config.purchase_ledger_name || '').trim()) missing.push('purchase_ledger_name');
  if (config.purchase_ledger_type === 'Local/Interstate') {
    if (!String(config.purchase_local_ledger || '').trim()) missing.push('purchase_local_ledger');
    if (!String(config.purchase_interstate_ledger || '').trim()) missing.push('purchase_interstate_ledger');
  }
  return [...new Set(missing)];
}

const codeOf = (row, fallback = '') => String(row.channel_code || row.vendor_code || row.transporter_code || row.customer_code || row.code || fallback);
const nameOf = (row) => String(row.channel_name || row.vendor_name || row.transporter_name || row.customer_name || row.name || '');

async function sourceRows() {
  const [channels, vendors, partners] = await Promise.all([find('channels', {}, { sort: { id: 1 } }), find('vendors', {}, { sort: { id: 1 } }), find('partners', {}, { sort: { id: 1 } })]);
  const normalize = (rows, type) => rows.map((row, index) => ({ id: row.id, party_type: type, source_code: codeOf(row, String(index + 1)), source_name: nameOf(row) }));
  const marketplace = normalize(channels, 'Marketplace');
  const transporter = normalize(partners.filter((row) => row.type === 'Transporter'), 'Transporter');
  const customer = normalize(partners.filter((row) => row.type === 'Customer'), 'B2B Customer');
  const vendorMap = new Map();
  for (const row of [...vendors, ...partners.filter((item) => item.type === 'Vendor')]) vendorMap.set(codeOf(row), row);
  const vendor = normalize([...vendorMap.values()], 'Vendor');
  return { Marketplace: marketplace, Transporter: transporter, 'B2B Customer': customer, Vendor: vendor };
}

async function snapshot() {
  const configRow = await findOne('generic_records', { module: CONFIG_MODULE, code: 'GLOBAL' });
  const aliases = await find('generic_records', { module: ALIAS_MODULE }, { sort: { id: 1 } });
  const audit = await find('generic_records', { module: AUDIT_MODULE }, { sort: { id: -1 } });
  const companies = (await find('generic_records', { module: 'org-hierarchy' }, { sort: { id: 1 } })).filter((row) => row.hierarchy_type === 'Company' || row.type === 'Company');
  return { config: { ...defaults, ...(configRow || {}) }, aliases, sources: await sourceRows(), companies, audit };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') return res.status(200).json(await snapshot());
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
    const action = req.body?.action || 'config';
    if (action === 'config') {
      const config = { ...defaults, ...(req.body.config || {}) };
      const missing = validate(config);
      if (missing.length) return res.status(400).json({ error: 'Please enter all mandatory fields.', fields: missing });
      const existing = await findOne('generic_records', { module: CONFIG_MODULE, code: 'GLOBAL' });
      const fields = { ...config, module: CONFIG_MODULE, code: 'GLOBAL', name: 'Configuration Setting', status: 'Active', updated_date: new Date().toISOString() };
      if (existing) await update('generic_records', existing.id, fields); else await insert('generic_records', { ...fields, created_date: new Date().toISOString().slice(0, 10) });
      await insert('generic_records', { module: AUDIT_MODULE, code: `CFG-${Date.now()}`, name: 'Tally configuration updated', action: 'UPDATE', changed_by: 'Store Admin', changed_at: new Date().toISOString(), status: 'Completed' });
      return res.status(200).json(await snapshot());
    }
    if (action === 'aliases') {
      const partyType = String(req.body.party_type || '');
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      if (!['Marketplace', 'Transporter', 'B2B Customer', 'Vendor'].includes(partyType)) return res.status(400).json({ error: 'Invalid Party Name.' });
      for (const row of rows) {
        const sourceCode = String(row.source_code || '').trim();
        if (!sourceCode) continue;
        const existing = (await find('generic_records', { module: ALIAS_MODULE })).find((item) => item.party_type === partyType && item.source_code === sourceCode);
        const fields = { module: ALIAS_MODULE, code: `${partyType}:${sourceCode}`, name: row.source_name || sourceCode, party_type: partyType, source_code: sourceCode, source_name: row.source_name || '', tally_name: row.tally_name || '', voucher_type: row.voucher_type || '', return_voucher_type: row.return_voucher_type || '', local_ledger: row.local_ledger || '', interstate_ledger: row.interstate_ledger || '', status: 'Active', updated_date: new Date().toISOString() };
        if (existing) await update('generic_records', existing.id, fields); else await insert('generic_records', { ...fields, created_date: new Date().toISOString().slice(0, 10) });
      }
      await insert('generic_records', { module: AUDIT_MODULE, code: `ALS-${Date.now()}`, name: `${partyType} alias names updated`, action: 'UPDATE', changed_by: 'Store Admin', changed_at: new Date().toISOString(), status: 'Completed' });
      return res.status(200).json(await snapshot());
    }
    return res.status(400).json({ error: 'Invalid Tally configuration action.' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return;
    console.error('tally-config error:', { name: err?.name, code: err?.code });
    return res.status(500).json({ error: err.message });
  }
}
