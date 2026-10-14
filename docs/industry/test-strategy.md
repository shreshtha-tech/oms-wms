# Test strategy and evidence boundaries

Inspection date: 2026-10-09 (Asia/Kolkata). Status: **IN PROGRESS**. Research/reporting only.

Preserve [initial test report](../INITIAL_TEST_REPORT_2026-10-09.md). Its typecheck/build/offline PASS, lint FAIL and database/browser startup blockers were not rerun here. Tests described below are proposed, not passing results.

| Layer | Required evidence | Isolation / limitation |
|---|---|---|
| Pure validation | Quantity/schema/identity/replay conflict and CSV boundary corpus | No configured store/provider; mirror neither implementation nor only happy path |
| PostgreSQL ledger | Competing reservations, lock ordering, rollback, overflow, cancellation identity, unique replay | Fresh owned loopback *_test PG; direct scripts must prove target before imports/migrations |
| Mongo transaction | SKU batch rollback, concurrent uniqueness, receipt staging/lease retries | Fresh owned loopback replica set *_test; no Atlas/configured DB fallback |
| Cross-store recovery | Crash before/after each Mongo/PG commit and ack, changed payload, sequence gap, expiry/fencing | Real owned stores; injected query tests alone cannot establish transaction semantics |
| Authenticated HTTP | Role/object/tenant/warehouse negative cases plus allowed controls | Explicit test identities/policy; inspect persisted effects and disclosures |
| Session lifecycle | Login reauthentication/rotation, inactivity and absolute timeout, logout replay, account removal/hash change, cookie flags | Fresh owned PG plus HTTP fixture; document whether parallel sessions and administrator revocation are supported; verify proxy/TLS settings without production credentials |
| Browser | Import cancel/timeout lookup, disabled/unknown/review states, accessibility keyboard/focus and sanitizer | Browser startup is prerequisite; build success is insufficient |
| Provider contracts | Pagination, categories, all SKUs, throttling, malformed responses, replay and lost acknowledgements | Fixtures first; live read-only separately authorized; no real external writes |
| Deployment/recovery | Migration from prior schema, failed migration recovery, health routing, worker restart, restore/parity | Dedicated staging/disposable environment; no production deployment |
| Supply-chain/CI | Clean lockfile install, lint baseline, dependency/license/advisory inventory | Explain scanner scope and don't disable failures |

Every result records exact command, date, commit plus dirty-file hashes, environment/fixture, assertions actually reached and PASS/FAIL/NOT RUN. Environment startup failure before assertions is not an application test failure or PASS. Upstream test code is design evidence only unless actually executed. No coverage percentage can be derived from script counts.

## Enterprise invariant coverage map

