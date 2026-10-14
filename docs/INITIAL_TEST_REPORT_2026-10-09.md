# Initial test and validation report

Date: 2026-10-09 (Asia/Kolkata). Checkout: /Users/shreshthagupta/AI-Workspaces/oms-wms. This records fresh checks only; historical results are kept in their original reports.

## Fresh checks

| Check | Result | Evidence boundary |
|---|---|---|
| Node runtime | PASS: v24.21.0 | Within package.json's declared Node 24 range. |
| TypeScript | PASS: ./node_modules/.bin/tsc --noEmit -p tsconfig.app.json | Frontend application type check; does not exercise server/database behavior. |
| Vite production build | PASS: ./node_modules/.bin/vite build --configLoader runner --outDir /private/tmp/oms-wms-baseline-20261009 --emptyOutDir | 1,953 modules transformed; output stayed in /private/tmp. Existing chunk warning: exceljs.min is about 937 kB (271 kB gzip). |
| Git whitespace | PASS: git diff --check | Checks tracked diff whitespace only; it is not a code-quality or correctness test. |
| Isolated target guard | PASS: node scripts/verify-phase-b-guard.mjs | Pure configuration guard rejects non-loopback, SRV, wrong _test database, TLS and connection override targets. It does not connect to a store. |
| Phase B disposable integration stack | FAIL before application tests | node scripts/run-phase-b-isolated.mjs stopped at initdb. A separate fresh temporary initdb probe identified shmget(...): Operation not permitted. The harness reported cleanup of its owned temporary stack; the application suite did not start. |
| Direct Central Inventory integration scripts | NOT RUN | Reviewed scripts import env.js, run migrations and require INVENTORY_DATABASE_URL; they are not safe to point at unknown configured stores. The README describes isolated testing, but these direct scripts do not all create and validate their own disposable stack. |
| Browser workflows, configured databases, providers, load, staging, restore and deployment | NOT RUN | No claim about these environments is made. |

A default Vite build attempt initially failed before compilation because Vite tried to write its temporary config bundle under read-only node_modules/.vite-temp. Running the same build with Vite's runner config loader avoided that project write and passed using an output directory in /private/tmp. No project build output was generated.

The integration failure is an environment-level test blocker, not an application test failure. The direct probe and disposable harness use temporary test directories only. No shared-memory restriction was bypassed.

## Existing test inventory

package.json currently declares 236 scripts. docs/reliability/test-catalog.json has 161 test-command entries. docs/reliability/test-execution-status.json is dated 2026-10-04 and records 54 PASS plus 107 NOT INDEPENDENTLY VERIFIED across its then-current catalog. These numbers are inventory/status metadata; they are not statement, branch, or workflow coverage and were not rerun wholesale here.

Existing reports document selected Central Inventory, Mongo, PostgreSQL, provider, webhook, workbook, browser and receipt-bridge checks. Each result remains bounded by its report date and stated fixture. Real provider behavior and hosted outcomes remain separate from synthetic fixtures.

## Next verification needed

1. Restore a policy-approved disposable PostgreSQL/Mongo test environment that can initialize without violating the current sandbox; rerun only harnesses that prove unique loopback _test targets and clean up their own processes/data.
2. Add fresh regression evidence for bounded GET /balances and selected-SKU export behavior using the current code and a disposable PostgreSQL store.
3. Run role, object ownership and cross-tenant negative HTTP tests once operation policy and test identities are defined.
4. Execute the relevant browser workflows against a fresh isolated stack.
5. Keep provider, hosted, load, backup/restore and deployment acceptance marked NOT RUN until each is run against its authorized environment.

Do not treat a build, source scanner, test catalog, or failed-to-start integration harness as a passing end-to-end test.

## Additional focused offline checks

| Check | Result | Evidence boundary |
|---|---|---|
| node scripts/verify-sku-import-provenance.mjs | PASS | Explicit in-memory Mongo mode; disconnected import returned HTTP 501, created no processed-history row and changed no SKU row. No database connection or provider call. |
| node scripts/verify-balance-read-boundary.mjs | PASS | Injected query verifies tenant predicate, 10,001-row SQL limit, complete 10,000-row result, byte-limit rejection and preservation of query failures. It does not run PostgreSQL. |
| node scripts/verify-api-outcome-boundary.mjs | PASS | Injected transport verifies mutation response loss/timeout/malformed success remain unknown, no blind retry, explicit conflict, read retry and in-flight dedupe. |
| node scripts/verify-validation-master-inputs.mjs | PASS | Explicit memory fixture rejects malformed default flags and identities without record changes; valid update is retained. No configured-store connection. |
| node scripts/verify-terms-html-sanitizer.mjs | NOT RUN — browser unavailable | Playwright launched the configured Chrome binary, which exited with SIGABRT before page setup/assertions; the managed environment denied process termination (EPERM), and Chrome exited. No XSS sanitizer assertion ran. Do not claim browser sanitizer evidence from this attempt. |

