# MongoDB scoped fixes — 2026-10-08

The user explicitly requested analysis and repair of the MongoDB part during the broader audit. This authorizes the scoped runtime repairs below. The full production goal and remaining Mongo work stay active.

## Problem and repair

Shared `api/mongo.js` find previously called `toArray()` for every matching document. Its findOne called that full find and took the first row. This caused unnecessary reads and permitted large result arrays on legacy request paths.

`api/mongo-read.js` now iterates a driver cursor with a 25-document batch request, a 10,001-document detection limit, and a 15-second server/client cursor-lifetime deadline. It allows at most 10,000 returned documents and 8 MiB of cumulative BSON document bytes. On excess it throws DATABASE_RESULT_LIMIT; it never returns a partial successful list. The shared error boundary returns sanitized HTTP 413. Cursor cleanup runs after success/failure, preserving the original failure if cleanup also fails. FindOne now invokes the actual driver findOne with a 15-second client/server deadline and a single-document byte check. Explicit development-memory reads follow the same result-budget/alias contract.

These limits are defensive application guardrails, not measured launch capacity or approved SLOs. Legacy lists above the envelope now fail explicitly and need server-side pagination/filtering. The byte budget covers accumulated document bytes; it is not a whole-process heap guarantee. The driver may receive a document/batch before the application rejects it, and the 25-document batch setting is a request to the server, not a byte-memory quota. Direct collection callers and specialized transaction helpers still require separate bounds.

Tenant policy was not invented or retrofitted into legacy records. Shared Mongo helpers still do not establish tenant/object/role isolation. That requires the authorized legacy storage contract and per-operation predicates. Configured TLS, credentials, selected database and business records were not changed; no configured DB was accessed.

## Test evidence

All final commands below ran under Node 24.21.0:

| Command | Result | Evidence scope |
|---|---|---|
| `scripts/verify-mongo-read-boundary.mjs` | PASS | Injected cursor: complete-or-error row/byte bounds, deadline options, bounded iteration, cleanup, original error; actual direct findOne delegation; explicit memory alias/null/result error and safe HTTP 413 |
| `scripts/verify-mongo-reliability.mjs` | PASS | Mock client: single-flight outage/recovery, business errors retained, query deadline classification, redaction and shutdown |
| `scripts/verify-mongo-safety.mjs` | PASS after fixture correction | Offline configuration/empty/populated/readiness, guarded export/restore fixtures and Render proxy/session/header checks; no live connections |
| Syntax and `git diff --check` | PASS | Changed JS syntax/whitespace only |
| Fresh Mongo daemon / real driver-server query / configured Atlas / hosted load / restore | NOT RUN | Host disk is nearly full (roughly 140 MiB available during this run); no fresh daemon or production connection evidence is claimed |

The first Mongo safety run failed in the unrelated offline Render session fixture: it called issueSession for an account that was not configured. The current session implementation requires that precondition. The fixture now installs its own synthetic operator settings, excludes inherited real settings, and restores the prior process environment in finally. Secure-cookie and proxy assertions are unchanged. Authentication was not weakened to make the test pass.

## Files touched for this Mongo repair

| File | Why |
|---|---|
| `api/mongo.js` | Use bounded read helpers and real findOne; serialize result-budget errors truthfully |
| `api/mongo-read.js` | Central read budgets, cursor cleanup and driver read implementation |
| `scripts/verify-mongo-read-boundary.mjs` | Permanent result/deadline/cleanup/single-document/error regression |
| `scripts/verify-render-health-offline.mjs` | Supply required isolated account precondition for session test and restore inherited settings |
| `package.json` | Register `test:mongo-read-boundary`; preserve existing scripts |
| This report | Exact repair, verification and limitation record |

## Remaining Mongo work

Audit specialized direct cursors and update-result reads, tax-group snapshots, large mutation ID sets, transaction callback/commit lifetime and cleanup errors, query/index coverage, tenant/role/object predicates, restore integrity and configured connectivity. Run actual driver-server failure/boundary tests when sufficient disposable-host resources exist. Existing historical Atlas handshake reports are not refreshed-current evidence. No assertion that Mongo is wholly fixed or production-ready is made.

## Transaction continuation

Root cause: three transaction wrappers used `finally { await session.endSession(); }`, allowing cleanup failure to replace either a committed success or the original operation failure. The tax-group transaction paths also materialized full collections using direct toArray calls without the new read budget.

