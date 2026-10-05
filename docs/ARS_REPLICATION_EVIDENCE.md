# ARS (Procurement) Replication Evidence

Historical source used by the original implementation: `Vin eRetail _ ARS (procurement) – Vinculum Product Guide.pdf` (7 pages). That guide is not present in the current workspace and is not a substitute for authenticated LIVE evidence.

Historical verification boundary (2026-08-26): **ARS SKU-Location Link, ARS Rules, ARS Execution Log, and B2B ARS/ROS Settings were authenticated-live inspected and locally verified for the actions recorded at that time.**

Current checkout update (2026-09-29): the pending full export job, Run Now purchase-order generation, and log Approve All/Process All paths failed integrity review. They now return HTTP 501; visible ARS link rows and stored log detail use the actual local download flow. `npm run test:ars-integrity` verifies no PO, log, status, or fake download is created. The historical browser comparisons below do not verify the changed actions, tenant persistence, Central Inventory propagation, or current LIVE parity.

## 1. Historical implementation evidence (26 August 2026)

| Module | Route | Implemented surface |
|---|---|---|
| ARS SKU-Location Link | `/app/procurement/ars/sku-location` | Authenticated live handlers/UI/API/validation; historical local add/edit/bulk persistence and Pending Report behavior. Current full export job is disabled. |
| ARS Rules | `/app/procurement/ars/rules` | Authenticated enquiry/editor/SKU-set dialog/validation inspection and historical local search/editor persistence. Current Run Now is disabled. |
| ARS Execution Log | `/app/procurement/ars/logs` | Authenticated parent/detail/status/picker inspection and historical local approve/process behavior. Current approve/process actions are disabled. |
| B2B ARS/ROS Settings | `/app/procurement/ars/settings` | Authenticated Settings HTML/control/SettingBS.js handler/validation/API inspection; historical local save and second comparison. |

## 2. Historical local workflows and verification status

1. Create or edit a SKU-location link, resolving SKU name/category/brand from SKU Master and validating SKU existence.
2. Search/filter links, open the hierarchy picker, reset, formerly request a Pending Report download, route Bulk Import to Common Import type 33, or checkbox-gate bulk-update matching links. Current downloads use the displayed rows.
3. Rule creation, Min-Max/Sales History fields, SKU sets, save/confirm/delete, execution enquiry, and ROS settings remain in the local code. Run and execution processing are disabled in the current checkout. The historical guide-derived workflow claims do not prove current end-to-end behavior.

## 3. Documentation-to-video discrepancy matrix

| Evidence item | Documentation | Video evidence | Resolution |
|---|---|---|---|
| Workflow recordings | Guide describes ARS screens and behavior | No ARS videos were supplied | Guide treated as sole authority; no video-level fidelity claim |
| Output Type count | Historical guide notes are internally inconsistent | No current authenticated evidence | Local currently contains `Confirmed`, `Pending`, and `Report`; this must be checked against LIVE before acceptance |
| Fulfilment terminology | Uses `Fulfilment`, `Fullfillment`, and `fulfilment warehouse` variants | SKU-Location LIVE uses `Fullfillment` | SKU-Location now follows LIVE; Rules remains unverified |
| Rules navigation | Narrative says Procurement > ARS; screenshots/breadcrumb context show Setup > ARS Rules | None | Menu remains under Procurement > Setup > ARS while editor breadcrumb preserves Setup wording |
| Frequency | Described as execution interval; screenshot examples show values such as 2 Hours/6 Hours | None | Stored as hours with Never, Hourly, Every 2 Hours, Daily and Weekly labels |
| Execution Log | Named as an ARS section | No fields or layout documented | Implemented only an evidence-supported audit grid; exact layout remains unverified |
| Bulk Import | Button/screenshot is shown | Authenticated handler opens `vendorImportDisplayBS?externalImportType=33` | Local routes to Common Import type 33; the earlier guessed CSV dialog was removed |

## 4. APIs, database, and data mappings

| API/data | Relationship |
|---|---|
| `GET/POST/PUT/DELETE /api/ars?entity=links` | `ars_sku_links`; validates against `skus`; carries SKU, location, vendor, fulfilment, lead-time, cover and ARS status |
| `GET/POST/PUT/DELETE /api/ars?entity=rules` | `ars_rules`; persists method, thresholds/ROS period, vendor/output type, date/status/frequency and SKU sets |
| `GET /api/ars?entity=logs` | `ars_execution_logs`; relates `rule_id` to generated PO codes |
| `GET/PUT /api/ars?entity=settings` | `ars_settings`; provides Enable ARS and selectable ROS periods |
| Shared `skus`, `inventory`, `vendors` | Rule execution resolves product, current stock, cost and the configured primary vendor |
| Shared `purchase_orders` | ARS execution creates normal PO records with `po_type: ARS`, `ars_rule_id`, line items, warehouse, status and expected date |

