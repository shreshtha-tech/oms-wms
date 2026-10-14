import { parse } from 'csv-parse/browser/esm/sync';

export type ZonePickerLink = { zone: string; picker: string };

export async function readZonePickerCsv(file: Pick<File, 'size' | 'text'>): Promise<ZonePickerLink[]> {
  const maxBytes = 1024 * 1024;
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxBytes) throw new Error('Zone-picker CSV must be at most 1 MiB.');
  const content = await file.text();
  if (new TextEncoder().encode(content).byteLength > maxBytes) throw new Error('Zone-picker CSV must be at most 1 MiB.');
  let count = 0;
  const records = parse(content, {
    bom: true, skip_empty_lines: true, trim: true, max_record_size: 32768,
    on_record: (record: string[]) => {
      if (++count > 201) throw new Error('Zone-picker CSV may contain at most 200 links.');
      return record;
    },
  }) as string[][];
  const [header, ...rows] = records;
  if (!header || header.length !== 2 || header[0] !== 'Zone' || header[1] !== 'Picker') throw new Error('CSV columns must be Zone,Picker.');
  if (!rows.length) throw new Error('CSV contains no zone-picker links.');
  const seen = new Set<string>();
  return rows.map((row, index) => {
    if (row.length !== 2 || !row[0] || !row[1]) throw new Error(`Invalid zone-picker link on line ${index + 2}.`);
    const zone = row[0].trim();
    const picker = row[1].trim();
    if (!zone || !picker || zone.length > 100 || picker.length > 100) throw new Error(`Invalid zone-picker link on line ${index + 2}.`);
    const key = JSON.stringify([zone, picker]);
    if (seen.has(key)) throw new Error(`Duplicate zone-picker link on line ${index + 2}.`);
    seen.add(key);
    return { zone, picker };
  });
}
