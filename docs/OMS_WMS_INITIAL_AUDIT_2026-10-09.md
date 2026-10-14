# OMS/WMS initial architecture audit

Date: 2026-10-09 (Asia/Kolkata). Status: **PARTIAL; production readiness NOT ESTABLISHED**.

## Scope and source of truth

This is a dated, source-backed initial audit of the checkout at /Users/shreshthagupta/AI-Workspaces/oms-wms. The checkout was renamed from its mounted Downloads path at the user's request. Git still identifies the same repository and branch. At audit time the branch is main, one commit ahead of origin/main, with extensive pre-existing tracked and untracked changes. This report does not attribute those changes to this audit.

The audit started in read-only mode. Fresh checks wrote only to /private/tmp. PostgreSQL integration verification stopped before application code because the environment denied shared-memory creation. No configured database, credential, provider account, production data, deployment, commit, or push was used.

The full semantic audit is incomplete. The source inventories and reports below are useful evidence, not proof that every route, query, screen, transaction, worker, and external failure mode was reviewed or exercised.

## Architecture observed

| Layer | Current implementation | Main boundaries |
|---|---|---|
| Browser | React 19, TypeScript, Vite 7 | Entry and route components are under src; Central Inventory has a separate API/UI path from older eRetail screens. |
| HTTP API | Node.js / Express 4 | server.js mounts legacy Mongo-backed route modules and private Central Inventory, health, webhook, and worker-related APIs. |
| Legacy application data | MongoDB Node driver 6 | Existing master, order, WMS, admin, and eRetail flows use Mongo collections through api modules. Shared login/session checks depend on PostgreSQL. |
| Central Inventory | PostgreSQL through pg 8 | inventory modules and additive SQL migrations own the central stock ledger, balances, reservations, mappings, outbox, alerts, and integration state. The ledger is the stock authority; Mongo records are not interchangeable with it. |
| Background work | Node worker and supervised service | scripts/inventory-worker.mjs and related worker modules poll durable work; separate paths exist for Amazon SQS and provider observation/publication. Local development and Render define different process arrangements. |
| Hosting | Render blueprint | render.yaml defines a web service, pre-deploy migration command, live health endpoint, and separate inventory worker. This is configuration evidence only; hosted deployment, readiness routing and rollback were not tested. |

The package declares Node ^22.12.0, ^24.0.0, or ^26.0.0. The installed runtime used for the fresh checks was Node 24.21.0. There are 29 SQL migration files under db/migrations. package.json exposes 236 scripts; the checked-in test catalog lists 161 test commands. Neither count is a coverage percentage.

## Data and workflow authority

The existing architecture records PostgreSQL Central Inventory as the authority for central stock and its ledger. It explicitly distinguishes Mongo-backed operational records from central inventory and calls out missing cross-store projections and contracts. The architecture inventory describes 66 Mongo collection names, 45 PostgreSQL tables, 42 ownership groups and 58 proposed event contracts; those are source inventories and design artifacts, not proof of runtime consumption or complete ownership.

Important flows already traced in repository reports include authenticated API requests, Mongo-backed legacy screens, central stock adjustments and reservations, Shopify/Woo/Amazon order intake, durable PostgreSQL work, provider publication/readback, WhatsApp alerts, and the Mongo-to-PostgreSQL receipt bridge. The reports identify unresolved ownership, tenant/object authorization, event recovery, provider authority, backlog fairness, full WMS fulfillment, and cross-database consistency.

The Phase B evidence document records an implemented two-event receipt bridge and scoped dispatch safeguards. It also says latency percentiles, owner-approved D11 workload/recovery targets, hosted provider evidence, disaster recovery, restore and Phase C exit are outstanding. Its explicit review boundary says not to start Phase C before those targets and evidence are resolved.

## Current evidence and principal gaps

The fresh baseline and subsequent focused outcomes are in [INITIAL_TEST_REPORT_2026-10-09.md](INITIAL_TEST_REPORT_2026-10-09.md). TypeScript type checking, an isolated-output Vite production build, git whitespace checking, tenant middleware, summary/balance boundaries, SQS poison isolation, offline isolated-store guards, inbound CSV integrity, and publication recovery/status/lock-cleanup/worker-loop boundaries passed. Owned PostgreSQL/Mongo integration did not run: the harness could not initialize PostgreSQL because shmget returned Operation not permitted; the Mongo boundary harness separately failed during owned daemon startup; the Phase B DB suites refused to run without explicit isolated loopback `_test` settings. Application integration coverage remains incomplete.

