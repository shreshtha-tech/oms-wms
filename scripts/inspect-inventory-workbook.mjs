import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { inspectInventoryWorkbook } from '../inventory/workbook-inspector.js';

const source = process.argv[2];
if (!source || !/\.xlsx$/i.test(source)) {
  console.error('Usage: node scripts/inspect-inventory-workbook.mjs /absolute/path/to/source.xlsx');
  process.exitCode = 2;
} else {
  try {
    const report = await inspectInventoryWorkbook(await readFile(source), basename(source));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(`Workbook inspection failed: ${error.code || error.message}`);
    process.exitCode = 1;
  }
}
