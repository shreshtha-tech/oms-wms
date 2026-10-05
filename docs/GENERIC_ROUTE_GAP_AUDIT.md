# Generic route and API gap audit

Audit date: 26 August 2026; current source and isolated voucher check refreshed 30 September 2026.

This is a local-code audit, not proof of LIVE behavior. The August sections
below are historical and must not be read as a current route map.

## Current generic behavior

`src/App.tsx` has no registered `GenericRoute` or `GenericModule`; its catch-all
redirects to `/`. The former voucher-condition and sales-representative menu
items have no destination and are disabled. The Admin log entries use the
dedicated Admin module routes. A generic API can still back a dedicated-looking
screen, so correct routing alone does not establish its business workflow.

| Active screen | Current generic behavior | Verified boundary / remaining gap |
|---|---|---|
| Generate Vouchers, `/app/m/vouchers` | Reads historical `generic_records` where `module=vouchers`. The former screen generated timestamp-based codes and reported success without an issuance/redemption service. | Signed-in isolated `npm run test:voucher-guard` passed: legacy read/search, disabled Generate, HTTP 501 for generic voucher create/edit/delete, unchanged MongoDB record. Real issuance, LIVE parity, and configured-tenant behavior remain open. |
| Manage Coupons, `/app/coupons` | The dedicated `/api/coupons` used to save `Active` coupon metadata with a literal `demo-admin` actor; no checkout eligibility or redemption consumer was found. The editor is removed and create/update/delete now return HTTP 501. | Signed-in isolated `npm run test:coupon-guard` passed: legacy enquiry/view, date filters, disabled Add New, rejected writes, and unchanged MongoDB record. Operational coupon issuance/redemption, configured-tenant behavior, and LIVE parity remain open. |
| Manage SKU Group, `/app/m/sku-group` | The dedicated API stores group rows in `generic_records` and validates Client, Master SKU membership, code and audit fields. Direct `/api/generic` could bypass those checks, and a read-then-insert duplicate check could race. | `/api/generic` rejects `sku-group` create/edit/delete and migration. A MongoDB partial unique index now enforces case-insensitive group codes; eight concurrent creates yielded one success and seven conflicts, with one stored row. `npm run test:sku-group` passed signed-in create/edit and MongoDB readback. Existing duplicate rows would block index creation; configured Atlas and LIVE parity remain open. |
| SKU Company Link, `/app/sku-company-link` | The dedicated API validates Company, Location, and Master SKU references but stored links in `generic_records`; direct generic writes could bypass validation. Concurrent Add/Remove requests used read-then-write counts. | `/api/generic` now blocks `sku-company-link` writes and module migration. A scoped MongoDB unique index keeps one link per company/location/SKU; delete counts come from actual deletions. Signed-in `npm run test:sku-company-link` passed eight concurrent Adds and eight Removes, with one stored link and one reported deletion. Existing duplicate links, configured Atlas and LIVE parity remain open. |
| Organization Hierarchy and Location, `/app/m/org-hierarchy`, `/app/m/location`, `/app/m/location-create` | Dedicated APIs store Company and Location references in `generic_records`; generic writes could bypass required fields, parent checks and location-code checks, corrupting downstream SKU Company Link lookups. The Location editor also offered fixture tags, a no-op Add Tags button, and a success-style Audit message without history. | `/api/generic` rejects create/edit/delete and module migration for `org-hierarchy` and `location`. A signed-in isolated run created references through the dedicated APIs, selected/reset the Company in the tree, searched and edited the Location in the browser, read the edit from MongoDB, and completed downstream SKU linking. Advance Search reveals the existing Location Tag filter; editor tag choices come from the Location API, while unsupported Add Tags/Audit controls are disabled. `npm run test:sku-company-link` passed. Configured Atlas, broader reference integrity and LIVE parity remain open. |
| Other Masters, `/app/m/other-masters` | The former UI offered 24 named catalogs but posted only code/name/status into `other-masters-*` generic rows and reported success. It now shows existing rows as legacy metadata and disables Save. | Signed-in isolated `npm run test:other-masters` passed: all 24 choices, legacy Brand readback, anonymous 401, HTTP 501 for generic create/edit/delete and module migration, unchanged MongoDB rows. Each catalog's actual fields, references, permissions, consumers, configured-tenant behavior, and LIVE parity remain open. |
| Promotion Enquiry and Sales Promotion, `/app/promotions` | The former screen merged six hardcoded 2018 rows with generic records and treated a generic status write as a confirmed promotion. It now reads only existing generic records, labels them legacy metadata, and disables creation/editing/confirmation. `/api/generic` rejects writes to `sales-promotion`, including edits/deletes of historical records. | Signed-in isolated `npm run test:sales-promotion-guard` passed: one MongoDB legacy row produced one enquiry row, Save/Confirm were disabled, generic POST/PUT/DELETE and module migration returned HTTP 501, and MongoDB records stayed unchanged. POS rule execution, discount calculation, eligibility, audit identity, approval, configured-tenant behavior, and LIVE parity remain unverified. |
| Master Order Enquiry and Global Order Search | Both active routes render `LiveOrderWorkspace` and use the same unified seller-order search as Order Enquiry and Sale Orders. | A signed generated Shopify fixture appeared in all four routes, but the distinct master-document and merchant/marketplace controls are absent from the active screens. Their LIVE workflow contracts and role scopes remain unverified. |

