import { sendDatabaseUnavailable, find, cors } from './mongo.js';

const MODULE = 'sku-import';
const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const sets = await find('generic_records', { module: 'attribute-set' });
      return res.status(200).json({
        attributeSets: sets.filter(row => row.status === 'Active').map(row => row.name || row.description).filter(Boolean),
        importTypes: ['CreateUpdate'],
      });
    }
    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const body = req.body;
      let rows = (await find('generic_records', { module: MODULE })).filter(row =>
        has(row.status, body.status) && has(row.upload_date, body.uploadDate) &&
        has(row.upload_by, body.uploadBy) && has(row.import_type, body.importType) &&
        has(row.name, body.fileName));
      rows.sort((a, b) => Number(b.id) - Number(a.id));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = rows.length;
      const total = Math.ceil(records / size);
      const gridModel = rows.slice((page - 1) * size, page * size);
      return res.status(200).json({ gridModel, rows: gridModel, page, records, total });
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.import_type !== 'CreateUpdate') return res.status(400).json({ error: 'Only CreateUpdate CSV imports are supported on this screen.' });
      const sets = await find('generic_records', { module: 'attribute-set' });
      if (!sets.some(row => row.status === 'Active' && text(row.name || row.description) === text(body.attribute_set)))
        return res.status(400).json({ error: 'Select a configured active Attribute Set.' });
      if (!/\.csv$/i.test(text(body.file_name))) return res.status(400).json({ error: 'A CSV template is required.' });
      // No server-side file ingestion/validation/commit pipeline is connected.
      // A filename and caller-reported counts cannot prove an import occurred.
      return res.status(501).json({ error: 'SKU_IMPORT_PROCESSOR_UNAVAILABLE', message: 'SKU import processing is not connected. No SKU changes or processed import record were created.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('sku imports error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
