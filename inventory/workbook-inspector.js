import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REPORTED = 100;
const HEADER_WORDS = /\b(sku|product|quantity|qty|stock|location|warehouse|facility|store|pack|uom|unit|status|active|date|supplier|channel|id)\b/i;
const HEADER_KINDS = [
  ['sku',/^(?:(?:seller|master|supplier|product|item)\s+)?sku(?:\s+(?:id|code|number))?$/i],
  ['quantity',/^(?:(?:available|physical|opening|total|current|closing|on\s+hand|listed|inventory)\s+)?(?:stock|quantity|qty|on\s+hand)(?:\s+(?:count|units|quantity))?$/i],
  ['location',/^(?:(?:default|stock|source|seller)\s+)?(?:location|warehouse|facility|store)(?:\s+(?:id|code|name))?$/i],
  ['uom',/^(?:uom|unit(?:s)?(?:\s+of\s+measure)?)$/i],
  ['product',/^(?:product|item)(?:\s+(?:name|title|description))?$/i],
  ['pack',/^(?:pack(?:\s+(?:of|size|quantity|qty))?)$/i],
  ['status',/^(?:status|active|listing\s+status)$/i],
  ['date',/^(?:(?:count|stock|inventory|report|export)\s+)?date$/i],
];
const PRIVATE_VALUE = /(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?\d[\d\s().-]{9,}\d)|https?:\/\/|(?:secret|password|token|credential|private.?key))/i;

function safeLabel(value) {
  const raw = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!raw || raw.length > 80 || PRIVATE_VALUE.test(raw)) return raw ? '[redacted]' : '';
  return raw;
}

function safeFileName(value) {
  const raw = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return raw.length <= 240 && !PRIVATE_VALUE.test(raw) ? raw : '[redacted]';
}

function cellKind(cell) {
  if (cell.type === ExcelJS.ValueType.Formula) return 'formula';
  if (cell.type === ExcelJS.ValueType.Date) return 'date';
  if (cell.type === ExcelJS.ValueType.Number) return 'number';
  if (cell.type === ExcelJS.ValueType.Boolean) return 'boolean';
  if (cell.type === ExcelJS.ValueType.Error) return 'error';
  if (cell.type === ExcelJS.ValueType.Null || cell.value == null) return 'blank';
  if (cell.type === ExcelJS.ValueType.Hyperlink) return 'hyperlink';
  return 'text';
}

function signature(cell) {
  const kind = cellKind(cell);
  if (kind === 'formula') return `formula:${cell.value?.formula ?? cell.value?.sharedFormula ?? ''}`;
  if (kind === 'date') return `date:${cell.value?.toISOString?.() ?? String(cell.value)}`;
  if (kind === 'hyperlink') return `hyperlink:${cell.value?.text ?? ''}:${cell.value?.hyperlink ?? ''}`;
  return `${kind}:${String(cell.value ?? '')}`;
}

export async function inspectInventoryWorkbook(bytes, fileName = '') {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new Error('Expected a nonempty .xlsx file no larger than 20 MB');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheets = workbook.worksheets.map(sheet => {
    const first = sheet.getRow(1);
    const headerLabels = [];
    const headerCounts = new Map();
    for (let column = 1; column <= sheet.columnCount; column++) {
      const cell = first.getCell(column);
      const label = cellKind(cell) === 'text' ? safeLabel(cell.text) : cell.value == null ? '' : `[${cellKind(cell)}]`;
      headerLabels.push({ column, label });
      if (label && label !== '[redacted]') headerCounts.set(label.toLowerCase(), (headerCounts.get(label.toLowerCase()) ?? 0) + 1);
    }
    const candidateColumns = headerLabels.filter(item => HEADER_WORDS.test(item.label));
    const candidateHeaderRows = [];
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber++) {
      const candidates = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const cell = sheet.getRow(rowNumber).getCell(column);
        if (cellKind(cell) !== 'text') continue;
        const label = safeLabel(cell.text);
        const kind = HEADER_KINDS.find(([, pattern]) => pattern.test(label))?.[0];
        if (kind) candidates.push({ column, label, kind });
      }
      if (new Set(candidates.map(item => item.kind)).size >= 2) candidateHeaderRows.push({ row: rowNumber, columns: candidates });
    }
    const formulas = [], duplicateRows = [], rowSignatures = new Map();
    const typesByColumn = new Map();
    let populatedRows = 0, blankRows = 0, formulaCount = 0, duplicateRowCount = 0;
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      if (!row.hasValues) { blankRows++; continue; }
      populatedRows++;
      const parts = [];
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        const kind = cellKind(cell);
        if (kind === 'blank') return;
        parts.push(`${column}:${signature(cell)}`);
        if (kind === 'formula') { formulaCount++; if (formulas.length < MAX_REPORTED) formulas.push(cell.address); }
        const types = typesByColumn.get(column) ?? {};
        types[kind] = (types[kind] ?? 0) + 1;
        typesByColumn.set(column, types);
      });
      if (rowNumber === 1 || !parts.length) continue;
      const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex');
      const previous = rowSignatures.get(digest);
      if (previous !== undefined) { duplicateRowCount++; if (duplicateRows.length < MAX_REPORTED) duplicateRows.push({ row: rowNumber, matchesRow: previous }); }
      else rowSignatures.set(digest, rowNumber);
    }
    const mergedRanges = sheet.model.merges ?? [];
    return {
      name: safeLabel(sheet.name), state: sheet.state ?? 'visible', rowCount: sheet.rowCount,
      populatedRows, blankRows, columnCount: sheet.columnCount,
      firstRowLabels: headerLabels, candidateColumns, candidateHeaderRows,
      duplicateHeaders: [...headerCounts].filter(([, count]) => count > 1).map(([label, count]) => ({ label, count })),
      formulaCount, formulaCells: formulas, mergedCellRanges: mergedRanges,
      duplicateRowCount, duplicateRows, typesByColumn: [...typesByColumn].sort(([a], [b]) => a - b).map(([column, types]) => ({ column, types })),
      hiddenColumns: sheet.columns.flatMap((column, index) => column.hidden ? [index + 1] : []),
    };
  });
  return {
    fileName: safeFileName(fileName), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), sheets,
    note: 'Read-only structural inspection. First-row labels are sanitized; no data-row values are included. Candidate columns are not approved mappings.',
  };
}
