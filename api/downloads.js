import { sendDatabaseUnavailable, find, findOne, insert, updateOwnedDownload, remove, cors, actor } from './mongo.js';

// Download history store.
// GET    /api/downloads            -> metadata list (newest first)
// GET    /api/downloads?id=<id>    -> one full download record
// POST   /api/downloads            -> record a download { filename, format, module, row_count, size, content }
// DELETE /api/downloads  { id }    -> remove one owned record
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const TEXT_FORMATS = {
  CSV: { extension: 'csv', mime: 'text/csv' },
  JSON: { extension: 'json', mime: 'application/json' },
  TXT: { extension: 'txt', mime: 'text/plain' },
  HTML: { extension: 'html', mime: 'text/html' },
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (!req.user?.username) return res.status(401).json({ error: 'Sign in to continue.' });
    const owner = actor(req);
    if (req.method === 'GET') {
      if (req.query?.id !== undefined) {
        const id = Number(req.query.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Download id must be a positive integer.' });
        const row = await findOne('downloads', { id, exported_by: owner });
        if (!row) return res.status(404).json({ error: 'Download not found.' });
        return res.status(200).json(row);
      }
      const rows = await find('downloads', { exported_by: owner }, { sort: { id: -1 }, projection: { content: 0 } });
      return res.status(200).json(rows);
    }
    if (req.method === 'POST') {
      if (['generate-xlsx', 'generate-pdf'].includes(req.body?.action)) {
        const pdf = req.body.action === 'generate-pdf';
        const { title, data, baseName } = req.body;
        if (typeof title !== 'string' || title.length > 250 || !Array.isArray(data?.columns)
          || !data.columns.length || data.columns.length > 100 || !Array.isArray(data.rows) || data.rows.length > 10000
          || data.columns.some(value => typeof value !== 'string' || value.length > 32767)
          || data.rows.some(row => !Array.isArray(row) || row.length !== data.columns.length
            || row.some(value => value !== null && (typeof value !== 'string' && typeof value !== 'number'
              || typeof value === 'number' && !Number.isFinite(value)
              || typeof value === 'string' && value.length > 32767)))) {
          return res.status(400).json({ error: 'Report export requires up to 100 columns and 10,000 rows of text or numeric cells.' });
        }
        let bytes;
        if (pdf) {
          const { reportPdf } = await import('./report-pdf.js');
          bytes = await reportPdf(title, data);
        } else {
          const { default: ExcelJS } = await import('exceljs');
          const workbook = new ExcelJS.Workbook();
          workbook.creator = actor(req);
          workbook.title = title;
          const sheet = workbook.addWorksheet('Report', { views: [{ state: 'frozen', ySplit: 1 }] });
          sheet.addRow(data.columns);
          sheet.addRows(data.rows);
          sheet.getRow(1).font = { bold: true };
          sheet.columns.forEach(column => { column.width = 24; column.alignment = { wrapText: true, vertical: 'top' }; });
          sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: data.columns.length } };
          bytes = Buffer.from(await workbook.xlsx.writeBuffer());
        }
        if (bytes.length > MAX_DOWNLOAD_BYTES) {
          return res.status(413).json({ error: 'Export exceeds the 10 MB download-history limit. Reduce the report size and try again.' });
        }
        const name = String(baseName || 'export').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100) || 'export';
        const doc = await insert('downloads', {
          filename: `${name}-${new Date().toISOString().slice(0, 10)}.${pdf ? 'pdf' : 'xlsx'}`, format: pdf ? 'PDF' : 'EXCEL', module: title,
          row_count: data.rows.length, size: bytes.length, content: bytes.toString('base64'), content_encoding: 'base64',
          mime: pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          exported_by: owner, status: 'Completed', created_at: new Date().toISOString(),
        });
        return res.status(201).json(doc);
      }
      const { filename, format, module, row_count, size, content, mime } = req.body || {};
      const formatSpec = TEXT_FORMATS[format];
      if (!formatSpec || typeof filename !== 'string' || filename.length > 150
        || !/^[A-Za-z0-9_-]+(?:-[0-9]{4}-[0-9]{2}-[0-9]{2})?\.[A-Za-z0-9]+$/.test(filename)
        || !filename.toLowerCase().endsWith(`.${formatSpec.extension}`)
        || mime !== formatSpec.mime || typeof module !== 'string' || !module.trim() || module.length > 250
        || !Number.isSafeInteger(row_count) || row_count < 0 || row_count > 10000
        || typeof content !== 'string' || !content.length || !Number.isSafeInteger(size) || size < 0) {
        return res.status(400).json({ error: 'Invalid client export metadata or content.' });
      }
      const contentBytes = Buffer.byteLength(content, 'utf8');
      if (contentBytes > MAX_DOWNLOAD_BYTES) {
        return res.status(413).json({ error: 'Export exceeds the 10 MB download-history limit. Reduce the report size and try again.' });
      }
      if (size !== contentBytes) return res.status(400).json({ error: 'Export size does not match stored content.' });
      const doc = await insert('downloads', {
        filename, format, module, row_count,
        size: contentBytes, content, mime,
        exported_by: owner, status: 'Stored', source: 'client-submitted',
        created_at: new Date().toISOString(),
      });
      const { content: _storedContent, ...metadata } = doc;
      return res.status(201).json(metadata);
    }
    if (req.method === 'PUT') {
      const { id, ...fields } = req.body || {};
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Download id must be a positive integer.' });
      const strings = new Set(['filename', 'format', 'module', 'content', 'mime']);
      const numbers = new Set(['row_count', 'size']);
      if (!Object.keys(fields).length || Object.entries(fields).some(([key, value]) =>
        strings.has(key) ? typeof value !== 'string' || (key !== 'content' && value.length > 250)
          : numbers.has(key) ? !Number.isSafeInteger(value) || value < 0 : true)) {
        return res.status(400).json({ error: 'Download update contains invalid or protected fields.' });
      }
      if (typeof fields.content === 'string' && Buffer.byteLength(fields.content, 'utf8') > MAX_DOWNLOAD_BYTES) return res.status(413).json({ error: 'Export exceeds the 10 MB download-history limit.' });
      const row = await updateOwnedDownload(id, owner, fields);
      if (!row) return res.status(404).json({ error: 'Download not found.' });
      return res.status(200).json(row);
    }
    if (req.method === 'DELETE') {
      const { id, all } = req.body || {};
      if (all) return res.status(403).json({ error: 'Bulk history deletion is unavailable until an atomic owner-scoped delete is implemented.' });
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Download id must be a positive integer.' });
      const removed = await remove('downloads', id, { exported_by: owner });
      if (removed.deletedCount !== 1) return res.status(404).json({ error: 'Download not found.' });
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return;
    console.error('downloads error:', { name: err?.name, code: err?.code });
    res.status(500).json({ error: 'Download operation failed.' });
  }
}