Repair: `api/mongo-session.js` runs session-owned transactions with 60-second driver CSOT and 15-second maxCommitTimeMS options, retaining supplied snapshot/majority policies. Cleanup failure emits a sanitized event and bounded process counter while preserving the business result or primary error. A driver UnknownTransactionCommitResult label becomes DATABASE_COMMIT_UNCERTAIN with a sanitized 503 response requiring same-identity reconciliation before retry. This is a local database-commit classification, separate from provider UNKNOWN_REMOTE_STATE.

`mongoDomainTransaction`, tax-group save and tax-group snapshot now use this wrapper. Tax transaction reads use bounded cursor iteration with the explicit session and inherit its CSOT context, avoiding an illegal per-operation timeout override. The topology capability probe has a 15-second client deadline. Drivers can bound operations using the session; the helper cannot forcibly cancel arbitrary user JavaScript or an external promise inside a callback. Application callbacks must remain store-only and await all operations with that session. Real commit loss/recovery and callback/operation fault timing still require actual server tests.

Fresh `verify-mongo-session-boundary.mjs` PASS under Node 24.21.0: cleanup-after-success returns committed result, cleanup-after-failure preserves the exact primary error, both commit-label representations are sanitized, session ends once, deadline options are passed, transaction read avoids overriding session timeout, and HTTP uncertainty response requires reconciliation. Existing read-boundary and offline safety suites also PASS after these changes. This is injected-session/cursor and explicit-memory evidence; actual DB commit/crash/rollback is NOT RUN.

Additional touched files: `api/mongo-session.js` (transaction outcome/cleanup boundary), `scripts/verify-mongo-session-boundary.mjs` (permanent fault regression), and `package.json` (test registration). `api/mongo.js` and `api/mongo-read.js` now also integrate bounded session-owned tax reads. No configured data/schema/credential or TLS change occurred.

Remaining direct updateMany readback, specialized writes, tax memory snapshot budget, per-role/tenant ownership, index/performance and real store validation remain open. These repairs do not establish whole-Mongo production readiness.

## Mutation boundary and real Mongo verification

The shared update helper previously wrote multiple documents and performed a separate unbounded read afterward. A read failure could therefore report failure after the write had already committed. Updates now validate positive integer IDs, preserve record identity, and reject more than 1,000 supplied IDs or update fields above 1 MiB before writing. Single-record updates return the atomic findOneAndUpdate result, with explicit driver metadata handling that preserves a business field named value. Multiple-record updates and bounded result reads run in one transaction; a result-read failure rolls back the write. Explicit memory fixtures validate before applying changes as well.

Compatibility: multi-record updates now require a transaction-capable Mongo deployment, and oversized legacy operations receive an explicit error instead of an unbounded result. Single-record update results are subject to Mongo's document limit rather than the aggregate 8 MiB read budget, avoiding an artificial post-commit result-budget error. These fixed budgets are guardrails, not measured launch SLOs. Specialized write helpers outside this shared path still need review.

Added files: api/mongo-mutation.js, scripts/verify-mongo-mutation-boundary.mjs and scripts/verify-owned-mongo-boundaries.mjs. api/mongo.js integrates mutation validation and sanitized 400/413 errors; package.json registers the mutation regression.

The owned Mongo test PASS under Node 24.21.0 on a fresh loopback-only replica set and fresh mongo_boundaries_test database: exactly 10,000 rows returned, excess rows rejected, direct single-document read, atomic update preserving business value, multi-record transaction commit, and actual rollback when aggregate result bytes exceeded the read budget. All 12 affected documents retained their original state and lacked the attempted payload after rollback. The daemon received a minimal environment, inherited no configured credentials, and its owned process and temporary data were removed. Initial sandbox startup failed; the approved rerun passed. Available disk had improved to approximately 600 MiB before this run.

This supersedes the earlier NOT RUN entry for fresh-server query and transaction rollback only. Configured Atlas connectivity, hosted load, indexes/EXPLAIN, real uncertain-commit recovery, backup/restore and tenant/role isolation remain NOT RUN or unresolved.

## Specialized atomic-result correction

All seven findOneAndUpdate call sites in api/mongo.js now request includeResultMetadata:false explicitly and use the returned document directly. The previous result.value || result heuristic treated a business field named value as driver metadata; specialized writes could commit but report a missing result. Non-transactional calls also receive a 15-second operation deadline; tax counter allocation inherits its session deadline.