The development server uses the repository's existing in-memory fallback when `MONGODB_URI` is absent; the same handlers use MongoDB when configured.

## 5. Local validations and business rules

- SKU, Location and ARS Flag are mandatory; SKU must exist; duplicate SKU-location pairs are rejected.
- Lead time and stock-cover days must be non-negative.
- The remaining rule, execution, and settings bullets below describe current local behavior only; they are not evidence of LIVE parity.
- Rule Description, Method, Vendor Type, Output Type, Location, Start Date, Status, Frequency and at least one SKU Set are mandatory locally.
- End Date cannot precede Start Date; Min-Max maximum must exceed minimum; Sales History requires an enabled ROS period.
- Only Pending rules can be confirmed or deleted. Only Active, in-date rules can run.
- Global Enable ARS blocks execution when off.
- Min-Max replenishes to Maximum Quantity when stock is at/below Minimum Quantity.
- Output Type maps to PO status `Confirmed` or `Pending Confirmation`; fulfilment lead time maps to expected date.
- Run updates last/next-run dates and writes a PO-linked execution record. `Never` leaves Next Run blank.

## 6. Permissions and roles implemented

All ARS routes use the application's existing authenticated `ProtectedRoute`. The guide identifies a logged-in user but provides no role/action permission matrix, so no undocumented fine-grained roles were invented. Created/updated audit fields retain the signed-in demo/admin convention already used by the replica.

## 7. Current verified test evidence

- `npm run typecheck`: passed.
- `npm run build`: passed (Vite warns that Node 20.14 is below its preferred 20.19 and that the main bundle exceeds 500 kB).
- Historical rule/API tests may exercise the guide-derived local behavior, but they do not establish authenticated LIVE parity for Rules, Execution Log, or Settings.
- `npm run test:ars-sku-location` against a freshly restarted isolated server: passed. It verifies the live-named search request/response, exact grid, reset/advanced search, exact validation, add/edit/bulk persistence across reload, download-to-Pending-Report, Common Import type 33, pagination, console, and API status.
- Direct persistent handler verification for `addAndUpdateArsAttributes`, `fetchArsAttributes`, `bulkUpdateArsAttributes`, and `downloadArsAttribute`: passed.
- Post-fix authenticated LIVE/local comparison: toolbar order, visible grid columns, TAG ordering, fulfilment-method options, ARS options, and defaults matched.

### ARS Rules verification (2026-08-26)

- Authenticated LIVE enquiry inspection confirmed `Search`, `Reset`, `Add New`, `POST fetchArsRules`, 20/50/100/200 pagination, Location/Product Set selectors, eleven data columns plus hidden status, inline status/method/frequency/date filters, and clickable Rule ID edit navigation.
- Recursive LIVE editor inspection confirmed `Run Now`, `View Log`, `Save`, `Confirm`, `Add New`, multi-location picker, Min-Max versus Sales History conditional fields, exact ROS/vendor/output/status/frequency options, Day/Week/Odd-Even/Hour scheduling controls, SKU-set Include/Exclude selection dialog, 50-set cap, row view/delete actions, ARS Details and audit metadata.
- Observed contracts are represented locally: search payload/response, save/confirm state, execution scheduling/log navigation, inactive delete transition, exact validation order/messages, master-backed locations, nested SKU-set persistence, and reload/reopen behavior.
- `npm run test:ars-rules` passed against a freshly rebuilt isolated server. It verifies enquiry actions, exact options, initial validation, location and SKU-set dialogs, monthly schedule controls, create API, persistence across reload/reopen, console, and API health.
- Final `npm run typecheck` and `npm run build` passed. Build retained the environment warning that Node 20.14.0 is below Vite's preferred 20.19+ and the existing large-chunk warning.
- Second authenticated LIVE/local comparison passed for enquiry actions, Product Set options, pagination, editor actions, ARS method, vendor/output/status/frequency options, and nested Add SKU Set availability.

### ARS Execution Log verification (2026-08-26)

