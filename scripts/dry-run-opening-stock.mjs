import { readFile } from 'node:fs/promises';
import { validateOpeningStockWorkbook } from '../inventory/opening-stock-validation.js';

const [workbookPath, mappingPath, registryPath] = process.argv.slice(2);
if (!workbookPath || !mappingPath || !registryPath) {
  console.error('Usage: node scripts/dry-run-opening-stock.mjs source.xlsx approved-mapping.json tenant-registry-snapshot.json');
  process.exitCode = 2;
} else {
  try {
    const [bytes, mappingText, registryText] = await Promise.all([
      readFile(workbookPath), readFile(mappingPath, 'utf8'), readFile(registryPath, 'utf8'),
    ]);
    const mapping = JSON.parse(mappingText), registry = JSON.parse(registryText);
    const report = await validateOpeningStockWorkbook({ bytes, mapping, tenantId: registry.tenantId, skus: registry.skus, locations: registry.locations });
    console.log(JSON.stringify({
      fileSha256: report.fileSha256, mappingVersion: report.mappingVersion,
      sheet: report.sheet, tenantId: report.tenantId,
      rowsRead: report.rowsRead, rowsValid: report.rowsValid, rowsInvalid: report.rowsInvalid,
      rowsDuplicated: report.rowsDuplicated, rowsUnmapped: report.rowsUnmapped,
      rowsAmbiguous: report.rowsAmbiguous, rowsReadyForApproval: report.rowsReadyForApproval,
      rowsReadyToImport: report.rowsReadyToImport, counts: report.counts,
      rejectedRows: report.rows.filter(row => row.status !== 'VALID').slice(0, 100).map(row => ({ sheet: row.sheet, row: row.row, status: row.status, issues: row.issues })),
      rejectedRowsShown: Math.min(report.rowsInvalid, 100),
      note: 'Read-only dry run using caller-supplied registry snapshot. Registry provenance and active status require independent verification before approval. No stock was posted.',
    }, null, 2));
  } catch (error) {
    console.error(`Opening-stock dry run failed: ${error.code || error.message}`);
    process.exitCode = 1;
  }
}