`src/eretail/masters/RecordedSkuWorkflows.tsx` still contains a dormant
`RecordedSkuImport` with generic history and a hardcoded uploader. The active
`/app/sku-import` route imports `SkuImport.tsx` instead. Attribute Set and both
Vendor SKU Catalog routes also use their dedicated components/APIs today.
The shared `generic_records` MongoDB collection is used by some dedicated
handlers; using that collection does not, by itself, mean a workflow is generic.

## Current change log and verification

| Files | Confirmed defect | Change | Verification |
|---|---|---|---|
| `src/eretail/masters/GenerateVouchers.tsx`, `api/generic.js`, `scripts/verify-voucher-guard.mjs` | Timestamp-based generic rows were reported as issued vouchers, with no redemption or uniqueness service. | Kept legacy reads, disabled issuance, and rejected voucher writes including edits/deletes of old rows. | `npm run test:generate-vouchers` passed with a real generated-admin session and MongoDB readback. |
| `src/eretail/masters/OtherMasters.tsx`, `api/generic.js`, `scripts/verify-other-masters.mjs` | Each of 24 distinct catalogs saved only generic code/name/status and reported success without catalog contracts. | Kept catalog navigation and legacy reads, disabled Save, and rejected generic catalog writes including module migration. | `npm run test:other-masters` passed with a real generated-admin session and MongoDB readback. |
| `src/eretail/masters/PromotionManagement.tsx`, `api/generic.js`, `scripts/verify-sales-promotion-guard.mjs` | Six fixture rows appeared as historical promotions; Save/Confirm wrote generic status with a hardcoded actor and claimed success without POS execution. | Removed fixtures and false count; retained legacy read-only enquiry/detail; disabled writes in UI and rejected direct generic writes, including module migration. | `npm run test:sales-promotion-guard` passed with generated administrator, disposable MongoDB/PostgreSQL, browser, API, and MongoDB readback; typecheck and build passed. |
| `package.json`, `scripts/verify-generate-vouchers.mjs`, `scripts/verify-other-masters.mjs`, `scripts/verify-isolated-browser-workflow.mjs` | Earlier browser scripts used assumed credentials and treated visible text or a generic POST as workflow success. | Routed both npm commands through disposable-database tests and retired the misleading direct voucher verifier. | Both focused npm commands passed; typecheck and production build passed under Node 20.14 with Vite's Node-version warning. |

## Historical 26 August route findings

### Corrected dedicated-route bypasses

The following menu items had dedicated components and routes but still pointed
to an older or generic route. Their navigation now targets the dedicated route:

- Manage Inbound Gate Pass
- Inbound Enquiry
- Inbound RealTime
- Inbound QC
- Inventory Move History
- Inventory Move
- Inventory Move By Scan
- Cycle Count
- BIN Audit
- Bulk update Lottables
- Location Create/Edit
- PutAway Enquiry
- Dispatch Checkpoint Enquiry
- Sku Grading
- Discrepancy Enquiry
- Bulk Upload
- MP Inventory Log
- LPN Enquiry
- Transhipment Old
- Transhipment
- QC Params Mapping

`npm run test:wms-dedicated-menu-routing` clicks each flyout item in a real
browser and asserts its final path. The dedicated workflow verifiers for all ten
WMS modules also pass independently.

### Menu items then resolved by `GenericRoute`

These were local implementation gaps in the August snapshot. The current
route/disabled state is recorded above; none establishes LIVE parity.

#### Master

- Manage Voucher Condition (`/app/m/voucher-condition`)
- Sales Representative (`/app/m/sales-rep`)

#### Admin logs

- User Audit Logs (`/app/m/user-audit-logs`)
- Accounting Log (`/app/m/accounting-log`)
- Tax Integration Log (`/app/m/tax-integration-log`)
- Device Tracking Log (`/app/m/device-tracking-log`)
- External Apps Logs (`/app/m/external-apps-logs`)
- POS Integration Log (`/app/m/pos-integration-log`)
- Repush Log (`/app/m/repush-log`)

### Dedicated-looking screens then backed by `/api/generic`

This August list is historical. The current active generic callers are in the
table above. Each listed workflow still needs contract-level LIVE comparison.

- SKU Import workflow in `src/pages/Skus.tsx`
- Generate Vouchers
- Attribute Set
- Vendor SKU Catalog
- Vendor SKU Location Catalog
- Other Masters
- Promotion Enquiry / Promotion Management

## Gate

Do not remove a generic implementation by guessing. For each item, first obtain
authenticated LIVE evidence for all reachable controls and nested workflows,
then replace the fallback with a dedicated component/API and run browser,
Playwright, typecheck, build, console/API/Vite, persistence, and second-LIVE
comparison gates.
