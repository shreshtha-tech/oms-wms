# Database performance report

Date: 2026-10-08 (Asia/Kolkata). Part 1 investigation. **PERFORMANCE: BLOCKED**. No index or production database change was made.

## Connection and failure evidence

`reliability/postgres-connection.js` defaults: max pool 10, acquisition/connect timeout 8 seconds, idle pool timeout 30 seconds, statement timeout 15 seconds. `inventory/db.js` rolls back failed transactions and discards a client if rollback fails. Migrations use a session advisory lock and temporarily increase statement timeout to 120 seconds. No explicit idle-in-transaction deadline is supplied by the pool defaults.

The fresh owned loopback PostgreSQL verifier initially passed on Node 24.21.0: exhaustion with pool size 1 produced sanitized 503 and recovered after release; a timed-out statement rolled back a prior UPDATE; termination of an active fixture backend rolled back a prior UPDATE and the pool reconnected; a duplicate key remained 23505 and did not create another row. Test acquisition/statement deadlines were 150 ms and override production defaults. These are failure-control checks, not performance or inventory correctness certification.

The harness was then strengthened to clear inherited PG driver settings and publish RUNNING/FAIL/PASS status. Its first rerun failed with ENOSPC before startup. A later attempt failed during fixture setup without completing assertions. At that checkpoint, `docs/hardening/postgres-failure-evidence.json` reported FAIL with no test results. A new approved owned rerun on 2026-10-08 at 02:48:57 UTC now reports PASS for all four checks on PostgreSQL 18.3, Node 24.21.0. The earlier setup failures remain part of this history; the current JSON provides fresh passing evidence for the strengthened harness. Setup diagnostics now classify disk/permission failures without printing raw process output. No existing files or audit history were deleted to free space.

## Critical query review queue

| Source/path | Current query pattern | Required performance/lock evidence |
|---|---|---|
| Ledger balance/event/reservation | Exact tenant/SKU/location row locks; event key and reservation business identity lookup | EXPLAIN/index coverage; contention under same SKU, many locations and multiple channels |
| Overview/summary | Full tenant SKU list with lateral balance/catalog aggregation plus all mappings/alerts/accounts | Representative cardinality, aggregate-only summary and page design; no inferred capacity |
| Unified order search | Tenant filters, ILIKE/line EXISTS, count and offset pagination | Query plans for search/filter shapes, deep-page cost, supporting index measurement |
| Inventory worker claim | Tenant predicate, ready/expired branches, order by ID, SKIP LOCKED | Ready/expired index coverage; hot-tenant/skew/backlog plans and claim lock duration |
| Publication attention page | Lateral latest/held task selection, count, OFFSET | Lateral/count cost with real task distributions and supported index justification |
| Reconciliation and lease expiry | Unbounded selected mappings/held tasks and expired-dispatch sweep | Bounded work/page model; scan/lock/serialization budgets and fairness |
| Export | Full overview and all balances then selected-SKU filtering | SQL-side bounded filters, snapshot duration and report resource cost |
| Shared Mongo find/findOne | Bounded cursor reads and direct findOne after Mongo repairs | Fixture ID-index plans measured below; production index/tenant contract and representative dataset remain unresolved |
| Sessions/monitoring | Per-request session lookup, expiry cleanup, tenant queue counts | Login cleanup cost, monitoring scan interval/cost, pool pressure and mixed workload |

Source location inventory: `docs/hardening/source-surface.json`. Lexical query counts include tooling/tests and do not prove that every PostgreSQL query has been semantically audited.

## Lock-order observations

Ledger locks master SKU then balance, and then an existing reservation on release/consume. Return receipt locks request advisory key, return case and original unified order before invoking the ledger. Workbook commit locks its import batch and then SKUs/balances in input-row order. Opening stock locks its batch and selects eligible SKU/location/line rows ordered by SKU/location before posting. Transfer applies both movements within one caller transaction. Publication locks a mapping session across remote calls, occupying a pool connection without a BEGIN transaction in that function.

These different orders require a full overlapping-operation graph, especially multi-SKU workbook/order/return paths. No deadlock cycle is claimed proven solely from source. No important lock or transaction may be removed to improve a benchmark at the expense of replay or stock integrity.

