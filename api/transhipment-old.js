import { sendDatabaseUnavailable, actor, cors, find, insert } from './mongo.js';

const trim = value => String(value ?? '').trim();
const page = (items, body) => {
  const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
  const current = Math.max(1, Number(body.page) || 1);
  const records = items.length;
  return { gridModel: items.slice((current - 1) * size, current * size), page: current, total: Math.ceil(records / size), records };
};

const columns = {
  pending: ['', 'Audit', 'Doc Date', 'Order No', 'Sender Name', 'Receiver Name', 'Item Name', 'Item Description', 'Batch Id', 'Expected Receive Date'],
  received: ['', 'Audit', 'Doc Date', 'Order No', 'QC Status', 'QC Failed Qty', 'QC Reason', 'Sender Name', 'Receiver Name', 'Item Name', 'Item Description', 'Receive Details', 'Batch Id', 'Expected Ship Date'],
  qcPass: ['Audit', 'Pack', 'Doc Date', 'Order No', 'Sender Name', 'Receiver Name', 'QC Date', 'QC By', 'Batch Id', 'Expected Ship Date'],
  qcFail: ['', 'Audit', 'Doc Date', 'Order No', 'QC Status', 'Sender Name', 'Receiver Name', 'QC Date', 'QC By', 'Batch Id', 'Expected Ship Date'],
  packed: ['', 'Audit', 'Doc Date', 'Order No', 'Sender Name', 'Receiver Name', 'Tracking No', 'Transporter Name', 'Pack Date', 'Pack By', 'Expected Ship Date', 'Batch Id', 'Label'],
  dispatched: ['', 'Audit', 'Doc Date', 'Order No', 'Status', 'Sender Name', 'Receiver Name', 'Item Name', 'Item Description', 'QC Date', 'QC By', 'Transporter Name', 'Tracking No', 'Batch Id', 'Del Date', 'Actual Received Date', 'Actual Shiped Date', 'Label', 'Manifest'],
  all: ['Audit', 'Doc Date', 'Order No', 'Status', 'Sender Name', 'Receiver Name', 'Item Name', 'Item Description', 'Batch Id'],
};

const importFields = ['orderNo', 'docNo', 'docDate', 'senderName', 'receiverName', 'itemName', 'itemDescription', 'batchNo', 'expectedReceiveDate'];
const importFieldByHeader = new Map(importFields.map(field => [field.toLowerCase(), field]));

function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') {
      if (value) throw new Error('CSV quotes must begin at the start of a field.');
      quoted = true;
    } else if (char === ',') {
      row.push(value); value = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(value); value = '';
      if (row.some(cell => trim(cell))) rows.push(row);
      row = [];
    } else value += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(value);
  if (row.some(cell => trim(cell))) rows.push(row);
  return rows;
}

function parseImportCsv(content) {
  const rows = parseCsv(content);
  if (rows.length < 2) throw new Error('CSV must contain a header and at least one data row.');
  if (rows.length - 1 > 500) throw new Error('A maximum of 500 rows can be imported at a time.');
  const headers = rows[0].map((value, index) => {
    const header = trim(value).replace(/^\uFEFF/, '');
    const field = importFieldByHeader.get(header.toLowerCase());
    if (!field) throw new Error(`Unsupported CSV column "${header || `Column ${index + 1}`}".`);
    return field;
  });
  if (!headers.includes('orderNo')) throw new Error('CSV must include the orderNo column.');
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate column names.');

  const orders = new Set();
  return rows.slice(1).map((values, index) => {
    const record = Object.fromEntries(headers.map((field, column) => [field, trim(values[column])]));
    if (!record.orderNo) throw new Error(`Row ${index + 2}: Order No is required.`);
    const key = record.orderNo.toLocaleLowerCase();
    if (orders.has(key)) throw new Error(`Row ${index + 2}: duplicate Order No ${record.orderNo}.`);
    orders.add(key);
    return record;
  });
}