Current source shows GET /balances delegates to inventory/balance-read.js, applies a 10,000-row / 8 MiB response budget and returns a result-limit error; the older observation of a full unbounded balances read is stale for that route. The focused helper boundary script passes with injected query results, proving its tenant predicate, SQL row limit, byte-limit rejection and query-error propagation, but it does not exercise Express against PostgreSQL. By contrast, inventory/read-model.js still selects the full tenant product/location/account/alert/mapping model, and inventory/exports.js reads that overview before selected-SKU filtering; it also reads tenant balances before applying the selected-product filter in memory. The Central Inventory export builders consume products and balances, so the other overview collections are unnecessary for export, but any query split or SQL-side filtering needs isolated PostgreSQL parity and transaction-snapshot evidence. The UI uses the complete overview for local search, filters and paging, so applying limits there without an API/UI contract change could hide matches. The materialization/export cost remains a source-backed review item, not a measured production bottleneck. The separate delimited-export and legacy report-export scripts pass, but neither covers the Central Inventory XLSX/PDF SQL path.

The endpoint security report traces 159 literal mounted paths to 138 handlers and 831 direct collection-reference candidates. It explicitly leaves role authorization, object ownership and tenant isolation unproven. A route inventory is not an attack campaign.

## Newly traced authorization finding: import preview and export

The `/api` mount authenticates a session before `inventoryPrivate` is mounted (`server.js:210-215`). The permission registry currently defines catalog/count *write* and selected opening-stock permissions, but no catalog/count/inventory read permission (`api/auth-session.js:20-33`). In `inventory/files-api.js:82-87`, `/imports/preview` has no operation-specific permission middleware; its delegated `previewWorkbook` reads all tenant SKUs, locations and balances, returns up to 100 rows including `previousOnHand` for counts, and inserts a `ci_import_batch` (`inventory/workbook.js:115-145`). `/export` at `inventory/files-api.js:99-105` likewise has session and tenant boundaries but no operation-specific permission check before returning inventory XLSX/PDF. Commit does enforce mode-specific write permission (`inventory/files-api.js:89-96`).

This is a source-confirmed operation-authorization gap, not a demonstrated exploit or proof that current product policy intends narrower access. A separate read permission does not exist, and changing the API/UI authorization contract without the owner-defined role policy could break intended workflows. Required next evidence: decide which roles may inspect/preview count balances, preview or write catalog batches, and export stock; add anonymous/wrong-role tests plus maximum-cost request tests; then validate the mounted HTTP behavior and current UI under an owned isolated stack. Keep this at **POLICY REQUIRED / RUNTIME NOT VERIFIED** until those steps are complete.

## Workbook inspection resource boundary

The structural inspection path accepts a 7 MiB base64-decoded upload at the HTTP handler and passes it to ExcelJS for a full workbook load before traversing worksheet rows/cells (`inventory/files-api.js:19-26`, `inventory/workbook-inspector.js:47-96`). The inspector bounds only returned formula/duplicate examples; it stores a SHA-256 signature for each unique non-header row and returns worksheet/column/merge metadata without aggregate row/cell/worksheet/output caps. The regular stock parser's 50,000-row check occurs after ExcelJS loads the workbook; it does not protect structural inspection.

A synthetic 50,002-row workbook measured 830,101 compressed bytes, approximately 456 ms inside `inspectInventoryWorkbook`, 458 MiB maximum RSS and 255 MiB final Node heap. The RSS covers workbook generation plus inspection in one process, so it is not an isolated parser peak or a workload target. It is reproducible evidence that compressed size alone is not a sufficient memory bound for this fixture. No adversarial ZIP bomb or hosted concurrency test ran. `node scripts/verify-workbook-inspector.mjs` reached its local HTTP-server setup only after its in-process parser assertions, then failed with `listen EPERM` before handler assertions; classify HTTP verifier **NOT RUN** in this sandbox.

Prioritize ZIP central-directory validation with entry count, per-entry/aggregate expanded byte and compression-ratio budgets; cap worksheets, dimensions, populated cells, strings, merges and serialized response; then keep the row signature cache within an explicit budget or remove full-row duplicate detection for inspection. Use an owned offline corpus including highly-compressible large XML and malformed archives; prove early rejection without large allocation, valid-workbook compatibility, redaction and stable handler errors. The existing transitive ZIP packages are not direct declared dependencies; any implementation must use an explicit supported dependency path and lockfile review. Production/hosted resource limits remain unverified.

## Inbound CSV duplicate-header repair

The inbound CSV parser previously passed `columns: true` to `csv-parse`; repeated headers silently overwrote earlier fields. Reproduction: `sku_code,qty,qty` with `SKU-X,1,999` produced `qty: "999"` and proceeded toward PO-line validation. `src/lib/inboundCsv.ts` now normalizes header whitespace and case for a uniqueness check and rejects duplicates before producing row objects. A second reproduction found `qty=0x10` was converted by the UI with `Number()` to 16 and accepted as an inbound import row. The parser now rejects nonnegative safe-integer spellings outside decimal notation, including hex, binary and exponent forms; conventional digit strings, optional leading `+`, and integral decimal forms such as `16.0` remain supported. Negative and fractional values retain the existing row-level validation path. These guards, duplicate-header rejection, valid quoted/BOM parsing and pre-read byte, UTF-8, row and record limits are covered. Changes affect only browser parsing; no inventory write or backend receipt rule changed.