The balance regression confirms the current helper's defensive boundary but does not supersede the need to test the actual route against PostgreSQL. The HTML sanitizer source and historical reports remain useful leads, not a fresh browser verification.

| Check | Result | Evidence boundary |
|---|---|---|
| node scripts/verify-delimited-export-boundary.mjs | PASS | Formula-safe CSV/TXT values, escaped headers, embedded separator/newline quoting, numeric preservation and HTML escaping. Spreadsheet-client behavior is outside this check. |
| node scripts/verify-exports.mjs | PASS | Legacy report-export API refuses fake success and historical content disclosure. Uses explicit in-memory Mongo fixture; this is not Central Inventory XLSX/PDF export coverage. |

Central Inventory's export SQL path, PostgreSQL snapshot parity and query plans remain NOT RUN because the owned PostgreSQL harness could not initialize in this environment. The source/UI trace is documented in the initial audit; no SQL or UI contract change was made.

| Check | Result | Evidence boundary |
|---|---|---|
| node scripts/verify-inventory-summary-boundary.mjs | PASS | Injected query confirms one aggregate statement, response shape and rejection of unsafe totals/missing rows; SQL semantics still require owned-PostgreSQL parity. |

A synthetic 10,000-row helper fixture serialized to 1,798,891 UTF-8 bytes, below the current 8 MiB helper budget. This is a fixture measurement, not a representative database result or a capacity target; no budget was changed.


## Additional current boundary checks

| Check | Result | Evidence boundary |
|---|---|---|
| node scripts/verify-inventory-tenant-middleware.mjs | PASS | Rejects malformed/foreign tenant input, prefers configured tenant and fails closed without configuration. Middleware-level test only; it is not full cross-tenant route coverage. |
| node scripts/verify-owned-mongo-boundaries.mjs | NOT RUN — disposable Mongo startup failed | The script reported owned-process cleanup and failed before application assertions. No configured Mongo store was used. |
| node scripts/verify-phase-b-propagation.mjs | NOT RUN — isolation configuration missing | Harness guard refused to run because the process did not have explicit `NODE_ENV=test`, matching `*_test` DB names and loopback store URLs. No store was contacted. |
| node scripts/verify-phase-b-dispatch.mjs | NOT RUN — not invoked | This requires the same guarded disposable PostgreSQL/Mongo stack; no connection configuration was guessed. |
| node scripts/verify-phase-b-sqs.mjs | PASS | Injected synthetic queue client proves poison isolation and acknowledges only the durably accepted fixture message. No AWS call. |
| node scripts/verify-phase-b-guard.mjs | PASS | Pure guard rejects non-loopback, SRV, mismatched DB, connection override and non-test targets. No store connection. |

Phase B exit evidence remains incomplete. The Phase B database integration scripts were not run against any store in this audit session; their prior dated evidence remains historical and separately bounded.

| Check | Result | Evidence boundary |
|---|---|---|
| `node scripts/verify-workbook-inspector.mjs` | NOT RUN — HTTP listener denied | In-process workbook/parser assertions ran before `listen(127.0.0.1)` failed with EPERM; the handler HTTP assertions did not execute to completion. Do not count the full script as PASS. |
| Direct synthetic `inspectInventoryWorkbook` measurement | PASS — fixture processed | 50,002 rows, 830,101 compressed bytes, about 456 ms inspection, 458 MiB process max RSS and 255 MiB final heap. Peak includes workbook generation plus inspection; not an isolated parser measurement or capacity target. |

## Inbound CSV integrity regression

`node scripts/verify-inbound-csv-boundary.mjs` **PASS** after repairing duplicate-header ambiguity and JavaScript alternate-number-notation acceptance in `src/lib/inboundCsv.ts`. Duplicate `qty` can no longer overwrite another value, and `0x10`, `0b10` and `1e2` reject before UI conversion; decimal whole values and existing negative/fraction row-level handling retain their behavior. Valid 1/200-row imports, 201-row rejection, record and byte bounds, quoted BOM input, malformed CSV, empty input and required-header behavior remain covered. `tsc --noEmit -p tsconfig.app.json` **PASS**. Vite production build **PASS** to `/private/tmp/oms-wms-inbound-csv-final-20261009`, 1,953 modules. This is browser parser/helper evidence only; mounted PO authorization and save/confirm persistence remain separate.

## Stock publication recovery boundary checks

| Check | Result | Evidence boundary |
|---|---|---|
| `node scripts/verify-publication-recovery-boundary.mjs` | PASS | Invalid worker batch sizes reject before DB access; injected DB asserts bounded tenant-scoped expired-publication SQL and unknown/readback-pending projections, including target quantity zero. No PostgreSQL connection. |
| `node scripts/verify-publication-status-error.mjs` | PASS | Schema, timeout, dependency and generic failures map to sanitized responses without SQL detail. Pure function test. |
| `node scripts/verify-stock-lock-cleanup.mjs` | PASS | Injected client/query failures verify advisory-lock release reuse vs client discard and preservation of primary outcome. No live concurrent PG lock test. |
| `node scripts/verify-worker-console-boundary.mjs` | PASS | Isolated worker-loop stubs verify console containment and single-flight scheduling when a job stalls. No production worker/service test. |