Extended owned replica-set test PASS: real application insert/counter allocation, vendor audit update preserving a string value field and its audit entry, revision update preserving a string value field, and stale revision rejection returning null. Existing row-limit and bulk-rollback scenarios passed again in the same run. Cleanup closed the application pool and removed only the owned daemon/data. Mutation/session regressions also PASS. The remaining specialized helpers use the same explicit result contract but were not individually exercised against Mongo in this run.

## Specialized identity validation

Receipt compare-and-set, unmapped-SKU claim, admin version update and generic revision update now validate the positive integer record ID and update field budget before dispatch. They reject attempts to replace the numeric identity instead of applying fields that invalidate the subsequent lookup or receipt association. The existing shared 1 MiB field budget applies to these paths. Vendor audit updates already remove identity fields by their established contract.

Permanent mutation regression PASS for rejection on all four specialized entry points. Owned Mongo integration PASS for revision identity-change rejection with the original revision and record still present, followed by a valid revision update and stale-write rejection. Row/read/transaction rollback tests passed again. Arbitrary-query updateWhere, specialized insert/delete operations, index performance and broader domain authorization remain open review items.

## Query-based batch updates

updateWhere now validates fields before dispatch, rejects identity replacement, and runs its Mongo updateMany inside the bounded transaction wrapper. The actual matchedCount is checked before commit; more than 1,000 matches aborts the entire transaction. This avoids relying on a preflight count that can race with new records. Explicit memory checks the matched count before mutation. This controls committed batch size and transaction time, but is not a promise that Mongo examines at most 1,000 documents; query indexes still need measurement.

Owned replica-set tests PASS: attempted update across 10,001 records rejected with DATABASE_MUTATION_LIMIT and zero marker fields persisted; exactly 1,000 matched records committed with 1,000 marker fields persisted. Existing atomic-result/read-limit/rollback scenarios and mutation regression also PASS. Query updates now require transaction-capable Mongo. Current callers clear defaults for receipt/lottable validation; their multi-call default selection workflow is not made atomic by this helper alone and remains a domain review item.

Changed api/mongo-mutation.js, api/mongo.js and scripts/verify-owned-mongo-boundaries.mjs; no configured database was accessed. Whole-platform hardening and release evidence remain incomplete.

## Atomic validation-master defaults and code uniqueness

Receipt and lottable handlers now use saveValidationMaster instead of separately clearing defaults and inserting/updating. The helper accepts only these two modules, validates the mutation fields, serializes same-module saves with a transaction-owned counter write, rechecks code uniqueness and existence against bounded authoritative reads, and commits default replacement and save together. Concurrent transaction retries re-read authoritative state. Fresh record IDs are allocated within the same transaction. Domain conflicts return 409 and missing records 404, including conflicts discovered after the handler precheck. Explicit memory follows the same check-before-change sequence without an await between validation and mutation.

Owned Mongo PASS: simultaneous receipt default saves leave exactly one default; simultaneous same-code creates produce one success and one 409; rejected duplicate-code replacement preserves the previous default. Existing real rollback/result tests passed again. Explicit memory regression covers both receipt and lottable default replacement and duplicate rejection. Syntax and diff whitespace checks PASS.

Changed api/mongo.js, api/receipt-validations.js, api/lottable-validations.js, scripts/verify-owned-mongo-boundaries.mjs and scripts/verify-mongo-mutation-boundary.mjs. Transaction-capable Mongo is required for these saves. The module-scoped serialization preserves the existing legacy storage scope; it does not establish tenant isolation or authorize callers. Preexisting duplicate codes are rejected on conflicting saves rather than silently repaired. Configured production data and credentials were untouched.

## Lottable handler input boundary

Lottable write requests now require a boolean isDefault when supplied. Previously the string "false" selected a default through truthiness. PUT requires a positive safe-integer record identity and cannot fall back to locating the record by its code when no ID is supplied.

scripts/verify-validation-master-inputs.mjs PASS under Node 24.21.0: creates an explicit memory fixture, rejects six malformed default flags and six invalid/missing PUT identities, compares every fixture record unchanged after rejection, and confirms a valid PUT changes the description and clears the default flag. This is handler-level memory evidence, not hosted or configured Mongo verification. Registered as test:validation-master-inputs. Changed api/lottable-validations.js, package.json and the new verifier. Existing valid boolean requests and numeric-string IDs retain compatibility.

## Server-owned insert identities

