import { sendDatabaseUnavailable, find, insert, update, remove, cors, actor } from './mongo.js';

// Download history store.
// GET    /api/downloads            -> metadata list (newest first)
// GET    /api/downloads?id=<id>    -> one full download record
// POST   /api/downloads            -> record a download { filename, format, module, row_count, size, content }
// DELETE /api/downloads  { id }    -> remove one   (or { all:true } to clear)
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      if (req.query?.id !== undefined) {
        const id = Number(req.query.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Download id must be a positive integer.' });
        const row = (await find('downloads', { id }))[0];
        if (!row) return res.status(404).json({ error: 'Download not found.' });
        return res.status(200).json(row);
      }
      const rows = await find('downloads', {}, { sort: { id: -1 }, projection: { content: 0 } });
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
          exported_by: actor(req), status: 'Completed', created_at: new Date().toISOString(),
        });
        return res.status(201).json(doc);
      }
      const { filename, format, module, row_count, size, content, mime, exported_by, status } = req.body;
      if (Buffer.byteLength(String(content || ''), 'utf8') > MAX_DOWNLOAD_BYTES) {
        return res.status(413).json({ error: 'Export exceeds the 10 MB download-history limit. Reduce the report size and try again.' });
      }
      const doc = await insert('downloads', {
        filename, format, module: module || '—', row_count: row_count || 0,
        size: size || 0, content: content || '', mime: mime || 'text/plain',
        exported_by: exported_by || 'system', status: status || 'Completed',
        created_at: new Date().toISOString(),
      });
      return res.status(201).json(doc);
    }
    if (req.method === 'PUT') {
      const { id, ...fields } = req.body;
      const rows = await update('downloads', id, fields);
      return res.status(200).json(rows[0]);
    }
    if (req.method === 'DELETE') {
      const { id, all } = req.body;
      if (all) {
        const rows = await find('downloads', {});
        for (const r of rows) await remove('downloads', r.id);
        return res.status(200).json({ ok: true, cleared: rows.length });
      }
      await remove('downloads', id);
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (sendDatabaseUnavailable(res, err)) return;
    console.error('downloads error:', { name: err?.name, code: err?.code });
    res.status(500).json({ error: err.message });
  }
}