## Missing measurements

EXPLAIN/EXPLAIN ANALYZE for all critical application queries: NOT RUN. Cardinality/distribution, latency p50/p95/p99/max, lock wait/deadlock rate, sustained pool pressure and production capacity: NOT RUN. PostgreSQL outage/restart, idle-in-transaction termination, Mongo outage and store restore: not established by this new verifier. Approved launch volumes and performance/recovery targets remain unresolved.

Mongo runtime read/write/transaction repairs are recorded in `hardening/MONGODB_FIXES_2026-10-08.md`. Production index changes: NONE. Production performance approval remains BLOCKED.

## Owned Mongo query-plan measurement

Node 24.21.0, fresh loopback replica set, disposable mongo_boundaries_test.records collection, 10,001 small uniform documents. Command: scripts/verify-owned-mongo-boundaries.mjs. Actual executionStats results:

| Query | Index state | Returned | Documents examined | Keys examined |
|---|---|---:|---:|---:|
| Exact numeric ID, final record | No ID index | 1 | 10,001 | 0 |
| Same exact numeric ID | Unique ascending ID index | 1 | 1 | 1 |
| Highest ID, descending sort, limit 1 | Same ascending ID index | 1 | 1 | 1 |

PASS: the owned unique index also rejects a duplicate ID with Mongo code 11000. Existing read/write/rollback/concurrency assertions passed with this fixture index. The index exists only in disposable data; it is not automatically installed by runtime helpers or applied to configured databases. This establishes an index candidate for numeric-ID operations, not representative latency/capacity, tenant isolation, migration readiness, or coverage of other filters. Diagnose historical duplicates and inspect configured indexes before proposing a deployment migration. Latest full owned fixture run cleaned its application pool, daemon and temporary data.

## Fresh PostgreSQL fault rerun

Current postgres-failure-evidence.json: PASS, four checks, PostgreSQL 18.3 (Homebrew). Pool acquisition recovery 152 ms; statement timeout/rollback 153 ms; active backend termination/rollback/recovery 5 ms; duplicate constraint retention 2 ms. These single-scenario durations are not request latency percentiles or an RTO. Fixture pool size 1 and 150 ms deadlines override production defaults. Default idle-in-transaction timeout is still 0; its remediation/termination campaign remains open. The sandbox attempt failed with FIXTURE_PERMISSION_DENIED; the approved loopback rerun passed and cleaned its owned process/data. No configured store or inventory ledger was accessed.

## Idle transaction guard

The shared PostgreSQL pool now defaults idle_in_transaction_session_timeout to 60,000 ms, separately from the 15-second statement timeout. Explicit deployment options may override it. Idle transaction termination code 25P03 and the pg driver's non-queryable terminated-client errors map to sanitized DATABASE_UNAVAILABLE, preserving constraint/query-timeout distinctions. This prevents an abandoned open transaction from holding locks indefinitely by default; it does not shorten an actively running statement or prove whole-workflow timing.

The owned verifier adds an idle-transaction write followed by 150 ms inactivity, observes server termination, verifies unavailable classification, discards the dead client, reconnects and checks original value 42. Its first run failed the terminated-client classification; the runtime boundary was corrected and the current evidence JSON records the authoritative rerun result. The production 60-second setting is a guardrail, not an approved business SLO. External operations must not be placed inside open transactions. Long intentional idle transactions require explicit review before deployment.

## Balance endpoint response bound

IMPLEMENTED: inventory/http.js /balances now calls inventory/balance-read.js with the authoritative inventoryTenantId. SQL returns at most 10,001 rows in deterministic SKU/location order. At most 10,000 rows and 8 MiB serialized UTF-8 content are returned; exceeding either guardrail yields explicit HTTP 413 BALANCE_RESULT_LIMIT. No partial result is emitted. Existing bounded results retain the array contract. PostgreSQL query/connection deadlines remain supplied by the shared pool.

