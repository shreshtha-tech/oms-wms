import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

// Generic report export: a numbered record layout keeps wide reports legible
// and lets long fields continue across pages without dropping any columns.
export async function reportPdf(title, data) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 42, left: 42, right: 42 }, bufferPages: true, info: { Title: title } });
  const chunks = [];
  const output = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.font(fileURLToPath(new URL('../assets/report-fonts/NotoSans.ttf', import.meta.url)));
  doc.fontSize(17).fillColor('#16324f').text(title);
  doc.moveDown(0.5).fontSize(9).fillColor('#475569').text(`${data.rows.length} records`);
  for (const [index, row] of data.rows.entries()) {
    if (doc.y > doc.page.height - 110) doc.addPage();
    doc.moveDown().fontSize(11).fillColor('#16324f').text(`Record ${index + 1}`);
    for (const [column, value] of row.entries()) {
      doc.fontSize(9).fillColor('#1e293b').text(`${data.columns[column]}: ${value ?? ''}`, { paragraphGap: 5 });
    }
  }
  if (!data.rows.length) doc.moveDown().text('No records.');
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(index);
    doc.fontSize(9).fillColor('#475569').text('D-Mills | Report export', 42, 24, { lineBreak: false });
    doc.fontSize(8).fillColor('#64748b').text(`Page ${index + 1} of ${range.count}`, 42, doc.page.height - 28, { lineBreak: false });
  }
  doc.end();
  return output;
}