Validation: `node scripts/verify-inbound-csv-boundary.mjs` **PASS**; `./node_modules/.bin/tsc --noEmit -p tsconfig.app.json` **PASS**; Vite production build with runner config loader to `/private/tmp/oms-wms-inbound-csv-final-20261009` **PASS** (1,953 modules); `git diff --check` **PASS**. The prior unsafe value was confirmed with the actual helper plus the authenticated handler in explicit in-memory Mongo mode; the fixed helper regression proves these ambiguous integer lexemes reject before UI numeric conversion. No browser UI or database-backed receipt workflow was exercised as part of this fix.

## PO receipt admission now includes staged receipts

Source review found that both inbound routes validate remaining PO quantity by scanning confirmed GRNs, while the Mongo receipt-bridge transaction independently fenced PO amendments but counted only confirmed, noncommitted history. A second receipt staged while an earlier Central Inventory receipt was still pending could therefore receive HTTP 202 and later be held by the PostgreSQL cumulative ledger check. The ledger path already serializes by tenant/PO and prevents excess stock; the gap was avoidable staged work and operator-held requests, not demonstrated stock overshoot.

`inventory/receipt-bridge.js` now reads confirmed GRNs and `central_receipt_status='pending'` GRNs inside the PO-fenced Mongo transaction. Admission compares against all prior confirmed/staged quantities. The event authorization's `legacy_received` remains limited to non-ledgered confirmed receipts, so PostgreSQL does not double-count pending/committed Central Inventory movements. `scripts/verify-phase-b-propagation.mjs` now races both inbound routes against a five-unit PO using four- and two-unit requests and asserts exactly one is queued; the competing request must conflict without creating an outbox command.

Validation: `node --check inventory/receipt-bridge.js` **PASS**; `node --check scripts/verify-phase-b-propagation.mjs` **PASS**; `node scripts/verify-phase-b-guard.mjs`, `node scripts/verify-inbound-import-inputs.mjs`, `node scripts/verify-inbound-csv-boundary.mjs`, TypeScript typecheck and `git diff --check` **PASS**. The updated `node scripts/run-phase-b-isolated.mjs scripts/verify-phase-b-propagation.mjs` is **NOT RUN**: disposable PostgreSQL initialization failed and its harness reported cleanup before application assertions. Mongo/PG transaction serialization and the new concurrency regression remain unverified in this environment. No configured DB or provider was contacted and the Central Inventory ledger writer was not changed.

## Existing documentation mapped to the requested artifacts

| Requested artifact | Existing or new location | State |
|---|---|---|
| Architecture audit | This report; docs/PRODUCTION_SYSTEM_AUDIT.md | Initial architecture described; exhaustive semantic review remains incomplete. |
| Module dependency map | docs/reliability/dependency-map.json; docs/architecture/ownership-matrix.csv; docs/architecture/storage-inventory.md | Static inventories; runtime action and completeness remain separately unverified. |
| Industry reference analysis | docs/INDUSTRY_REFERENCE_ANALYSIS.md | Initial comparison of four maintained reference repositories; no code copied. |
| Implementation roadmap | docs/IMPLEMENTATION_ROADMAP.md | Prioritized, gated work with acceptance evidence and risks. |
| Security findings | docs/API_SECURITY_MATRIX.md; docs/PRODUCTION_SECURITY_HARDENING_REPORT.md; docs/reliability/security-boundary-matrix.json | Interim source findings; production security gates remain blocked. |
| Test coverage report | docs/INITIAL_TEST_REPORT_2026-10-09.md; docs/reliability/test-catalog.json; docs/reliability/test-execution-status.json | Current narrow baseline plus historical catalog; not a coverage percentage or full regression pass. |
| Validation report | docs/INITIAL_TEST_REPORT_2026-10-09.md and dated reliability reports | Fresh checks are explicitly separated from tests that could not run. |
| Production readiness | docs/PRODUCTION_HARDENING_RELEASE_GATE.md | Release remains blocked; no production-ready claim is supported. |

The existing dated reports contain historical checkpoints and should be read with their dates. This audit does not silently refresh historical PASS results or convert them into current evidence.

## Initial conclusion

The project has a substantial React/TypeScript and Express application, a separate PostgreSQL Central Inventory ledger, Mongo-backed legacy workflows, and durable worker/provider integrations. The architecture and reliability work is far along in design and selected isolated paths, but the evidence does not establish complete workflow correctness, security, configured-provider behavior, representative capacity, disaster recovery, deployment safety, or production readiness.

Continue the requirement-by-requirement audit. Preserve the existing worktree. Do not make a production-readiness claim based on this initial baseline.