TESTED: verify-balance-read-boundary.mjs PASS with injected query results for empty and complete 10,000-row responses, 10,001-row rejection, multibyte UTF-8 oversize rejection and original query-error preservation. The verifier checks tenant predicate, ordering and bound SQL parameters. This does not establish actual index coverage, query cardinality/cost, route authentication or production memory/latency. The pg driver still materializes the bounded selected rows before aggregate byte validation; this is not a streaming endpoint. Large tenants need an authorized paginated balance workflow before this limit can satisfy their operational needs. No schema or stock was changed.

## Aggregate-only inventory summary implementation

IMPLEMENTED: /central/summary now uses readInventorySummary in inventory/read-model.js, returning one aggregate SQL row instead of materializing all overview products, locations, mappings, alerts and account objects. It preserves catalog/count/sellable/open-alert/active-mapped-account fields and generatedAt. Physical stock counts/sellable include only warehouse/store locations and join master SKUs; alert counts join known masters; active accounts require an active mapping. Every subquery is tenant-scoped. Counts/totals outside safe nonnegative integer range reject rather than silently lose precision.

TESTED (injected SQL result only): verify-inventory-summary-boundary.mjs PASS for one query, payload shape, numeric conversion, unsafe totals and missing result rejection. Actual SQL execution/parity against full overview with foreign tenant, physical/marketplace locations, zero/negative sellable and mapping distributions remains NOT RUN for this implementation. EXPLAIN/latency/memory comparison remains required. One returned row bounds response cardinality but does not establish scan/index efficiency. Files changed: inventory/read-model.js, inventory/central-api.js and new verifier; no configured database accessed.

## Actual PostgreSQL summary semantics

TESTED against fresh owned PostgreSQL 18.3 on Node 24.21.0: scripts/verify-inventory-summary-postgres.mjs creates temporary tables on an owned checked-out client and executes the production readInventorySummary SQL. PASS for empty tenant; tenant A/B isolation with colliding record IDs; multiple physical locations counted once; marketplace-only stock excluded; negative sellable balance clamped to zero; orphan master references excluded; closed alerts excluded; inactive account/mapping excluded; multiple mappings count an account once; unsafe aggregate rejected. Fixture expected totals A={catalogSkus:3,countedSkus:1,sellable:5,lowStock:1,activeAccounts:1}, B={1,1,10000,1,1}.

The owned PostgreSQL harness now records six passing checks including this summary case in postgres-failure-evidence.json. Temporary tables and the owned process/database are removed. This supersedes NOT RUN for SQL execution and these semantics; full overview-to-summary comparison on production schema, plans, realistic distribution, latency and memory remain unverified. Temporary fixture schemas exercise the SQL's required columns, not migrations/constraints or business stock posting.

PostgreSQL transaction cleanup correctness: inventory/db.js delegates transactions to reliability/postgres-transaction.js. A pool release exception now emits fixed sanitized process telemetry without replacing a committed result or primary failure. Rollback failure discards the client, reports cleanup failure and preserves the original operation/commit error. Migration client release uses the same outcome-preserving release helper. Commit errors are not converted to success; commit acknowledgement uncertainty still needs separate classification/reconciliation review.

TESTED: verify-postgres-transaction-cleanup.mjs PASS with injected release/rollback/commit failures and exact outcome/error retention. Fresh migrated receipt propagation suite PASS through the actual wrapper, including consumer rollback, no-effect invalid inputs/unsafe stored bigint, replay, post-commit SIGKILL recovery and over-receipt protection. Actual driver release throwing was not injected; cleanup fault evidence is synthetic. No configured service accessed; syntax/diff checks PASS. API/worker restart required to load this source repair.

PostgreSQL commit uncertainty classification: runPostgresTransaction tracks the COMMIT dispatch phase. Connectivity and timeout failures from that phase now become sanitized DATABASE_COMMIT_UNCERTAIN (postgresql, 503), discard the client and require preserving request identity/reconciliation before retry. Known SQL constraint failures remain their exact primary errors. Failures before commit retain existing classification. Shared inventory API errors and Mongo-facing receipt error serialization recognize the database correctly. No automatic transaction retry was added.

