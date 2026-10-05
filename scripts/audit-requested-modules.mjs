import { readFileSync, writeFileSync } from 'node:fs';

const request = readFileSync(process.argv[2], 'utf8');
const navigation = readFileSync('docs/NAVIGATION_END_TO_END_AUDIT.md', 'utf8');
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const table = navigation.split('## 1. Full rendered global nav inventory')[1].split('### Header and nested navigation controls')[0];
const rows = table.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('|---') && !line.startsWith('| Tab name'))
  .map(line => line.split(' | ').map(part => part.replace(/^\|\s*|\s*\|$/g, '').trim()))
  .filter(parts => parts.length >= 6)
  .map(([name, route, component, backend, status, evidence]) => ({
    name: name.replace(/ \((?:[^)]* › [^)]*|Procurement|Sales)\)$/, ''), route, component, backend, status, evidence,
  }));
const requested = [];
let section = '';
for (const line of request.split('\n')) {
  const match = line.match(/^- \*\*(.+?):\*\* (.+)$/);
  if (!match) continue;
  section = match[1];
  for (const label of match[2].split(';').flatMap(part => part.split(/; /))) {
    for (const item of label.split(/; /)) {
      const value = item.trim().replace(/\.$/, '');
      if (!value) continue;
      if (value.startsWith('PO Create/Edit (')) {
        for (const sub of ['Single Location', 'Multiple Location', 'From Back Orders']) requested.push({ section, label: `PO Create/Edit — ${sub}`, lookup: sub });
      } else requested.push({ section, label: value, lookup: value });
    }
  }
}
const special = new Map([
  ['Manage API', 'Manage Api'], ['Return OTC (Flipkart)', 'Return OTC(Flipkart)'],
  ['Return OTC (Flipkart) New', 'Return OTC(Flipkart) New'],
  ['Fin Inv Report - By SKU BIN', 'Fin Inv Report - By SKU BIN'],
]);
const currentFixes = new Map([
  ['Common Import', ['Partially functional', 'Isolated handler validation', 'Import types and configuration remain available. Template, import, and history actions now return HTTP 501 until their services exist; attempts create no false processed batch.', 'Business import processors, real template storage, history persistence, and signed-in workflow remain unavailable.']],
  ['Order Import', ['Partially functional', 'Isolated handler validation', 'Import metadata and input validation remain available. Template, import, and history actions now return HTTP 501; the CSV text is no longer recorded as fabricated successful or failed orders.', 'Type-specific parsing, business updates, genuine templates, and verified history remain unavailable.']],
  ['SKU Management / Vendor SKU Catalog', ['Partially functional', 'Signed-in isolated browser/API workflow with MongoDB readback', 'Active Vendor and Master SKU references, create/search, numeric and min/max guards, duplicate protection, authenticated actor/date and persisted numeric values passed. Central Inventory events were unchanged.', 'Configured production MongoDB reachability, LIVE parity, concurrent duplicate requests, update workflow, downstream procurement and non-admin permissions remain unverified.']],
  ['SKU Management / Vendor SKU Loc Catalog', ['Partially functional', 'Signed-in isolated browser/API workflow with MongoDB readback', 'Active Vendor/SKU/Location references, inactive and unknown-reference guards, create/search, numeric and min/max validation, duplicate protection, actor/date readback and unchanged Central Inventory events passed.', 'Configured production MongoDB reachability, LIVE parity, concurrent duplicate requests, update workflow, downstream procurement and non-admin permissions remain unverified.']],
  ['SKU Management / ARS SKU-Location Link', ['Partially functional', 'Signed-in isolated browser/API workflow with MongoDB readback', 'Signed create/edit/bulk update, required/numeric/duplicate guards, authenticated actor/date, search/reset/paging, import navigation, real CSV download content, MongoDB readback and unchanged Central Inventory events passed.', 'Full export returns HTTP 501; import execution, duplicate races, non-admin permissions, configured database reachability, LIVE parity and downstream replenishment remain unverified.']],
  ['ARS / ARS Rules', ['Partially functional', 'Signed-in isolated browser/API workflow with MongoDB readback', 'Rule create/confirm, active location and SKU-set references, authenticated actor/date, Monthly frequency search, reload/reopen and MongoDB readback passed. Run Now returns HTTP 501 and creates no execution log.', 'Recorded sales inputs, atomic idempotent PO generation, Central Inventory readback, production roles, configured MongoDB reachability and LIVE parity remain unverified.']],
  ['ARS / ARS Execution Log', ['Partially functional', 'Signed-in isolated browser/API workflow with a labeled read-only fixture', 'Search/filter, location/rule/execution pickers, Reset/paging, stored detail/status, CSV content/history and unchanged fixture after approve/process/edit HTTP 501 responses passed. The fixture is not a claimed ARS execution.', 'Actual execution provenance, live history data, approval/processing jobs, roles, configured MongoDB reachability and LIVE parity remain unverified.']],
  ['Channels and OMS / Manage Channels', ['Partially functional', 'Signed-in isolated browser create/search with MongoDB readback', 'Channel create, actor/date, case-insensitive duplicates, stale-ID and numeric guards, InActive search and metadata readback passed. Fake reconcile/sync actions are disabled; Channel Configured stays No until verified seller access/readback. `scripts/verify-manage-channels.mjs`.', 'Live provider authorization, SKU/location mapping, inventory readback, order feed, concurrency, other-role permissions, configured MongoDB reachability and LIVE parity remain unverified.']],
  ['Sales Representative', ['Nonfunctional', 'Current static menu-to-route audit', 'No Sales Representative screen is registered; the menu item is now disabled instead of redirecting to the dashboard.', 'A verified workflow contract and dedicated screen are still required.']],
  ['Inbound QC', ['Partially functional', 'Isolated API scan, replay, confirm and report', 'Invalid quantity rejected; same request ID replay returned one rejection; over-rejection returned 409; confirmed QC produced 5 received, 2 rejected, 60% accepted in the report. Pass/Hold now return 501 instead of false success.', 'Live UI/export, concurrent Mongo writes, Pass/Hold integration, and Central Inventory receipt remain unverified.']],
  ['Inbound Create/Edit', ['Partially functional', 'Isolated PO, receipt-stage, replay, and fail-closed checks', 'Import checks PO membership, positive whole quantities, and duplicate rows. Confirm enforces remaining PO quantity, persists a stable request ID, stages the GRN, and posts exact-mapped SKU/location receipts through the existing Central Inventory ledger. Failed central writes remain Pending and retries cannot change the staged payload.', 'No PostgreSQL receipt transaction or signed-in browser test was run. Exact production mappings, attachments, additional charge, putaway, and lot/bin attribution remain unverified.']],
  ['Inbound RealTime', ['Partially functional', 'Isolated PO receipt, replay, over-receipt, and fail-closed checks', 'PO-linked Confirm stages a stable Central Inventory request and uses the shared idempotent receipt transaction. Unsupported inbound types, import, and reversal return HTTP 501; placeholder Save Document, Print, Additional Charge, and Receive All messages no longer claim success.', 'No PostgreSQL receipt transaction or signed-in browser test was run. ASN/direct/STO/return receipt mappings, attachments, charge, import, reversal, print, and Receive All remain unavailable.']],
  ['Transhipment', ['Partially functional', 'Isolated enquiry, UDF, and fail-closed action checks', 'Search and metadata-only UDF edits work. Import, receive, QC, undo/reverse, manifest, print, export, and ingest return HTTP 501; no LPN or report job is fabricated.', 'Central Inventory transfer and receipt mapping, manifest/document services, real MongoDB, and signed-in browser actions remain unverified.']],
  ['Transhipment Old', ['Partially functional', 'Isolated CSV import, search, export, duplicate, and fail-closed action checks', 'Explicit user CSV rows can be imported, searched, and exported as logistics records. Direct ingest and receiving/QC/pack/dispatch/POD status updates return HTTP 501 without changing row status.', 'No Central Inventory lifecycle mapping, real MongoDB transaction, permissions, or signed-in browser workflow was tested.']],
  ['MP Inventory Log', ['Partially functional', 'Isolated API search, date-filter and fail-closed checks', 'Normal search filters recorded rows by SKU/channel/status, request-date range, and update-date range. Archival, ingest, export, Force Push, ReTransmit, and Manual Inventory Push fail closed; invented SKU/channel/default status values and empty report jobs are no longer created.', 'A verified marketplace feed processor, durable integration log source, archive service, export service, provider acknowledgment, and Central Inventory reconciliation remain unavailable.']],
  ['SKU Management / SKU Master', ['Partially functional', 'Signed-in isolated browser/API workflow and MongoDB readback', 'Initial load, stable paging response, global SKU Name search, create/edit/reset, authenticated audit fields, validation and delete guard passed. Import routes to the actual CSV importer; MetaData Export is disabled because no separate export contract exists.', 'LIVE parity, non-admin permissions, multi-user duplicate races, hard-coded Category/UOM catalogs, complete export, and Central Inventory master-product mapping remain unverified. No Central Inventory events changed.']],
  ['SKU Management / SKU Import', ['Partially functional', 'Signed-in isolated CSV import with MongoDB row/history readback', 'Active Attribute Set and CSV CreateUpdate flow (up to 500 rows) passed with quoted fields, one successful row, duplicate/missing-name failures, authenticated uploader and history search.', 'XLSX and Common Import processing are unavailable; row-level error detail, archived source file, LIVE parity and non-admin permissions remain unverified. No Central Inventory events changed.']],
  ['SKU Management / SKU Barcode', ['Partially functional', 'Signed-in isolated browser/API workflow with MongoDB readback', 'Initial enquiry, create/edit, audit actor, Master SKU reference validation, case-insensitive duplicate and case-size guards, search/reset, quoted CSV preview, successful-row batch persistence, and unchanged Central Inventory events passed.', 'LIVE barcode/UOM/type rules, barcode checksum, non-admin permissions, duplicate concurrency, durable failure history, and import export parity remain unverified.']],
  ['SKU Management / SKU Company Link', ['Partially functional', 'Signed-in isolated browser/API workflow with MongoDB readback', 'Company/Location/SKU reference validation, SKU Code/Name filtering, dual-grid Add/Remove, authenticated actor/date, accurate idempotent change counts, Reset, and unchanged Central Inventory events passed.', 'LIVE parity, production MongoDB reachability, roles beyond the isolated administrator, paging beyond the 200-row client cap, concurrent duplicate adds, and durable removal history remain unverified.']],
  ['SKU Management / Manage SKU Group', ['Partially functional', 'Signed-in isolated browser/API workflow with MongoDB readback', 'Create/edit, Client filtering, Reset, Master SKU membership validation, case-insensitive duplicate/stale/immutable-code guards, Active/InActive state, accurate membership counts, authenticated actor/date, and paging passed. No Central Inventory events changed.', 'LIVE parity, production MongoDB reachability, roles beyond the isolated administrator, concurrent duplicate creation, deletion policy and export content remain unverified.']],
  ['SKU Management / Merchandising Hierarchy', ['Partially functional', 'Signed-in isolated browser/API workflow with MongoDB readback', 'Department and Category create/edit persisted as a tree with parent references, five UDFs and Other Settings; duplicate, missing-parent, self/cycle, stale-ID, immutable-code and field validation passed. Authenticated audit fields, CSV file contents, Reset, and unchanged Central Inventory events passed.', 'Configured production MongoDB reachability and LIVE parity remain unverified. Type-specific parent-level rules, unique default policy, non-admin permissions, import and audit history remain unavailable or unverified.']],
  ['Manage Attribute', ['Partially functional', 'Signed-in isolated browser/API workflow with MongoDB readback', 'Search/create, strict field validation, case-insensitive duplicate protection, authenticated actor/date, combined filters, Reset, 20/50/100/200 paging and unchanged Central Inventory events passed.', 'Update and export are not exposed. Configured production MongoDB reachability, LIVE parity, concurrent duplicate creation and non-admin permissions remain unverified.']],
  ['Attribute Set', ['Partially functional', 'Signed-in isolated browser/API workflow with MongoDB readback', 'Create/search/reset/delete, required and status validation, authenticated actor/date, module-scoped delete, active Attribute Set visibility to SKU Import and unchanged Central Inventory events passed.', 'Edit is not exposed. Configured production MongoDB reachability, LIVE parity, references from existing SKU/import records, duplicate descriptions and non-admin permissions remain unverified.']],
  ['Inbound QC Report', ['Partially functional', 'Isolated report handler', 'Completed QC row used recorded received and rejected quantities; 10 received, 2 rejected yielded 80% accepted.', 'Fixed fabricated 98%; signed-in source and export remain unverified.']],
  ['Inventory View', ['Partially functional', 'Isolated Central Inventory view contract', 'Balance reads, search rows, and stock summaries derive from Central Inventory; legacy Mongo balance writes return HTTP 501. Only SKU/location balances are exposed; detailed tabs without verified data are disabled.', 'Signed-in tenant read, browser search, application threshold storage, and production database remain unverified.']],
  ['Inventory Move History', ['Partially functional', 'Source integration and filter validation', 'History reads completed location-transfer events from the Central Inventory ledger. Filters for bins, LPNs, user, client, style, and USN return HTTP 501 when requested.', 'PostgreSQL tenant query and signed-in browser search remain unverified; legacy Mongo-only bin records are excluded.']],
  ['Inventory Move', ['Nonfunctional', 'Isolated handler and UI contract check', 'Legacy bin-level search, execute, and import are paused; the UI explains the missing mapping and API returns HTTP 501. Verifier confirms stock rows remain unchanged.', 'Central Inventory has no verified bin/lot/LPN balance mapping; approved data mapping and transaction integration are required.']],
  ['Inventory Move By Scan', ['Nonfunctional', 'Isolated handler and UI contract check', 'Legacy bin/LPN display and movement actions are paused; API returns HTTP 501 and no isolated stock rows change.', 'Central Inventory has no verified bin/LPN balance mapping; approved data mapping and transaction integration are required.']],
  ['Manage Stock Adjustment', ['Partially functional', 'Static menu route and source integration', 'Menu now opens the Central Inventory-backed adjustment screen; its API writes through the existing event ledger with integer quantity, reason, and request ID checks.', 'No PostgreSQL transaction test was run because the disposable tenant ID is still outstanding.']],
  ['Order Allocate/Unallocate', ['Nonfunctional', 'Isolated API handler check', 'Both allocation endpoints return HTTP 501 until order-line reservations are integrated with Central Inventory; status-only updates return the same error.', 'No stock reservation workflow is implemented or verified. Order allocation must not be used for live fulfillment yet.']],
  ['Cycle Count', ['Nonfunctional', 'Isolated API handler check', 'Create, confirm, and post return HTTP 501; the GET response exposes no legacy Mongo bin/LPN balances.', 'Bin/LPN identity mapping, count capture, variance review, and central posting are unavailable.']],
  ['Invoice', ['Partially functional', 'Isolated report handler', 'Returned a recorded invoice number for an isolated order.', 'Fixed synthesized invoice number; actual invoice source and print remain unverified.']],
  ['Order Unallocation Log', ['Partially functional', 'Isolated report handler', 'Returned recorded unallocation reason and actor for an isolated order.', 'Fixed inferred reason; actual allocation audit coverage remains unverified.']],
  ['Fin Inv Report - By SKU', ['Nonfunctional', 'Isolated report handler', 'Returns HTTP 501 instead of Mongo-derived stock value.', 'Requires Central Inventory balances and recorded valuation.']],
  ['Fin Inv Report - By SKU BIN', ['Nonfunctional', 'Isolated report handler', 'Returns HTTP 501 instead of Mongo-derived stock value.', 'Requires Central Inventory bin attribution and recorded valuation.']],
  ['Inventory Ageing', ['Nonfunctional', 'Isolated report handler', 'Returns HTTP 501 instead of fixed ageing splits.', 'Requires receipt-dated stock layers.']],
  ['Inventory Ledger', ['Nonfunctional', 'Isolated report handler', 'Returns HTTP 501 instead of inferred inward/outward quantities.', 'Requires Central Inventory event history integration.']],
  ['MIS Reports', ['Partially functional', 'Isolated report handler', 'Inventory Units is labelled unavailable; no Mongo-derived count is shown.', 'Other MIS metrics and signed-in workflow remain unverified.']],
]);
const output = [
  '# Requested module audit checklist', '',
  'Generated from the supplied scope, the 24 September 2026 local navigation audit, current source inspection, and current isolated handler checks. This is a **navigation and code evidence baseline**, not a current signed-in workflow or persistence test. The prior browser run had no MongoDB connection and used the then-current fixture; the current `api/seed.js` registry is empty. No row below is classified fully functional.', '',
  '“Load only” means a prior browser visit to the route and its initial API calls; it does not cover create, edit, import, export, approval, print, permissions, or stock propagation. “No target” means the visible menu button did not navigate in that prior run. Current behavior must be retested.', '',
  '| Module | Route | Classification | Action tested | Observed result and evidence | Defect / fix or blocker |',
  '|---|---|---|---|---|---|',
];
let current = '';
const currentRoutes = new Map([
  ['Sales Representative', '—'],
  ['SKU Management / Vendor SKU Catalog', '/app/m/vendor-sku-catalog'],
  ['SKU Management / Vendor SKU Loc Catalog', '/app/m/vendor-sku-loc-catalog'],
  ['SKU Management / ARS SKU-Location Link', '/app/procurement/ars/sku-location'],
  ['ARS / ARS Rules', '/app/procurement/ars/rules'],
  ['ARS / ARS Execution Log', '/app/procurement/ars/logs'],
  ['Channels and OMS / Manage Channels', '/app/channels'],
  ['WMS Inventory / Manage Stock Adjustment', '/app/m/stock-adjustment'],
  ['MIS Report 2.0', '/app/r/mis-report-2'],
]);
for (const item of requested) {
  if (item.section !== current) { current = item.section; output.push(`| **${current}** | | | | | |`); }
  const key = normalize(special.get(item.lookup) || item.lookup);
  const candidates = rows.filter(row => normalize(row.name) === key);
  const row = item.section === 'ARS' && item.lookup === 'ARS SKU-Location Link'
    ? candidates.find(candidate => candidate.route.includes('/app/procurement/ars/'))
    : candidates[0];
  const clean = value => String(value || '').replaceAll('|', '\\|').replace(/`/g, '').replace(/\[[^\]]+\]/g, '').trim();
  const scopedKey = `${item.section} / ${item.label}`;
  const fixed = currentFixes.get(scopedKey) || currentFixes.get(item.label);
  if (fixed) {
    output.push(`| ${clean(item.label)} | ${currentRoutes.get(scopedKey) || currentRoutes.get(item.label) || (item.label === 'Attribute Set' ? '/app/m/attribute-set' : clean(row?.route || '—'))} | ${fixed[0]} | ${fixed[1]} | ${fixed[2]} | ${fixed[3]} |`);
    continue;
  }
  if (!row) {
    output.push(`| ${clean(item.label)} | — | Unverified | None in prior audit | No exact menu row matched. | Identify route and test intended workflow. |`);
    continue;
  }
  const classification = row.status === 'Broken' ? 'Nonfunctional' : row.status === 'Partially working' ? 'Partially functional' : 'Unverified';
  const action = row.status === 'Broken' ? 'Menu click' : 'Route load only';
  output.push(`| ${clean(item.label)} | ${clean(row.route)} | ${classification} | ${action} | ${clean(row.evidence)} | ${row.status === 'Broken' ? 'No working navigation; requires a verified workflow contract.' : 'Action, persistence, permissions, and Central Inventory consistency remain unverified.'} |`);
}
const classificationCounts = { Unverified: 0, 'Partially functional': 0, Nonfunctional: 0 };
for (const line of output) {
  if (!line.startsWith('| ')) continue;
  const classification = line.split('|')[3]?.trim();
  if (Object.hasOwn(classificationCounts, classification)) classificationCounts[classification]++;
}
output.push('', '## Source and limits', '',
  '- Route and initial-load evidence: [Navigation end-to-end audit](NAVIGATION_END_TO_END_AUDIT.md).',
  '- The historical browser audit is dated 24 September 2026; the 29 September static source pass found 174 menu entries, 20 without destinations, and no linked route without a registered target. Neither check establishes transaction correctness.',
  `- This checklist has ${requested.length} supplied module rows: ${classificationCounts.Unverified} unverified, ${classificationCounts['Partially functional']} partially functional, ${classificationCounts.Nonfunctional} nonfunctional, and zero fully functional. These are evidence classifications; most actions, roles, persistence, and live stock propagation remain untested.`,
  '- Inbound RealTime now has isolated checks for PO receipt staging, replay, over-receipt, and fail-closed unsupported actions. PostgreSQL commit, browser workflow, Mongo persistence, and propagation latency remain unverified.',
  '- Repeated menu labels may map to different routes; inspect both entries before consolidating.',
  '- No current synchronization latency measurement or full transaction test is available from this baseline.', '');
writeFileSync('docs/REQUESTED_MODULE_AUDIT_CHECKLIST.md', output.join('\n'));
console.log(`Wrote ${requested.length} requested module rows; ${rows.length} prior navigation rows parsed.`);