The generic insert helper previously merged caller fields after the allocated numeric ID, allowing supplied IDs to replace the authoritative identity and create ambiguous duplicate records. It now rejects non-null caller IDs before connecting/writing and merges the allocated ID last. Copies with id undefined remain supported. Counter initialization now reads the highest ID using a single-document query with a 15-second deadline; its counter synchronization update also has an operation deadline.

Explicit-memory regression PASS: duplicate supplied identity rejected and original remains unique. Owned replica-set integration PASS: duplicate supplied identity rejected, original identity remains unique, and 20 concurrent inserts receive 20 distinct allocated IDs. Existing default concurrency and rollback tests also pass. This does not establish uniqueness for historical records or direct database writers; a verified numeric-ID index migration and existing-data diagnosis remain open. No production indexes or configured data were changed.

## Numeric-ID index fixture evidence

Owned executionStats measurement PASS: exact ID lookup examined 10,001 documents without an ID index and 1 document/1 key after a disposable unique ascending ID index; highest-ID descending limit-one lookup examined 1 document/1 key using that index. Duplicate identity insertion rejected with 11000. All prior fixture scenarios passed with the index. Detailed scope and migration limits are in DATABASE_PERFORMANCE_REPORT.md. No configured index was created, and production index rollout remains unverified.

## Real daemon outage/restart and socket classification repair

The first owned daemon-stop test FAIL exposed a raw Node EPIPE error escaping the Mongo connection boundary. isConnectionError now recognizes standard socket/DNS system codes (EPIPE, ECONNRESET, ECONNREFUSED, ETIMEDOUT, ENETUNREACH, EHOSTUNREACH, EAI_AGAIN, ENOTFOUND) so connection.run emits sanitized DATABASE_UNAVAILABLE and records a degraded dependency state. Duplicate-key and query-timeout classifications remain distinct.

The corrected owned test PASS: stop the fresh daemon, application findOne rejects with DATABASE_UNAVAILABLE, storage mode never becomes memory, restart the same owned data directory, recover the same record/value/revision through the existing application connection. The test closes both pools and removes only owned process/data. This is graceful daemon-stop/restart evidence, not power-loss, restore, replica election, receipt projection recovery or hosted outage evidence. Mock regression PASS for every added socket code, degraded state, sanitized message and subsequent reconnection; existing business-error/timeouts checks also pass.

Changed api/mongo-connection.js, scripts/verify-mongo-reliability.mjs and scripts/verify-owned-mongo-boundaries.mjs. Configured Atlas, production records, TLS and authentication were untouched.

## Abrupt owned process-loss recovery

Extended real Mongo campaign PASS for both SIGTERM and SIGKILL: dependency-unavailable read, no memory fallback, daemon restart against its existing owned directory, and recovery of identical committed ID/value/revision. Journaling was not disabled. Cleanup checks both exitCode and signalCode to avoid waiting on an already terminated owned child. This does not cover interrupted commit, host power loss, replication election, hosted recovery or cross-store restore. See CHAOS_RECOVERY_REPORT.md. No configured services were interrupted.

## Crash before transaction commit

Owned integration PASS: write a marker inside mongoDomainTransaction, SIGKILL the owned daemon before commit, preserve the controlled primary error, restart, and verify the marker is absent while committed value/revision remain. Outage reads may return either sanitized unavailable or timeout depending on driver selection state; the permanent test accepts only those 503/504 errors and enforces a 20-second upper bound. The original overly narrow unavailable-only assertion failed and was corrected without changing runtime timeout semantics. Commit acknowledgement loss remains untested. See CHAOS_RECOVERY_REPORT.md.

## WMS zone picker concurrency and bulk atomicity

The legacy WMS zone link handler read an array and wrote a replacement, so simultaneous link requests could lose one addition. It now uses scoped Mongo $addToSet/$pull with an atomic 1,000-link capacity predicate and a 15-second operation deadline. A 200-link bulk import validates all zone identities and capacities, then updates every zone in one bounded Mongo transaction. Legacy non-array link data fails with 409 for migration instead of being silently rewritten. The handler validates positive IDs, bounded picker inputs and known picker membership; this is not a tenant/role authorization policy.

Fresh owned replica-set PASS: concurrent single-zone adds retain both pickers; cross-module ID, legacy string and capacity guards hold; a valid two-zone batch commits; an injected document-validator rejection on the second zone update rolls back the first. Explicit-memory route/parser regressions, TypeScript typecheck, Vite build and diff whitespace checks PASS. No configured Mongo data or indexes were changed. Production query plans, hosted roles, historical zone identity and actual uncertain-commit reconciliation remain open.