TESTED: injected transaction regression PASS for lost-commit classification, discarded client, retained deferred 23505 failure, sanitized HTTP 503 reconciliation message, and existing cleanup-result retention. Actual commit acknowledgement loss remains NOT RUN; other operation/store errors and backend loss tests do not prove that scenario. Domain-specific reconciliation identities and consumer retry handling remain review items; this classification alone does not establish universal safe recovery.

Fresh migrated receipt propagation/rollback/replay/post-commit crash suite also PASS after commit-classification integration. This verifies normal-path compatibility; it does not replace the missing actual acknowledgement-loss injection.

Real commit-loss continuation: owned PostgreSQL ten-check harness PASS with a TCP proxy suppressing the actual COMMIT acknowledgement after server CommandComplete. Driver transaction receives DATABASE_COMMIT_UNCERTAIN; callback executes once; independent read finds exactly one committed record. Earlier injected-only/NOT RUN statements for PostgreSQL acknowledgement loss are superseded for this transport fixture. Universal domain reconciliation and hosted recovery remain unverified. See CHAOS_RECOVERY_REPORT.md.

Receipt bridge continuation: fresh-store PASS for complete 10,000-row session reads, explicit rejection of 10,001 historical receipts with full transaction rollback, 100-row command pages and unchanged transaction deadline. The first test exposed and then verified a MongoDB 6.21.0 transaction cursor timeout-context correction. Historical quantity validation/overflow and batch-limit rejection also pass. See docs/hardening/MONGODB_FIXES_2026-10-08.md for changed files, the driver-internal compatibility dependency and exact evidence limits. Legacy query index coverage and hosted capacity remain unverified.

## Receipt result claim plan under an owned backlog

2026-10-08: The exact PostgreSQL claim SQL moved into inventory/receipt-claim-query.js so runtime and plan verifier use one statement. Fresh owned PostgreSQL 18.3 fixture used a temporary ci_domain_outbox with 20,000 completed rows and one eligible pending row, ANALYZE, and EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON). Before an index, the claim's sequential scan removed 20,000 rows and the single observed execution took 2.245 ms. A temporary partial (tenant_id, created_at, event_id) index restricted to pending/retry/processing rows below eight attempts was then created. The exact statement used that index, removed zero rows in its index scan and took 0.059 ms. Both plans claimed precisely the one eligible row; 20,000 completed rows remained. These are one-off warm local plan observations, not p95/p99, representative backlog drain, or hosted capacity. Full machine-readable evidence is in hardening/postgres-failure-evidence.json (PASS, eleven owned checks).

Based on the observed plan, migration 027 adds the same partial index to the real ci_domain_outbox using CREATE INDEX CONCURRENTLY IF NOT EXISTS. migrateInventory checks pg_index.indisvalid afterward, so an interrupted invalid same-name index causes an explicit migration failure rather than silent use of IF NOT EXISTS. The worker startup requires a valid index and migration 026 claim columns before scheduling. Fresh migrated PostgreSQL/Mongo receipt suite PASS after migration 027; offline worker missing-schema gate PASS. A configured database was not accessed or indexed. Production data distribution, index-build duration/lock interaction and hosted rollout remain unverified. Mongo receipt claim index coverage is a separate open performance item.

## Mongo receipt claim indexes under an owned backlog

2026-10-08: the original Mongo claim combined ready and expired tasks in one OR filter and one available_at sort. The first 20,002-row fixture (one eligible row) showed candidate indexes reducing documents examined from about 20,000 to one, but the planner chose the expiry index for both paths. That did not establish ready-queue behavior under active backlog. The runtime now alternates priority between separate ready and expired atomic claims; each uses its own due-time sort, retaining two-minute leases and claim-token fencing.

The second fresh loopback replica-set fixture contained 20,000 completed tasks, 1,000 ready tasks and one expired processing task. Exact exported claim predicates/sorts without indexes each examined 21,001 documents. Two partial active-task indexes then reduced both queries to one document and one key examined: receipt_ready_active_idx for ready work and receipt_expired_active_idx for expired work. Single observed executionTimeMillis was 10/4 ms before and 4/2 ms after for ready/expired respectively. These are local explain executionStats for find cursors, not findOneAndUpdate mutation plans, percentile latency or hosted capacity. Machine-readable result: hardening/receipt-claim-mongo-plan.json. The suite removed its owned daemon/data.