These boundary checks do not replace `verify-publication-recovery-postgres.mjs` or the provider mutation/readback tests. PostgreSQL concurrency/transaction outcomes and real-provider effects remain NOT RUN in this audit session; previously dated isolated Phase B results retain their original scope.

## PO pending-receipt admission change

The Mongo receipt-bridge staging transaction now includes already-pending Central Inventory receipts in its PO remaining-quantity check while keeping `legacy_received` separate for PostgreSQL validation. A new two-route concurrent regression is present in `scripts/verify-phase-b-propagation.mjs`.

- `node --check inventory/receipt-bridge.js`: **PASS**
- `node --check scripts/verify-phase-b-propagation.mjs`: **PASS**
- `node scripts/verify-phase-b-guard.mjs`: **PASS**
- `node scripts/verify-inbound-import-inputs.mjs`: **PASS** (explicit memory fixture)
- `node scripts/run-phase-b-isolated.mjs scripts/verify-phase-b-propagation.mjs`: **NOT RUN** — disposable PostgreSQL initialization failed; the harness reported its owned stack removed before application tests began.

No application integration assertion or database semantics claim is made for this change until that disposable Mongo/PostgreSQL test can run.

## Returns legacy mutation boundary

An explicit-memory reproduction showed untyped `/api/returns` POST accepted a phantom SKU/unrelated order with caller-selected `Shipped` status, and PUT rewrote the same record to `Refunded` with arbitrary fields. The only in-repository callers of `/api/returns` are dashboard/report reads; typed customer/vendor mutation screens use dedicated editor endpoints. The untyped POST/PUT/DELETE fallbacks now return HTTP 501 without changing records. The typed flows and fail-closed physical receipt/refund/shipment behavior remain intact.

`node scripts/verify-returns-integrity.mjs` **PASS**: verifies no untyped create/update/delete mutation, no unsupported physical action, and unchanged stock, transaction and adjustment fixtures. `node --check api/returns.js`, `node --check scripts/verify-returns-integrity.mjs`, `tsc --noEmit -p tsconfig.app.json` and `git diff --check` **PASS**. This is explicit in-memory handler evidence; authenticated role/object ownership, configured Mongo persistence and browser parity remain unverified.

## Fresh continuation checks — 2026-10-09

| Command | Result | Scope and limitation |
|---|---|---|
| `node scripts/verify-returns-integrity.mjs` | PASS | Explicit in-memory typed-flow and no-mutation regression; no configured Mongo. |
| `node scripts/verify-sku-import-provenance.mjs` | PASS | Explicit empty-memory fixture rejects claimed client-side success with 501 and writes no history/SKU rows. This route remains unavailable until a real processor is implemented. |
| `node scripts/verify-browser-csv-boundary.mjs` | PASS | Shared browser CSV serializer guards formula injection and row/column/UTF-8 limits across seven inspected exports. No browser execution. |
| `node scripts/verify-terms-html-sanitizer.mjs` | NOT RUN — browser startup failed | Chrome exited with SIGABRT during Playwright launch; process cleanup returned EPERM before page setup or sanitizer assertions. Do not count the browser security test as passing in this environment. |
| `npm run lint` | FAIL — 1,439 errors, 36 warnings | Whole-project ESLint command currently fails widely (including `no-explicit-any`, React Fast Refresh, and React hook rules). No baseline comparison was available to attribute findings to this continuation; lint is not a release gate pass. |
| `./node_modules/.bin/tsc --noEmit -p tsconfig.app.json` | PASS | Application TypeScript check. |
| `git diff --check` | PASS | Current worktree whitespace check. |

Source review of `src/lib/reportPrint.ts` confirms report title, filters, headers and cell values are HTML-escaped before `document.write`; this source inspection is not a substitute for browser security tests. Configured Mongo/PostgreSQL, provider, hosted and production-write checks remain NOT RUN.

## SKU import follow-up — route fixture versus active UI

The earlier `verify-sku-import-provenance.mjs` PASS is route-local: it invokes `/api/sku-imports` directly and proves that the disconnected endpoint rejects claimed success without changing SKU/history rows. Current UI trace shows `/app/sku-import` sends per-row `/api/skus` writes before calling that endpoint, so this test does not establish that the complete browser workflow is mutation-free. This continuation reproduced the provenance fixture PASS and found `verify-sku-import-integrity.mjs` FAIL at its first outdated expectation (`501` observed, `400` expected); later `201` assertions were not reached. The browser verifier expecting 201 was NOT RUN because it sends mutations to a separately running API, does not prove that server uses its separately configured `codexqa_*` Mongo target, and has no fixture cleanup. No configured DB or browser service was contacted. See the [SKU import source trace](industry/source-analysis.md#sku-createupdate-import-workflow-trace) and [test strategy](industry/test-strategy.md#sku-import-source-test-contract-and-isolation-gap).