async function records() {
  return (await find('generic_records', { module: 'transhipment-old' })).map(row => ({
    ...row,
    orderNo: row.orderNo || row.extern_order_no || row.code || '',
    docNo: row.docNo || row.doc_no || '',
    status: row.status || 'pending',
  }));
}

async function activeClient(clientId) {
  return (await find('partners', { type: 'Client' })).find(client => {
    const id = String(client.client_id || client.code || '').trim();
    const status = String(client.status || 'Active').toLowerCase();
    return id === clientId && client.is_active !== false && status === 'active';
  });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      return res.json({
        tabs: [['pending', 'Pending To Receive'], ['received', 'Received'], ['qcPass', 'QC Passed'], ['qcFail', 'QC Failed'], ['packed', 'Packed'], ['dispatched', 'Dispatch Completed'], ['all', 'All']],
        pageSizes: [20, 50, 100, 200],
        columns,
        importFields,
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    if (body.action === 'ingest') {
      return res.status(501).json({ error: 'Direct Transhipment record creation is unavailable. Import an explicit CSV for logistics metadata; lifecycle actions require Central Inventory integration.' });
    }
    if (['transition', 'pod'].includes(body.action)) {
      return res.status(501).json({ error: 'Transhipment receiving, QC, packing, dispatch, and delivery updates are unavailable until their Central Inventory lifecycle integration is connected.' });
    }
    const all = await records();

    if (body.action === 'import') {
      const clientId = trim(body.clientId);
      if (!clientId) return res.status(400).json({ error: 'Please select Client.' });
      const client = await activeClient(clientId);
      if (!client) return res.status(400).json({ error: 'Select an active configured client.' });
      if (!/\.csv$/i.test(trim(body.fileName))) return res.status(400).json({ error: 'Upload a CSV file.' });
      const content = String(body.fileContent || '');
      if (!content || Buffer.byteLength(content, 'utf8') > 2_000_000) return res.status(400).json({ error: 'CSV is empty or exceeds the 2 MB limit.' });
      let imported;
      try { imported = parseImportCsv(content); }
      catch (error) {
 return res.status(400).json({ error: error.message }); }
      const orderKeys = new Set(all.filter(row => String(row.client_id) === clientId).map(row => String(row.orderNo).toLocaleLowerCase()));
      const duplicate = imported.find(row => orderKeys.has(row.orderNo.toLocaleLowerCase()));
      if (duplicate) return res.status(409).json({ error: `Order No ${duplicate.orderNo} already exists for this client.` });
      const clientName = trim(client.client_name || client.name);
      for (const row of imported) {
        await insert('generic_records', {
          module: 'transhipment-old',
          code: row.orderNo,
          client_id: clientId,
          client_name: clientName,
          ...row,
          status: 'pending',
          created_by: actor(req),
          created_date: new Date().toISOString(),
        });
      }
      return res.status(201).json({ imported: imported.length });
    }

    if (body.action === 'scan') {
      if (!trim(body.orderNo)) return res.status(400).json({ error: 'Empty data can not scan' });
      const row = all.find(item => item.orderNo.toLocaleUpperCase() === trim(body.orderNo).toLocaleUpperCase() && item.status === body.status);
      return row ? res.json({ crossDocData: { crossDocDTOList: [row], errorMesg: null } }) : res.status(404).json({ error: 'No data found.' });
    }

    if (body.action === 'export') {
      const rows = all.filter(row => body.status === 'all' || row.status === body.status);
      if (!rows.length) return res.status(400).json({ error: 'No Record to view' });
      return res.json({ rows });
    }

    const filtered = all.filter(row =>
      (body.status === 'all' || !body.status || row.status === body.status) &&
      (!trim(body.orderNo) || row.orderNo.toLocaleLowerCase().includes(trim(body.orderNo).toLocaleLowerCase())) &&
      (!trim(body.docNo) || row.docNo.toLocaleLowerCase().includes(trim(body.docNo).toLocaleLowerCase())),
    );
    return res.json(page(filtered, body));
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('old transhipment error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