The measured definitions are in inventory/receipt-claim-query.js. scripts/mongo-ensure-indexes.mjs now accepts an explicit --scope receipt-claims alongside its existing exact --db and --yes guards; that scope creates only these two additive indexes. Its injected-client regression PASS and verified no client construction for missing/incorrect approval arguments. No configured MongoDB was inspected or indexed. The receipt job checks both installed key/partial definitions before processing; a missing/mismatched index reports RECEIPT_CLAIM_INDEX_MISSING (503), and the next run can recover after an operator applies the indexes. Fresh two-store receipt suite PASS for missing-index refusal, fixture index installation and the existing lease/stock/recovery scenarios. Other scheduled capabilities are not made dependent on this check. The check caches success in-process; later index removal requires separate monitoring/restart detection.

WMS zone-picker transaction query plan: on a fresh disposable generic_records collection containing 10,001 unrelated rows plus 31 fixture records, the two-ID/module zone lookup examined 10,032 documents without an ID index and 2 documents/4 keys after a unique ascending numeric-ID index. The requested-code picker lookup examined 10,032 documents without a matching index and 1 document/1 key after a partial {code:1,module:1} index for user-enquiry records. Both executionStats nReturned values matched the expected 2 zones and 1 picker. This measures query selection on the owned fixture, not configured cardinality, write cost, transaction latency or a launch SLO. The handler now queries only requested picker codes and rejects more than 1,000 matching records rather than loading all picker users.

scripts/mongo-ensure-indexes.mjs offers these two measured definitions only under explicit --scope zone-pickers with exact selected --db and --yes guards. The injected-client guard regression PASS, and no configured index was created. Numeric-ID uniqueness requires a configured duplicate/field-state diagnosis before operator rollout; if duplicates exist, createIndex fails rather than repairing data. The route does not currently gate every zone mutation on installed index definitions, so configured query plans and deployment remain open.

Authentication login path: expired ci_auth_session cleanup was an unbounded DELETE before session insertion. The expiry index already exists in migration 013. Runtime cleanup now selects at most 1,000 expired token hashes by expiry with SKIP LOCKED and deletes them in a background single-flight task after the durable session insert; full batches continue at a controlled interval. A fresh guarded PostgreSQL fixture with 1,201 expired sessions PASSed eventual cleanup and ordinary login/session/logout. This is work and concurrency bounding, not a measured p95/p99 login or retention-capacity claim; configured table cardinality, lock waits and multi-instance maintenance throughput are still unmeasured.

Rate-limit table maintenance now uses the same bounded single-flight scheduler after the IP/account counter checks. Migration 019 already indexes window_started; each cleanup query selects at most 1,000 stale keys by that order with SKIP LOCKED. The fresh guarded HTTP fixture PASSed 1,201-row drain and a forced DELETE failure while valid login still returned 200. Counter upserts remain synchronous authority and may still incur PostgreSQL contention; their configured execution plans and login latency distributions are not measured.

Configured index inventory, build duration, provider/staging load and queue retention remain unverified. A production build requires review of the named selected database, workload window and operator rollout; no automatic configured index change occurred.

Receipt recovery query continuation: the result claim now has separate ready and expired SQL, with alternate priority across calls. Owned PostgreSQL executionStats for one expired row behind 1,000 ready rows: prior active index filtered 1,001 rows (0.122 ms observed); measured due-time partial index found one row with zero filter removals (0.040 ms). Migration 028 creates this index concurrently and checks validity before receipt work. Fresh migrated receipt suite PASS. The machine-readable plan is in hardening/postgres-failure-evidence.json. The single-plan timing is not a production percentile.

Latest owned claim-only 100,000-pending-per-store campaign (five concurrent workers, 1,000 claims per store) PASS with no duplicate identities. Mongo p95/p99 44.288/107.881 ms and PostgreSQL p95/p99 79.155/95.466 ms, closed-loop on one disposable host. See QUEUE_RELIABILITY_REPORT.md and hardening/receipt-claim-backlog-evidence.json for method and limits. These numbers are observed local samples, not approved targets or business throughput.
