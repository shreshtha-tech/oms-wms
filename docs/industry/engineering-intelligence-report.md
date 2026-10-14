# OMS/WMS engineering intelligence report

Inspection date: 2026-10-09 (Asia/Kolkata). Status: **PROVISIONAL — RESEARCH IN PROGRESS**.

This report answers the mission questions from the current source and recorded evidence. It is a decision aid, not a production-readiness certification. The checkout is branch `fix/flipkart-order-intake-20261009`, HEAD `332743b0d0bdf21fc46bcda4eb327e8c2dda03fe`, with 259 `git status --short` entries at this inspection. The worktree is substantially dirty, so reproduce claims against the inspected files and [current source snapshot](current-source-snapshot.json), not HEAD alone. All ten requested detailed artifacts are indexed in the [evidence register](evidence-register.md).

## Which industry implementations are most relevant?

The closest useful references are pattern sources rather than replacement platforms:

| Reference | Applicable pattern | Fit and boundary |
|---|---|---|
| [Saleor stock locking](https://raw.githubusercontent.com/saleor/saleor/main/saleor/warehouse/lock_objects.py) and [reservation tests](https://raw.githubusercontent.com/saleor/saleor/main/saleor/warehouse/tests/test_stock_reservations_management.py) | Deterministic lock order and explicit reservation regression cases | Python/Django code is not a drop-in; local PostgreSQL ledger and worker already have locking controls. Use test cases to validate local multi-line/location behavior. |
| [Medusa v2.21.2 reserve step](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/packages/core/core-flows/src/cart/steps/reserve-inventory.ts) | Record effect identities and compensate only identified work | Compatible as a workflow concept; local transactional outbox remains the authority. Medusa Enterprise license carve-outs apply to other reviewed areas; no code was copied. |
| [pg-boss claim/retry plans](https://raw.githubusercontent.com/timgit/pg-boss/master/src/plans.ts) and [retry tests](https://raw.githubusercontent.com/timgit/pg-boss/master/test/retryTest.ts) | Durable claims, retries, exhaustion and stale-work tests | Local worker already implements leases, fencing and capped retry; test/measure it before considering another queue. |
| [Radix Dialog at pinned commit](https://raw.githubusercontent.com/radix-ui/primitives/25a1f5a766b317a10c284bf66b170d2cfb9c2ab7/packages/react/dialog/src/dialog.tsx) and [tests](https://raw.githubusercontent.com/radix-ui/primitives/25a1f5a766b317a10c284bf66b170d2cfb9c2ab7/packages/react/dialog/src/dialog.test.tsx) | Focus containment/restoration and keyboard dismissal | Useful for local `Modal`; no framework replacement is proposed. Browser behavior remains unverified. |
| [OpenTelemetry Express instrumentation](https://raw.githubusercontent.com/open-telemetry/opentelemetry-js-contrib/main/packages/instrumentation-express/src/instrumentation.ts) and [tests](https://raw.githubusercontent.com/open-telemetry/opentelemetry-js-contrib/main/packages/instrumentation-express/test/express.test.ts) | Parent-span and matched-route instrumentation | Local telemetry is process-local; bootstrap, export, privacy and cross-worker propagation must be verified before adoption. Upstream advisories include DB-user span attributes and conditional propagation/exporter risks; no OpenTelemetry package is in the current local lockfile. |
| [ERPNext stock ledger](https://raw.githubusercontent.com/frappe/erpnext/develop/erpnext/stock/stock_ledger.py) and [OpenBoxes InventoryService](https://github.com/openboxes/openboxes/blob/develop/grails-app/services/org/pih/warehouse/inventory/InventoryService.groovy) | Ledger provenance/rebuild and service transaction-scope questions | Different accounting and framework assumptions; use as investigation and test-design material, not as proof of local behavior. |

The [repository catalog](repository-catalog.md) records source, tests, maintenance, license and advisory boundaries. Several source inspections are branch-qualified; exact commit/release matching and exhaustive advisories remain incomplete. Upstream tests were not run locally.

## Which exact source files demonstrate useful patterns?

Within this checkout, the strongest current evidence paths are:

- `inventory/ledger.js` and `db/migrations/001_central_inventory.sql`: locked balance changes, event-key digest checks, nonnegative constraints and transactional event/outbox writes.
- `inventory/workers.js`, `inventory/ingress.js`, and `inventory/domain-events.js`: provider revision fences, line-scoped reservation transitions, delivery identity/digest checks, retries and held uncertainty paths.
- `inventory/files-api.js`, `inventory/workbook.js`, and `src/pages/CentralInventory.tsx`: preview/version-checked count imports and stable request-ID retries for manual adjustment.
- `inventory/flipkart-orders.js`, `inventory/flipkart-order-observation.js`, and `scripts/verify-flipkart-orders.mjs`: bounded category/page retrieval, history checkpointing and fixture coverage.
- `inventory/tally-bridge.js` and `scripts/tally-bridge.mjs`: paired local XML export, parser limits, digest identity, and encrypted held voucher review.
- `api/auth-session.js`, `inventory/tenant-boundary.js`, and `server.js`: configured-session and tenant-boundary mechanisms; they do not prove complete role/object policy.
- `reliability/telemetry.js`, `inventory/sqs-worker.js`, and `inventory/receipt-bridge.js`: local observability and durable asynchronous work boundaries; deployment-wide correlation and crash recovery need runtime evidence.

Detailed traces and confidence limits are in [source analysis](source-analysis.md) and [baseline](baseline.md).

## Which official platform requirements apply?

The relevant contracts depend on the actual adapter scope. Confirmed documentation findings include:

- Flipkart Shipment Search documents category filters, page size up to 20, cursor pagination, and a 5,000-result retrieval ceiling; it excludes Flipkart Advantage and states no retention floor. Local scan/checkpoint code exists, but configured account coverage and independent seller reconciliation are unproven.
- Shopify signs raw webhook bodies and uses delivery identity; API versions and GraphQL cost throttling need to remain explicit. Local signed-ingress tests passed on an isolated database in a prior recorded run; live app scopes and missed-event recovery remain open.
- WooCommerce REST authentication inherits WordPress user permissions; webhooks are signed and can be disabled after configured consecutive failures. Local signed delivery passed isolated HTTP/PostgreSQL tests; merchant subscription health is unknown.
- Amazon `ORDER_CHANGE` is an SQS notification contract, not proof of Orders API polling or history retrieval. Queue trust, subscription and PII retention remain unverified.
- Snapdeal seller data requires partner and seller authorization; inventory publication is asynchronous and result-status driven. Local code only reads one sample SUPC.
- Zoho POS uses OAuth scopes and reasoned inventory-adjustment documents. Local connector reads items/invoices; no write path is active. The declared adjustment scopes need least-privilege review.
- TallyPrime exposes local XML-over-HTTP capability; the local bridge adds pairing and bounded parsing. Voucher payload retention and local network access require review.
- Meta WhatsApp setup requires WABA subscription and permissions; local code sends template alerts and consumes signed status callbacks, not incoming orders.
- PostgreSQL, MongoDB and Render contracts inform migration, transaction and health checks, but configured versions, hosted settings, backups and restore evidence are not available.

Primary links and confirmed-versus-proposed distinctions are maintained in [platform documentation](platform-documentation.md). No live external account request or provider write was made during this research continuation.

## What is already implemented correctly?

Source evidence supports these positive findings for named paths:

- Central Inventory ledger mutation uses row locks, payload-bound event identity and database constraints. Workbook count commits are designed to validate preview versions and write all rows in one transaction; direct parser fixtures passed, while the HTTP/PG suite remains NOT RUN in this sandbox.
- Provider ingress and worker paths implement selected duplicate, changed-payload, revision, reservation identity and terminal-state guards. Prior isolated webhook evidence is recorded separately from provider configuration; broad cancellation concurrency and recovery still need fresh owned-store proof.
- Flipkart order observation now has a paginated, category-aware, resumable history scan from a 1970 lower bound and readiness states. The seller-fulfilled search has a 5,000-result cap and excludes Flipkart Advantage; provider retention to the lower bound is not guaranteed. The recurring seven-day refresh uses `orderDate`, so late changes on old orders may remain stale (source-based inference). The injected regression suite passed; multi-window, configured full history, owned-PG restart and seller reconciliation are NOT RUN.
- Snapdeal remains a sample read, Zoho writes remain disabled, and Tally voucher processing remains held for review. These readiness limits are safer than reporting unsupported synchronization as complete.
- Secret-bearing provider calls use a common bounded fetch layer with destination checks, deadlines and response limits; tests cover selected boundaries, not every DNS/network deployment behavior.

These statements describe source or the exact named test scope. They do not establish production readiness or all ten enterprise invariants. The [baseline invariant table](baseline.md) lists each remaining proof obligation.

## What is missing, incorrect, or unverified?

The highest-consequence gaps are:

1. The active SKU import UI makes sequential per-row writes and then calls a processor endpoint whose valid import path is hard-coded to return 501. Its response says no SKU changes were made, although earlier row requests may already have committed; the UI displays only that final error. This is a source-confirmed partial-write and false-outcome-reporting defect. Persistence, rollback and failure windows still need isolated runtime proof; do not describe it as confirmed data loss.
2. Real PostgreSQL contention, migration rollback, distributed Mongo/PostgreSQL crash recovery, worker lease recovery, restore/parity and hosted behavior are incomplete or NOT RUN.
3. The PostgreSQL runner serializes 29 ordered migration files but has no applied-version/checksum ledger. Two `CREATE INDEX CONCURRENTLY` migrations have a validity check but no automatic repair path; Mongo schema/index state is separate and uninspected. Upgrade drift and failed-index recovery deserve a bounded migration audit before rollout.
4. Authentication exists, but full route/object/field/tenant/warehouse authorization policy is not mapped or tested. Several ASVS session requirements need applicability and owner decisions.
5. Flipkart configured multi-window retrieval, account entitlement, field schema and independent seller reconciliation are NOT RUN. The local adapter now backfills and refreshes both orderDate and cancellationDate; this does not prove provider retention, complete marketplace history or coverage of generic non-cancellation status changes.
6. Provider contracts remain partial for account lifecycle, rate limits, pagination/reconciliation, privacy/retention and sandbox behavior; several partner portals require seller-provided contracts.
7. Tally's held voucher payload is encrypted but no expiry was observed in the source path. Zoho's current OAuth scope request may exceed the active read behavior. These are review findings, not confirmed breaches.
8. Dependency advisory scanning could not reach the npm registry. The lock contains 533 entries; `buffers@0.1.1` remains the one identified unresolved license grant on the non-dev dependency graph (`exceljs` → `unzipper` → `binary` → `buffers`). Selected upstream OpenTelemetry advisories are an adoption constraint, not a local dependency finding. No complete clean security scan or legal-compliance conclusion is claimed.
9. Workload, latency, availability, RPO and RTO targets require owner decisions and must not be invented.
10. The legacy route set is session-authenticated in the shared mount, but operation-level role/object policy remains incomplete. The Salesforce connection-test endpoint caps time and rejects redirects but does not impose an explicit provider-response byte cap; it does not persist supplied credentials. This bounded route needs injected response-size/error tests before being considered resource-bounded.
11. Amazon SQS intake exists as a separate source CLI and isolates failed messages, but `render.yaml` starts only the general inventory worker and does not define the queue consumer or its queue/account settings. Queue policy, visibility, DLQ/redrive, AWS identity, subscription and hosted consumer state remain unverified, so Amazon order intake is not established as active in the described Render deployment.

The [security](security-gap-analysis.md), [reliability](reliability-and-observability.md), [license/supply-chain](license-and-supply-chain-review.md), and [test strategy](test-strategy.md) documents contain the exact evidence and limitations.

## Which improvements have the highest business value?

Priority is qualitative and considers business impact, integrity/security risk, evidence strength, compatibility, effort and operational complexity; no numeric score is used.

1. **Restore safe owned PostgreSQL/Mongo integration validation.** Without this prerequisite, the central stock, reservation, import, recovery and authorization invariants cannot be proven at their required scope. Medium, environment-dependent effort; low product risk if guarded test harnesses are used; acceptance requires a unique owned `*_test` database, reached assertions and verified cleanup.
2. **Make SKU import server-owned, retry-safe and atomic/recoverable.** High business-integrity value because per-row writes can precede the guaranteed 501 for a valid import, which reports a false no-change outcome. Medium/large effort; medium/high identity and transaction-model risk; first obtain the owner's all-or-nothing versus partial-success decision. Acceptance requires server-derived validation/history, stable request identity, exact-replay recovery, changed-payload conflict, late-row failure behavior, concurrent uniqueness and browser timeout/refresh tests, with no stock effects.
3. **Prove reservation/cancellation concurrency and tenant authorization.** High stock/security impact; tests first, medium effort; no ledger policy change without explicit authorization. Acceptance requires competing multi-line/location tests, rollback and replay cases, and HTTP positive/negative checks with persisted-state snapshots.
4. **Verify Flipkart historical coverage and generic status freshness with the seller and owned database.** High user value, medium effort with account/environment dependency. Acceptance requires category/date coverage, a documented provider retention boundary, multi-window restart without duplicate effects, independent counts by date/category/location, and an assessed contract-backed path for an older order changed outside cancellationDate; record sanitized evidence.
5. **Close platform truth and retention gaps.** Keep Snapdeal read-only until asynchronous feed results/readback exist, reduce Zoho scopes if approved, and decide Tally voucher retention. Small investigation plus medium tests; external-write risk stays high until idempotency/readback is demonstrated.

The ordering is provisional because owned test infrastructure and policy decisions can change feasibility. Full scope, affected files, risks and validation are in the [implementation roadmap](implementation-roadmap.md).

## How should each improvement be implemented and proven?

Use isolated, independently reviewable work. First validate the test harness refuses configured databases before imports or migrations. Capture actual baseline results. Add a meaningful failure/replay/concurrency regression at the relevant boundary, make the smallest compatible change, run the targeted test plus required build/type checks, inspect the final diff, then update the evidence register with exact commands, environment and assertions. For SKU imports, prove server-side staging/commit and idempotency against owned Mongo requirements before choosing a transaction design; do not infer replica-set capability. For stock, preserve the central ledger as authority and do not invent opening balances, mappings or negative-stock exceptions. For provider writes, obtain the contract and permission first, then use seller-approved sandbox/readback evidence. Never interpret fixture tests as configured-provider or hosted proof.

## Evidence status and next gate

The ten mission artifacts are present, and document-level structural checks have passed in recent continuations. This report is a synthesis, not closure of research. The mission remains **IN PROGRESS**: repository/advisory/release verification is incomplete; some platform privacy and sandbox contracts are missing; several runtime suites could not bind loopback under the current sandbox; policy and recovery targets need owner decisions; and Phase 10 implementation selection follows completion of the research gate. The separate Flipkart intake authorization does not authorize broader implementation choices. Continue safe research and owned-fixture work while preserving the current dirty checkout. Do not deploy or claim production readiness.