- Authenticated LIVE inspection confirmed preloaded `POST fetchExecutionLog`, Search/Reset, Rule ID and Execution ID pick lists, exact eight-column grid and option sets, 20/50/100/200 pagination, clickable Execution ID detail, Rule Name editor navigation, and clickable status detail.
- Recursive execution-detail inspection confirmed Search, Download, Approve All, Process All, Reset, Rule/Execution pickers, execution-summary/info dialogs, `fetchExecutionLogDetail`, `downloadExecutionLogDetail`, `approveAll`, `processExecDetail`, document links, and the visible Location/SKU/Vendor/Inventory/ARS Calc/ARS Approved/Status/Doc Generated projection.
- At that time, the local API persisted approve/process status changes and returned affected counts; Download used the Pending Report pipeline. Those local processing and report-job paths are disabled in the current checkout.
- `npm run test:ars-execution-log` passed against a freshly rebuilt isolated server in the historical run. The script has since been updated to assert that unverified approval and processing controls are unavailable; it has not been rerun against a signed-in tenant.
- Final typecheck/build and `git diff --check` passed. The mandatory second authenticated LIVE/local comparison passed for parent/detail actions, frequency/vendor/output/status options, and visible detail columns.

### B2B ARS/ROS Settings verification (2026-08-26)

- The authenticated `Admin > Settings` route was confirmed as `displayAdminSettings`; its ARS section was inspected from the exact authenticated HTML and `SettingBS.js?version=4.80` because direct top-level navigation redirects to the shell.
- LIVE controls are Save, Enable ARS, ROS Calculation Hour 0–23, PUF/TUF Round Up/Round Down, five standard ROS periods, and three independently enabled custom day periods.
- LIVE `saveARSSetting` posts enable state, standard/custom ROS flags and days, calculation hour and PUF/TUF. Validation requires enabled custom periods to have a value, days between 2 and 365, and at least two active ROS parameters when ARS is enabled. Exact messages and `Configuration updated Successfully` were reproduced.
- The signed-in ARS focus now verifies all 24 calculation hours, both PUF/TUF options, every standard and custom period control, three server-side validation failures without mutation, the browser validation messages, save/readback with authenticated actor and date, all custom periods including 2- and 365-day values, and reload persistence. It used the generated `codexqa_*` MongoDB database and was included in `npm run test:isolated-browser-workflow` with `ISOLATED_BROWSER_FOCUS=ars`; both generated databases were removed.
- Mandatory second comparison passed for section labels, hour and PUF/TUF options, five standard ROS toggles, and all three custom inputs/toggles. Typecheck/build passed after the implementation.
- No current authenticated-live verification claim is made for Rules, Execution Log, or Settings.

## 8. Remaining unverified scope

- No known guide-derived or generic ARS screen remains in the four-route ARS scope. Broader website verification continues module-by-module.
- The guide does not expose the Execution Log layout, import file format, permission matrix, pagination thresholds or complete error wording.
- Sales History uses the available stock-cover data as a conservative replenishment calculation. The source's historical sales dataset/ROS formula is not supplied.
- `Min Cost` and `Min Lead Time` are preserved rule values, but exact vendor selection cannot be reproduced without SKU-vendor price/lead-time alternatives from the source. Execution uses the SKU-location Primary Vendor.
- Frequency and next-run state are persisted, but no always-on background scheduler was introduced; Run Now is fully operational.
- Audit metadata is stored and displayed, but the guide does not document a full audit-history modal.

## 9. Exact files/components changed

- `api/ars.js` — dedicated ARS CRUD, lifecycle, execution and downstream PO API.
- `api/seed.js` — ARS links, rules, execution-log and settings seed relationships.
- `server.js` — `/api/ars` registration.
- `src/eretail/procurement/ARSWorkflows.tsx` — four dedicated ARS screens.
- `src/App.tsx` — dedicated ARS routes.
- `src/eretail/menuData.ts` — dedicated ARS navigation and typed menu icons.
- `scripts/verify-ars-api.mjs` — repeatable API/business-rule verification.
- `scripts/verify-ars-browser.py` — repeatable browser/UI verification.
- `docs/ARS_REPLICATION_EVIDENCE.md` — this evidence, discrepancy and completion report.
- `docs/PROCUREMENT_REPLICATION_EVIDENCE.md` — prior procurement inventory updated to point at the dedicated implementation.

Existing Master SKU and Tally components, routes and APIs were not modified.
