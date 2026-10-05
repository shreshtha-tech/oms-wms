import { readFileSync, writeFileSync } from 'node:fs';

const staticAudit = JSON.parse(readFileSync('artifacts/navigation-audit/static-inventory.json', 'utf8'));
const runtimeAudit = JSON.parse(readFileSync('artifacts/navigation-audit/runtime-results.json', 'utf8'));
const runtimeByRoute = new Map(runtimeAudit.results.map(result => [result.route, result]));
const report = [];
const add = value => report.push(value);
const escape = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const routeKey = route => route?.split('/').at(-1) ?? '';
const reportInvented = new Map([
  ['inbound-qc-report', 'QC rejection and 98% acceptance are calculated from a fixed 2% assumption (`api/reports.js:36-41`).'],
  ['invoice-report', 'Invoice number is synthesized from the order number, not read from an invoice record (`api/reports.js:63-66`).'],
  ['inventory-ageing', 'Age buckets are fixed 50/30/15/5% splits of on-hand, not receipt age (`api/reports.js:98-103`).'],
  ['inventory-ledger', 'Inward/outward are inferred from reserved stock, not inventory events (`api/reports.js:105-110`).'],
  ['order-unallocation', 'Reasons and actors are inferred/hardcoded, not loaded from allocation history (`api/reports.js:160-172`).'],
]);
const specific = new Map([
  ['/app/seller-panel-dashboard', 'Initial counters stay zero because the component only calls its API after mode change; that handler returns zero counts and empty lists for every mode (`src/eretail/SellerPanelDashboard.tsx:11-18`, `api/seller-panel-dashboard.js:5`).'],
  ['/app/central-inventory', 'PostgreSQL overview/events returned 200, but all 3,243 catalog SKUs are uncounted and publication is pending in this run; channel sync is not demonstrated.'],
  ['/app/inventory', 'Reads legacy `/api/inventory` via Mongo/memory while Central Inventory reads the PostgreSQL ledger; the two views can show different stock (`src/pages/Inventory.tsx`, `src/pages/CentralInventory.tsx`).'],
  ['/app/admin/force-order-pull', 'Catalog GET works, but the Save POST deliberately returns HTTP 501 until a channel integration is configured (`api/admin.js:49-55`).'],
  ['/app/admin/exports', 'Pending-report list GET works, but Force Pull returns HTTP 501 without a report-generation service (`api/exports.js:38-41`).'],
  ['/app/admin/api-dashboard', 'Metrics GET works; Trace API Details and Download Data only display a service-required message (`src/eretail/admin/ApiDashboardReplica.tsx:17`).'],
  ['/app/r/mr-inventory-log', 'Normal search filters recorded rows by request and update dates. Archival, ingest, export, manual push, force push and retransmit are unavailable; no marketplace feed processor or report worker is connected (`api/mp-inventory-log.js`).'],
  ['/app/r/putaway-enquiry', 'Enquiry GET works, but unsupported PutAway source types return HTTP 501 (`api/putaway-enquiry.js:16`).'],
  ['/app/m/return-otc', 'Old OTC screen renders, but Generate OTC is disabled until a Flipkart connector is configured (`src/eretail/returns/ReturnOtc.tsx`).'],
  ['/app/m/return-otc-new', 'Task list GET returns 200, but start/end/repush actions are disabled until a Flipkart connector is configured (`src/eretail/returns/ReturnOtc.tsx`).'],
  ['/app/procurement/po/single', 'Editor loads, but its Download Template link targets `/api/purchase-order-import-template`, which has no server route (`src/eretail/procurement/ProcurementWorkflows.tsx:141`, `server.js`).'],
  ['/app/procurement/po/multiple', 'Editor loads, but its Download Template link targets `/api/purchase-order-import-template`, which has no server route (`src/eretail/procurement/ProcurementWorkflows.tsx:141`, `server.js`).'],
]);
const specialComponent = {
  'user-enquiry': 'RecordedUserEnquiry', 'user-create-edit': 'UserEditorReplica', 'role-create-edit': 'RoleEditorReplica',
  'user-audit-logs': 'UserAuditLogReplica', 'order-import': 'OrderImportReplica', 'common-import': 'CommonImportReplica',
  exports: 'ExportsReplica', 'force-order-pull': 'ForceOrderPullReplica', settings: 'SettingsReplica',
  'manage-api': 'ManageApiReplica', 'api-dashboard': 'ApiDashboardReplica', 'language-setting': 'LanguageSettingReplica',
};
const logScreens = new Set(['accounting-log', 'tax-integration-log', 'device-tracking-log', 'external-apps-logs', 'pos-integration-log', 'repush-log']);
const noTargetRoute = new Map([
  ['Attribute Set', '/app/m/attribute-set'],
  ['Vendor SKU Catalog', '/app/m/vendor-sku-catalog'],
  ['Vendor SKU Loc Catalog', '/app/m/vendor-sku-loc-catalog'],
  ['ARS SKU-Location Link', '/app/procurement/ars/sku-location'],
]);
const results = { Broken: 0, 'Partially working': 0, Unverifiable: 0, Working: 0 };