Owned query-plan continuation: the transaction's two-ID zone lookup examined 10,032 documents before an ID index and 2 after; requested picker-code lookup examined 10,032 before a partial picker index and 1 after. The route now looks up only requested picker codes with a 1,000-result detection limit. The measured unique generic numeric-ID and partial picker-code index definitions are available behind exact --db, --yes and --scope zone-pickers guards. The injected-client guard test and fresh owned executionStats PASS; no configured index was created. Existing duplicate numeric IDs, historical shapes and configured plan/latency still need diagnosis before rollout.

## Owned document backup/restore evidence

Latest verify-owned-mongo-boundaries.mjs PASS under Node 24.21.0: canonical backup and additive restore into a second fresh owned test database preserved each collection count and every canonical BSON document. The unique numeric-ID index intentionally was absent after restore, matching indexesRestored:false. Full existing owned read/transaction/recovery fixtures passed in the same run. Available disk was roughly 937 MiB before execution, above the 500 MiB guard; cleanup removed only the owned process/data.

This supersedes the prior fresh-fixture backup/restore NOT RUN entry only. Consistent snapshots under writes, index restoration, configured/hosted restoration, cross-store reconciliation and RPO/RTO remain unverified. See DISASTER_RECOVERY_REPORT.md.

## Empty collection restore correction

scripts/mongo-restore.mjs now creates each manifest collection before inserting documents; empty collections were previously omitted. Extended owned verifier PASS for exact collection-name equality, empty collection presence, all BSON comparisons and deliberate corrupt-file refusal before any target collection exists. Offline mongo-safety PASS. Indexes/options remain unrestored and cross-store production recovery remains unverified. No configured data accessed.

## Partial restore failure evidence

Owned integration PASS for duplicate _id in the second restore batch: error 11000, no success report, exactly 500 first-batch documents retained unchanged, and replay into the partial target refused. This verifies explicit partial failure rather than restore atomicity. All prior owned scenarios passed again. See DISASTER_RECOVERY_REPORT.md for remaining recovery limits.

## Receipt history, batch bounds and transaction cursor correction

2026-10-08: `inventory/receipt-bridge.js` staged receipts using an unbounded historical GRN cursor and unchecked numeric coercion/addition. Oversized history could accumulate in memory; malformed or overflowing legacy quantities could invalidate the frozen PO authorization. `runReceiptBridgeBatch` also accepted unchecked limits. The bridge now uses complete-or-error historical reads with the shared 10,000-row/8 MiB budgets, safe quantity accumulation and null-prototype SKU dictionaries. Batch sizes must be safe integers from 1 to 100 before any store access; command pages retain the cumulative byte budget. Counter allocation explicitly requests document results. This preserves existing legacy storage scope; it does not establish tenant ownership for legacy POs/GRNs. Production records were untouched.

The first real oversized-history test FAIL exposed an additional MongoDB 6.21.0 cursor/CSOT defect: transaction getMore received maxTimeMS although a non-awaitData cursor forbids it. `api/mongo-read.js` now supplies a clone of the existing transaction timeout context, retaining its absolute start/deadline without a per-operation timeout override. This uses a driver-internal timeoutContext hook; Mongo driver upgrades require the real multi-batch regression. Session reads remain bounded by the transaction's 60-second CSOT context; no independent 15-second cursor-lifetime promise is made for those reads. Row/byte budgets remain unchanged.

Final Node 24.21.0 PASS: injected read/page/byte/invalid-limit regression; injected session deadline inheritance regression; fresh migrated Mongo replica-set/PostgreSQL receipt suite. Real checks reject a boolean historical quantity, a MAX_SAFE_INTEGER-plus-one aggregate, and 10,001 historical rows; source PO fence, authorization collection and command outbox remain unchanged after rollback. Exactly 10,000 historical rows and a 100-row page succeed across batches, with the original transaction start unchanged. Existing actual PostgreSQL commit-acknowledgement loss, same-event replay, post-commit SIGKILL recovery and both-handler PO limits pass. Owned stores were removed. Syntax and diff whitespace PASS. No configured Atlas, hosted load, historical data repair, tenant/role isolation or approved launch capacity claim follows.

Changed in this continuation: api/mongo-read.js, inventory/receipt-bridge.js, scripts/verify-mongo-read-boundary.mjs, scripts/verify-mongo-session-boundary.mjs, scripts/verify-phase-b-propagation.mjs and this report.