The ten invariants in [baseline](baseline.md#ten-business-invariants) remain open at different evidence levels:

- **Bounded PASS:** signed Shopify/WooCommerce delivery, identical replay, changed-body conflict, selected tenant/account denial and transaction rollback passed on disposable PG/HTTP. This supports portions of invariants 3, 6 and 7 for those ingress paths only.
- **Source controls, not closure:** central ledger constraints/locking, selected provider cancellation guards, immutable event identity, worker leases/fencing and durable uncertainty mechanisms support design claims for invariants 1–5 and 7–9; source inspection alone does not prove runtime behavior.
- **Fixture-only PASS:** Flipkart pagination/category/checkpoint behavior, both orderDate and cancellationDate filters, uppercase cancellation mapping and SQS accept-before-delete ordering were exercised with injected clients/stores. Neither proves configured provider access or database durability. Generic non-cancellation status updates to old orders and seller history completeness remain untested.
- **NOT RUN / incomplete:** competing reservation concurrency, full cancellation rollback/replay, Amazon PostgreSQL lifecycle, Mongo/PostgreSQL crash matrix, all-route warehouse/tenant authorization, migration failure recovery, worker restart/fencing, backup/restore/parity, hosted behavior and independent provider reconciliation.

Do not report an invariant as passed by combining unrelated fixture tests. Closure requires a requirement-matched test with explicit store/provider boundary and reached assertions; see the per-invariant acceptance details in the baseline table.

## SKU import source/test contract and isolation gap

The active UI route has no matching passing end-to-end proof for its current 501 behavior. Fresh bounded runs this turn:

- `node scripts/verify-sku-import-provenance.mjs` **PASS**: explicit in-memory fixture; valid metadata plus caller-claimed success is rejected with 501, no import history is written and SKU rows are unchanged. This tests the import endpoint in isolation, not the preceding browser `/api/skus` loop.
- `env -u MONGODB_URI -u MONGODB_DB node scripts/verify-sku-import-integrity.mjs` **FAIL**, exit 1 at line 17: expected 400 for a claimed zero-success import, received 501. Later assertions expecting a 201 history write were not reached. The verifier's contract is stale relative to the current route's fail-closed implementation; its name/output cannot be treated as passing evidence.
- `npm run test:sku-import` **NOT RUN**. Its `verify-sku-import.mjs` source expects HTTP 201, a committed import history and successful SKU mutation, which contradicts the current 501. It also sends writes to a separately running base URL while connecting directly to a Mongo database from its own environment; it does not prove those two targets are the same and has no cleanup for the inserted Attribute Set/SKU/history. Do not run it until a guarded harness launches the app against the same unique disposable Mongo replica-set DB, verifies target identity before imports, and cleans all state.

The two explicit memory fixtures themselves print the configured development database name as a warning when `MONGODB_DB` is unset; `api/mongo.js` selects memory mode because no URI is present. No Mongo URI, browser server, external provider or configured business database was contacted in these runs. The regression gap is the end-to-end current user flow: prove the UI stops before row writes while unavailable, or—after a separately authorized processor exists—prove server-owned validation, atomic/recoverable effects and truthful history.

Acceptance of an improvement requires tests at its behavior scope, inspected final diff and updated evidence; broaden tests only for new changes/failures/unresolved concerns. Existing configured databases and credentials are not available test fixtures.

## Fresh offline result

2026-10-09: node scripts/verify-postgres-transaction-cleanup.mjs **PASS**. Reviewed test source first: it injects clients/pools, exercises cleanup failures, uncertain COMMIT and definitive constraint errors, and checks sanitized HTTP projection. No PostgreSQL connection, provider call or configured-store import. This does not satisfy actual crash/restore/transaction integration requirements.

Frontend candidate: adapt Radix dialog focus/Escape test cases to the existing shared Modal; automated axe checks plus manual Tab/Shift+Tab, focus restoration, nested-modal and unmount cases. Effort small/medium; benefit usable accessible workflows; risk medium if replacing shared components; acceptance keyboard behavior is verified on representative callers with no visual/interaction regression. Avoid global component replacement before callers are inventoried and the scoped change authorized.


## Fresh SQS result and recommended queue regressions

`node scripts/verify-phase-b-sqs.mjs` **PASS**, rerun 2026-10-09 on Node 24.21.0. Test source reviewed before execution: synthetic queue client and injected accept callback, no AWS or PostgreSQL connection. Malformed first message and rejected third message remain unacknowledged; valid second message is acknowledged and processing continues after both failures. The script message says durably accepted, but its callback does not persist anything: this test proves per-message poison isolation and accept-before-delete ordering only. Current `acceptAmazonNotification` source separately writes ingress identity/hash and outbox in a PostgreSQL transaction; that DB boundary was not exercised by this fixture.

Next meaningful queue tests: exhausted-attempt lease recovery grants no ninth execution; stale claimant cannot acknowledge a newer attempt; crash after ledger commit before task ack replays safely; unknown remote mutation is held pending readback; delayed retry and pending tasks make progress under sustained backlog. Medium effort; compatibility existing Node/PG harness; risk low for tests; acceptance verified store effects/claims and operator states on owned PG. pg-boss retry tests provide case ideas, not local PASS evidence.


## Fresh Mongo session boundary check

2026-10-09: `node scripts/verify-mongo-session-boundary.mjs` **PASS**, exit 0. Source reviewed before execution. Injected sessions/cursors verify cleanup preserves committed results and primary errors, deadline options, unknown-commit classification, inherited read deadlines and truthful 503 response. The script clears Mongo connection configuration before its API import; no configured database operation is exercised. It does not simulate driver callback retries or prove transaction rollback, failover, majority durability, replica-set behavior or recovery. Those remain **NOT RUN**. Cleanup-failure logs are deliberate fixture outputs.


## Fresh PostgreSQL authentication/session result

2026-10-09: `/Users/shreshthagupta/.nvm/versions/node/v24.21.0/bin/node scripts/run-isolated-sessions.mjs` **PASS**, exit 0. The runner created a uniquely named local `codexqa_test_sessions_*` database, the verifier required loopback plus that database prefix, and cleanup reported the database removed. It applied migrations and ran actual HTTP server tests. Assertions reached included 24 unauthenticated method/route denials; credential and permission checks; hashed token storage and module-reload lookup; direct issuance cookie flags; logout then HTTP 401 on token replay; expiry denial; password-hash rotation and username rename invalidation; and login/session lookup. Additional Tally bridge and pairing tests also passed in that isolated DB. It did **not** test two-login session rotation, inactivity timeout, account deletion through a UI, cookie `Secure` behavior behind the deployed proxy, or database failure during logout. The first sandboxed attempt failed before DB connection with loopback EPERM; the approved retry completed and removed the test DB. No configured application database or provider was contacted.


## Fresh signed provider webhook evidence

2026-10-09: `/Users/shreshthagupta/.nvm/versions/node/v24.21.0/bin/node scripts/run-isolated-reliability-postgres.mjs scripts/verify-order-webhook-evidence.mjs` **PASS**, exit 0. The reviewed runner accepts only this known suite, creates a unique loopback `codexqa_test_reliable_*` database, disables Mongo persistence for the child, and drops the disposable DB. Actual HTTP plus PG assertions verified signed WooCommerce and Shopify deliveries, duplicate handling, changed-content conflict, cross-tenant/account denial, unrelated topics, OAuth/pairing state preservation, transaction rollback, and sanitized DB-unavailable/timeout responses. The run did not contact a merchant or provider; webhook registration, merchant retry threshold, disabled-subscription detection and missed-event recovery remain unverified.


## Flipkart order observation regression evidence

2026-10-09: `node scripts/verify-flipkart-orders.mjs` **PASS**, fixture-only. It asserts all seven documented category filters, pagination, cursor origin/loop and request-budget failures, split-window behavior at the 5,000-result ceiling, malformed item rejection, split-shipment grouping, mixed versus fully cancelled status, disabled historical alerts, idempotent partial-window replay, checkpoint advancement only after categories complete, and no repeat historical scan after completion. Injected DB interfaces only: no PG durability, account API, rate limit or seller reconciliation evidence.

Targeted ESLint **PASS** for new Flipkart modules/scripts. `tsc --noEmit -p tsconfig.app.json --incremental false` **PASS** and `tsc --noEmit -p tsconfig.node.json --incremental false` **PASS**. Regular `npm run typecheck` could not write the existing `.tscache/*.tsbuildinfo` paths (EPERM); the no-cache checks passed without touching those worktree paths. Connection readiness verifier **PASS**. Current Vite build was not repeated after the final JS-only polling interval/checkpoint correction; supported Node 24 build from the preceding fix turn passed.

## Unified-order isolated integration result — 2026-10-09

`node scripts/run-isolated-unified-orders.mjs` **FAIL** before reaching the Amazon lifecycle assertions. The disposable PostgreSQL runner stopped at `scripts/verify-unified-orders.mjs:51`: the assertion expected WhatsApp text `Check stock in D-Mills`, while the current `inventory/whatsapp.js` output is `Review order; wait for stock reservation`. The runner reported that its unique disposable database was removed. This is a test-versus-current-behavior mismatch; this report does not decide whether the product text or assertion is correct. Amazon assertions later in the same script (around lines 185–212 and later) were **NOT REACHED**, so this run is not evidence for Amazon database lifecycle behavior. Do not skip or rewrite the assertion to obtain a green result; first adjudicate the intended alert contract, then rerun the whole disposable suite. No configured provider or external queue was contacted.

`node scripts/verify-exceljs-uuid-override.mjs` **PASS**, 2026-10-09, Node 24.21.0. It resolves ExcelJS's UUID import through the current override, checks UUID v4 shape, writes and reloads an XLSX fixture, and verifies data-bar extension IDs, cell values, formula result and formatting. This validates the exercised ExcelJS/uuid v4 compatibility path only. It is not a full dependency test or advisory scan.

## Cancellation and ledger isolated-database attempt — 2026-10-09

`node scripts/run-isolated-central-inventory.mjs` **NOT RUN**: the wrapper could not connect to the configured loopback PostgreSQL listener (`connect EPERM ::1:5432` and `127.0.0.1:5432`) under this sandbox. The failure occurred before creating its unique disposable database; no database was migrated or removed. This leaves actual reservation concurrency, Shopify/Amazon lifecycle replay, cancellation rollback and ledger constraints unverified in this turn. Source paths and existing cancellation assertions were inspected, but test-source presence is not a PASS. Rerun on an environment that permits the repository wrapper's loopback PG connection; do not point it at a business database or bypass its local-host guard.

## Central Inventory workbook fixture and HTTP boundary — 2026-10-09

`node scripts/verify-workbook-inspector.mjs` **NOT RUN**: the verifier could not bind its loopback HTTP listener (`listen EPERM`) under this sandbox. A separate direct in-memory fixture invoked production `parseInventoryWorkbook` and `inspectInventoryWorkbook` functions and **PASS**ed the exercised cases: parsed a numeric count, rejected a formula quantity, produced a structure hash, identified candidate headers, and redacted row values. It does not exercise Express routing, session/tenant authorization, PostgreSQL batches or commits. `scripts/verify-central-inventory-files.mjs` contains HTTP/PG coverage for permission denial, replay, stale previews, concurrent commits and late-row rollback, but that suite is **NOT RUN** because required loopback access is unavailable. No configured database was contacted.

## Snapdeal, Zoho POS and Tally bounded adapter fixtures — 2026-10-09

A direct `node --input-type=module -e ...` fixture against production helper functions **PASS**ed the following assertions: Snapdeal probe uses the configured SUPC and seller authorization header and rejects a response missing that SUPC; Zoho POS connector uses the India API origin, organization ID and Zoho OAuth header; Tally parser extracts fixture company/item/voucher data and rejects DTD declarations. Injected fetchers only; no database, HTTP listener, provider endpoint or account credential was used. This does not verify provider sandbox behavior, quotas, token lifecycle, asynchronous Snapdeal feed results, Zoho adjustment writes, or Tally network security/retention. Those are contract and operational checks, not implied by the helper fixture.
