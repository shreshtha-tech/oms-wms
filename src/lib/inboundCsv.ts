import { parse } from 'csv-parse/browser/esm/sync';

const maxBytes = 1024 * 1024;
export async function readInboundCsv(file: Pick<File, 'size' | 'text'>): Promise<Record<string, string>[]> {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxBytes) throw new Error('Inbound CSV must be at most 1 MiB.');
  const text = await file.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('Inbound CSV must be at most 1 MiB.');
  let count = 0;
  const rows = parse(text, {
    columns: headers => {
      const normalized = headers.map(header => header.trim());
      const unique = new Set(normalized.map(header => header.toLocaleLowerCase('en')));
      if (unique.size !== normalized.length) throw new Error('CSV must not contain duplicate column names.');
      return normalized;
    }, skip_empty_lines: true, trim: true, bom: true,
    max_record_size: 32768,
    on_record: (record: Record<string, string>) => {
      if (++count > 200) throw new Error('Max 200 lines are allowed at a time.');
      return record;
    },
  }) as Record<string, string>[];
  if (!rows.length) throw new Error('CSV contains no inbound lines.');
  if (!rows.every(row => Object.hasOwn(row, 'sku_code') && Object.hasOwn(row, 'qty'))) throw new Error('CSV must contain sku_code and qty columns.');
  for (const row of rows) {
    const raw = row.qty.trim();
    const quantity = Number(raw);
    if (raw && Number.isSafeInteger(quantity) && quantity >= 0 && !/^\+?\d+(?:\.0+)?$/.test(raw)) {
      throw new Error('CSV whole-number quantities must use decimal notation.');
    }
  }
  return rows;
}
