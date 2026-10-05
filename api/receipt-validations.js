import { sendDatabaseUnavailable, cors, find, insert, update, updateWhere } from './mongo.js';
import { currentUser } from './auth-session.js';

const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(value).toLowerCase().includes(text(query).toLowerCase());
const boolKeys = [
  'receiveMoreThanPO', 'isDefault', 'allowOtherThanPOSKUs', 'lineLevelInvoiceQty', 'headerLevelInvoiceQty', 'matchMRP',
  'invoiceDateMandatory', 'invoiceAmountMandatory', 'invoiceTaxMandatory', 'materialRcvdDate', 'allowExcessQty', 'generateAdvUSN',
  'allowVirtualBom', 'attachmentMandatory', 'invoiceAmountValidation', 'challanNoMandatory', 'mrpValidation', 'reasonMandatory',
  'marginValidation', 'withOutMarginValidation', 'restrictShortReceiving',
];
const integer = (value) => /^\+?\d+$/.test(text(value));
const decimal = (value) => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text(value)) && Number.isFinite(Number(value));

const normalize = (row) => {
  const output = {
    ...row,
    receivingValidationCode: row.receiving_validation_code || row.code || '',
    description: row.description || row.name || '',
    percentage: row.percentage ?? '',
    varianceAllowed: row.variance_allowed ?? '',
    mrpVarianceAllowed: row.mrp_variance_allowed ?? '',
    marginVarianceAllowed: row.margin_variance_allowed ?? '',
    withOutMarginVarianceAllowed: row.without_margin_variance_allowed ?? '',
    shortReceivingTolerance: row.short_receiving_tolerance ?? '',
  };
  for (const key of boolKeys) output[key] = !!row[key];
  return output;
};

function validate(body) {
  if (!text(body.receivingValidationCode)) return 'Please Enter Receipt Validation Code';
  if (!text(body.description)) return 'Please Enter Description';
  if (!/^[a-zA-Z0-9]+$/.test(text(body.receivingValidationCode))) return 'Please Enter Only AlphaNumerics';
  for (const key of boolKeys) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') return `${key} must be true or false.`;
  }
  if (text(body.percentage) && !decimal(body.percentage)) return 'Please Enter Valid Percentage';
  if (body.invoiceAmountValidation && !integer(body.varianceAllowed)) return 'Variance Allowed is mandatory';
  if (body.mrpValidation && !text(body.mrpVarianceAllowed)) return 'Variance Allowed for MRP is mandatory';
  if (body.mrpValidation && !integer(body.mrpVarianceAllowed)) return 'Only Numeric Value is allowed in Variance Allowed for MRP';
  if (body.marginValidation && !text(body.marginVarianceAllowed)) return 'Margin Variance Allowed for Margin is mandatory';
  if (body.marginValidation && !decimal(body.marginVarianceAllowed)) return 'Margin Variance Allowed for Margin must be numeric.';
  if (body.withOutMarginValidation && !text(body.withOutMarginVarianceAllowed)) return 'Without Margin Variance Allowed for Without Margin is mandatory';
  if (body.withOutMarginValidation && !decimal(body.withOutMarginVarianceAllowed)) return 'Without Margin Variance Allowed for Without Margin must be numeric.';
  if (body.restrictShortReceiving && !text(body.shortReceivingTolerance)) return 'Less Receiving Tolerance is Mandatory.';
  if (body.restrictShortReceiving && !decimal(body.shortReceivingTolerance)) return 'Less Receiving Tolerance must be numeric.';
  if (body.restrictShortReceiving && (Number(body.shortReceivingTolerance) < 0 || Number(body.shortReceivingTolerance) > 100)) return 'Less Receiving Tolerance Percentage must be between 0 and 100.';
  return '';
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const body = req.body || {};
    if (req.method === 'POST' && (body.REQ_SEARCH_FLAG || body.action === 'search')) {
      let rows = (await find('generic_records', { module: 'receipt-validation' })).map(normalize)
        .filter((row) => has(row.receivingValidationCode, body.receivingValidationCode) && has(row.description, body.description));
      for (const key of boolKeys) if (body[key] === true || body[key] === 'true') rows = rows.filter((row) => row[key]);
      rows.sort((a, b) => text(a.receivingValidationCode).localeCompare(text(b.receivingValidationCode)) * (text(body.sord) === 'asc' ? 1 : -1));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = rows.length;
      const receiptValidationDTOs = rows.slice((page - 1) * size, page * size);
      return res.json({
        gridModel: receiptValidationDTOs, receiptValidationDTOs, rows: size, page, records, record: records,
        total: records, sidx: text(body.sidx) || 'id.inboundCode', sord: text(body.sord) || 'desc',
      });
    }
    if ((req.method === 'POST' && body.action === 'save') || req.method === 'PUT') {
      const error = validate(body);
      if (error) return res.status(400).json({ error });
      const code = text(body.receivingValidationCode).toUpperCase();
      const all = await find('generic_records', { module: 'receipt-validation' });
      const byCode = all.find((row) => text(row.receiving_validation_code || row.code).toUpperCase() === code);
      if (req.method === 'PUT' && !body.id) return res.status(400).json({ error: 'Receipt Validation id is required.' });
      const existing = req.method === 'PUT' ? all.find((row) => row.id === Number(body.id)) : byCode;
      if (req.method === 'POST' && byCode) return res.status(409).json({ error: 'Receipt Validation Code already exists.' });
      if (req.method === 'PUT' && !existing) return res.status(404).json({ error: 'Receipt Validation was not found.' });
      if (req.method === 'PUT' && byCode && existing.id !== byCode.id) return res.status(409).json({ error: 'Receipt Validation Code already exists.' });
      if (body.isDefault) await updateWhere('generic_records', { module: 'receipt-validation' }, { isDefault: false });
      const actor = currentUser(req)?.username || 'unknown';
      const fields = {
        module: 'receipt-validation', code, receiving_validation_code: code, name: text(body.description), description: text(body.description),
        percentage: text(body.percentage || '0'), variance_allowed: text(body.varianceAllowed),
        mrp_variance_allowed: text(body.mrpVarianceAllowed), margin_variance_allowed: text(body.marginVarianceAllowed),
        without_margin_variance_allowed: text(body.withOutMarginVarianceAllowed), short_receiving_tolerance: text(body.shortReceivingTolerance),
        modified_by: actor, modified_date: new Date().toISOString(),
      };
      for (const key of boolKeys) fields[key] = body[key] === true;
      if (existing) {
        const changed = await update('generic_records', existing.id, fields);
        return res.json({ row: normalize(changed[0]), jsonMessage: 'Data saved successfully.' });
      }
      const row = await insert('generic_records', { ...fields, created_by: actor, created_date: new Date().toISOString() });
      return res.status(201).json({ row: normalize(row), jsonMessage: 'Data saved successfully.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Receipt Validation error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