add('# Navigation end-to-end audit');
add('');
add(`**Audit date:** 24 September 2026. **Source:** rendered rail definition in \`src/eretail/menuData.ts\`, click behavior in \`src/eretail/Shell.tsx\`, route table in \`src/App.tsx\`, and Express handlers in \`server.js\`. The isolated browser pass used Chrome against a locally started server with a temporary admin, MongoDB deliberately unset, and the current PostgreSQL inventory connection. It visited all 149 distinct linked URLs and clicked all 24 unlinked flyout buttons. A 200 below proves page/API loading only; write actions, deployed services, marketplace accounts, and exact eRetail parity were not exercised.`);
add('');
add('**How to read statuses:** “Broken” means the rendered menu cannot navigate or the route redirects. “Partially working” means the route renders but the code establishes a concrete missing/incorrect business behavior or a simulated data source. “Unverifiable” means the screen rendered in this run, but its action/data path was not exercised or persistence was unavailable. “Working” is reserved for an end-to-end behavior proven here; no global menu item met that bar. All legacy Mongo handlers use the seeded in-memory fallback when `MONGODB_URI` is absent or fails (`api/mongo.js:2-8,76-88`), so their HTTP 200 responses are not proof of real persistent data.');
add('');
add('## 1. Full rendered global nav inventory');
add('');
add('| Tab name (rail › group) | Route | Component | Backend dependency | Status | Exact failure reason / evidence |');
add('|---|---|---|---|---|---|');
for (const item of staticAudit.items) {
  const group = item.group === '(none)' ? item.rail : `${item.rail} › ${item.group}`;
  const key = routeKey(item.route);
  const run = runtimeByRoute.get(item.route);
  let component = item.component || '—';
  if (component === 'AdminModule') component += ` → ${specialComponent[key] || (logScreens.has(key) ? 'AdminLogGrid' : 'screen-specific child')}`;
  if (component === 'ReportRoute') component += ' → ReportScreen';
  let backend = 'None on load';
  if (run) {
    const observed = [...new Set(run.api.filter(value => !['/api/auth/session', '/api/inventory-sync/central/summary'].includes(value.path)).map(value => `${value.path.split('?')[0]} ${value.status}`))];
    const declared = item.apiDependencies.filter(value => !observed.some(hit => hit.startsWith(`${value} `)));
    if (observed.length) backend = observed.slice(0, 3).join(', ') + (observed.length > 3 ? ` (+${observed.length - 3})` : '');
    if (declared.length) backend = `${backend === 'None on load' ? '' : `${backend}; `}action/declared: ${declared.slice(0, 3).join(', ')}${declared.length > 3 ? ` (+${declared.length - 3})` : ''}`;
  }
  let status = 'Unverifiable';
  let reason = '';
  if (!item.route) {
    status = 'Broken';
    const existing = noTargetRoute.get(item.label);
    reason = `Visible button has no \`to\`; \`Shell.tsx:10\` returns without navigating. Browser click stayed on dashboard.${existing ? ` Existing route: \`${existing}\`.` : ''} ${item.source}.`;
    backend = 'Never called';
  } else if (!item.component || run?.navigated !== item.route) {
    status = 'Broken';
    reason = `No matching \`App.tsx\` route; browser redirected to \`${run?.navigated || 'unknown'}\` via the catch-all. ${item.source}.`;
    backend = 'Never called';
  } else if (specific.has(item.route)) {
    status = 'Partially working';
    reason = specific.get(item.route);
  } else if (item.rail === 'Reports' && reportInvented.has(key)) {
    status = 'Partially working';
    reason = `GET /api/reports?type=${key} returned 200. ${reportInvented.get(key)}`;
  } else if (item.rail === 'Reports') {
    status = 'Unverifiable';
    reason = `Report type \`${key}\` is a distinct switch branch in \`api/reports.js\`; GET returned 200 using the seeded Mongo fallback. Actual source records and export were not verified.`;
  } else if (item.route?.startsWith('/app/admin/') && logScreens.has(key)) {
    status = 'Partially working';
    reason = `Dedicated \`AdminLogGrid\` mounted and catalog GET returned 200, but log action POST deliberately returns HTTP 501 without the integration service (\`api/admin-parity.js:82\`).`;
  } else if (backend.includes('/api/generic')) {
    status = 'Partially working';
    reason = `Route rendered, but records use \`/api/generic\` rather than a dedicated business handler; it stores generic records in Mongo/memory. Live semantics and persistence were not proven.`;
  } else if (backend === 'None on load') {
    reason = `Component rendered at the expected URL with no page error; no business API ran on initial load, so its actions and real data remain unverified. ${item.routeSource}.`;
  } else {
    reason = `Component rendered at the expected URL. ${run.api.some(value => !['/api/auth/session', '/api/inventory-sync/central/summary'].includes(value.path)) ? 'Observed business GETs returned 200.' : 'Its business endpoint was declared but not called on initial load.'} With Mongo unset, legacy handler persistence was unavailable; writes were not tested. ${item.routeSource}.`;
  }
  results[status]++;
  add(`| ${escape(`${item.label} (${group})`)} | ${escape(item.route ? `\`${item.route}\`` : '—')} | ${escape(`\`${component}\`${item.componentFile ? ` (${item.componentFile})` : ''}`)} | ${escape(backend)} | ${status} | ${escape(reason)} |`);
}
add('');
add(`**Global menu totals:** ${staticAudit.items.length} rendered entries; 150 linked entries, 149 distinct URLs, 24 buttons without destinations, 1 linked URL with no route. Status counts: ${Object.entries(results).map(([key, value]) => `${key} ${value}`).join('; ')}.`);
add('');
add('### Header and nested navigation controls');
add('');
add('| Control | Destination/handler | Runtime/code result |');
add('|---|---|---|');
add('| Back, open-screen strip, Open Screen(s) | `ScreenContext` history and `activateScreen`/`goBack` in `Shell.tsx:85-104,190-226` | Dynamic history, not a fixed route; code path exists. Cross-tab state retention was not tested in this audit. |');
add('| Export Report Status | `/app/downloads` from `Shell.tsx:226` | Header click reached `/app/downloads` and rendered `Downloads`; download history persistence was not verified. |');
add('| Switch Location / User Preferences | Opens dialog in `Shell.tsx:209,281-301` | Header click opened the dialog. Dialog state is local; no location selection or backend save is wired. Partially working for a switch-location control. |');
add('| Profile / Logout | `Shell.tsx` user menu; logout via `AuthContext` → `/api/auth/logout` | Session clearing path exists in `server.js:164`; logout click was not exercised during route sweep. |');
add('| Central Inventory: Stock overview | Local section `overview`; `/api/inventory-sync/central/overview`, `/events` | Rendered at `/app/central-inventory`; API 200, 3,243 catalog SKUs, 0 counted. |');
add('| Central Inventory: Record physical stock | Local section `stock`; POST `/api/inventory-sync/central/adjustments` | Form and handler exist; actual stock mutation was not run to avoid changing the inventory ledger. |');
add('| Central Inventory: Excel upload | Local section `upload`; template, preview and commit endpoints under `/api/inventory-sync/central` | Code paths exist; no workbook was submitted in this audit. |');
add('| Central Inventory: Low-stock alerts | Local section `alerts`; POST `/api/inventory-sync/central/alert-rules` | Code path exists; no alert rule was changed. |');
add('| Central Inventory: Channel connections | Local section `channels`; overview plus `platformRequirements.ts` | Requirement matrix renders, but the runtime overview said publication pending. This is not proof of active channel sync. |');
add('| Central Inventory: Ledger activity | Local section `activity`; `/api/inventory-sync/central/events` | GET 200; no counted SKU/event in the isolated run. |');
add('');
add('All six Central Inventory section buttons were clicked in the browser and each selected the expected heading; they are local React state switches (`src/pages/CentralInventory.tsx:13,51`), so they do not change URL. The legacy Inventory View has its own eight query modes (`src/pages/Inventory.tsx`) and uses `/api/inventory`, a distinct source from the PostgreSQL ledger.');
add('');
add('## 2. Duplicate and near-duplicate tabs');
add('');
add('| Tabs involved | Shared functionality | Recommended keep | Recommended remove/change | Code-backed justification |');
add('|---|---|---|---|---|');
add('| Dashboard rail icon / D-Mills Dashboard flyout | Exact `/app/dashboard` → `EDashboard` | Dashboard rail icon | D-Mills Dashboard flyout entry | `menuData.ts:28,30` points both controls to the identical route/component; the rail icon is the shorter persistent entry. |');
add('| Master ARS SKU-Location Link / Procurement ARS SKU-Location Link | Same named workflow | Procurement entry | Master no-target entry | Master button has no `to`; Procurement routes to `/app/procurement/ars/sku-location` and loads its ARS component/API. |');
add('| Inventory View / Central Inventory | Both present quantities and SKU inventory | Central Inventory for authoritative counts, alerts and ledger | Retire legacy Inventory View only after its eight query modes are migrated or preserved as read-only enquiry | `Inventory.tsx` reads `/api/inventory` (Mongo/memory); `CentralInventory.tsx` reads `/api/inventory-sync/central/*` (PostgreSQL). They overlap but are not equivalent. |');
add('| Return OTC(Flipkart) / Return OTC(Flipkart) New | Same `ReturnOtc` component | Keep both while old form and new task list represent separate stages | Do not remove either yet; rename for stage clarity after connector activation | `App.tsx` passes `modern=false/true`; the old screen has order input, the new one lists task records. Both currently lack Flipkart actions. |');
add('| MIS reports / MIS Report 2.0 | Same `ReportScreen`/`/api/reports` engine | Keep MIS Report 2.0 if replacing legacy summary | Keep legacy until consumers are migrated; then remove it | `api/reports.js:142-154` gives global totals; `:174-186` gives per-channel orders, revenue and fulfillment. They are related, not identical. |');
add('| Fin Inv Report - By SKU / By SKU BIN | Same report engine | Keep both | None | `api/reports.js:78-97` provides SKU/location versus SKU/location/bin granularity; the difference is a real use case. |');
add('');
add('## 3. Priority-ordered fixes');
add('');
add('1. **Blocker — protect real stock and access:** make the PostgreSQL ledger the stated stock source across Inventory View, reports and allocation; validate credentials/roles at API level. The router only checks for any session (`ProtectedRoute.tsx:5-8`) and `server.js:165-169` checks any user, with no role-specific authorization. The isolated run did not prove multi-user enforcement.');
add('2. **Blocker — remove false operational data:** replace `api/seller-panel-dashboard.js:5` all-zero response and `api/reports.js` assumed QC, ageing, ledger, invoice and unallocation values with actual records or an explicit unavailable state. These screens currently render convincing but inaccurate information.');
add('3. **High — repair 25 broken menu entries:** assign real routes to the 24 no-target buttons or remove them from the rendered menu; add a genuine Sales Representative route or remove its link. Wire existing Attribute Set/Vendor SKU Catalog routes rather than leaving duplicate dead controls.');
add('4. **High — complete blocked actions:** configure channel-specific Force Order Pull (`api/admin.js:49-55`), MP Inventory Log push/retransmit (`api/mp-inventory-log.js:3-4`), and pending-report Force Pull (`api/exports.js:38-41`) before exposing those actions; provide the PO import template route used by the Single/Multiple Location editor (`ProcurementWorkflows.tsx:141`).');
add('5. **Medium — clarify conditional workflows:** API Dashboard trace/download and both Flipkart OTC stages should remain visibly unavailable until their actual services exist; do not report them as live. Retire the duplicate Dashboard flyout entry and Master ARS dead item.');
add('6. **Medium — location preferences:** connect the header Switch Location control to a persisted location selection or label it as display-only preferences (`Shell.tsx:209,281-301`).');
add('');
add('**Cosmetic issues:** none classified as functional failures in this audit. Layout, spacing, icon choice and responsive overflow were outside the route/backend test and should be evaluated separately.');
add('');
add('## 4. What could not be verified');
add('');
add('- The route sweep used an isolated local server and temporary admin. MongoDB was unset, so legacy handlers returned seeded memory data; no Mongo persistence, deployed behavior, or multi-user role policy was verified.');
add('- No real seller-channel portal/API interaction or inventory publication was exercised. The Central Inventory page explicitly reported channel publication pending and zero counted SKUs.');
add('- Navigation/load checks did not submit edits, uploads, refunds, transfers, orders, stock counts, or destructive actions. Those rows are marked Unverifiable or Partially working where code establishes a concrete gap.');
add('- The browser visited every fixed global menu URL, but did not exhaust every local mode/button inside the 149 pages. The six Central Inventory local sections and global header controls are traced separately above.');
add('- Static API extraction reads string literals in route components and browser response capture on initial load; lazy action endpoints may appear as “declared” but were not called. `server.js` mounts `/api/inventory-sync` as a router, so those nested paths are valid even though they are not individual string keys in its route object.');
add('- No authenticated LIVE Vin eRetail comparison was part of this audit; local functionality is not a parity claim.');
add('');
add('## Verification');
add('');
add('- Browser: 149/149 distinct linked menu URLs visited; 149 HTTP 200 document loads; one redirected to dashboard (`/app/m/sales-rep`); zero browser page errors, zero observed API 4xx/5xx on initial load; 24/24 no-target buttons clicked without navigation.');
add('- `npm run typecheck`: passed. `npm run build`: passed, with Node 20.14 below Vite’s preferred 20.19+ and a large-bundle warning.');
add('- Nested browser pass: six Central Inventory section headings selected correctly; Switch Location opened User Preferences; Export Report Status reached `/app/downloads` and rendered Downloads.');
add('- Raw evidence: `artifacts/navigation-audit/static-inventory.json`, `runtime-results.json`, and `nested-results.json`. These do not contain login credentials.');
writeFileSync('docs/NAVIGATION_END_TO_END_AUDIT.md', report.join('\n') + '\n');
console.log(JSON.stringify({ rows: staticAudit.items.length, statuses: results, report: 'docs/NAVIGATION_END_TO_END_AUDIT.md' }));
