# Failure injection report

Campaign checkpoint, 2026-10-08. **PRODUCTION FAILURE GATE: BLOCKED.** Evidence scopes below remain separate; no genuine provider, hosted staging or configured production database fault was injected.

| Boundary | Injection | Observed result | Scope |
|---|---|---|---|
| Mongo bounded reads | 10,001 rows; aggregate bytes above 8 MiB | Explicit DATABASE_RESULT_LIMIT; no truncated success | Injected cursors and fresh real Mongo replica set |
| Mongo bulk update readback | Update fields within 1 MiB; aggregate result above 8 MiB | Real transaction rollback; all 12 original records and absence of payload verified | Fresh owned replica set |
| Mongo query update | 10,001 matched records | DATABASE_MUTATION_LIMIT; zero attempted marker fields persisted | Fresh owned replica set |
| Mongo open transaction crash | Session-owned write followed by SIGKILL before commit | Controlled primary error preserved; uncommitted marker absent after restart | Fresh owned replica set |
| Mongo session cleanup | endSession throws after success or primary failure | Committed result or exact primary error preserved; sanitized telemetry | Injected session |
| Mongo commit uncertainty | UnknownTransactionCommitResult label in both supported representations | Sanitized 503 requires identity-preserving reconciliation | Injected session; real lost-commit-response NOT RUN |
| Mongo default save race | Two concurrent defaults; two concurrent same-code creates | Exactly one default; one duplicate-code winner and one 409 | Fresh owned replica set |
| Mongo rejected replacement | Conflicting code during default replacement | Existing default retained | Fresh owned replica set |
| Mongo malformed mutation | Invalid IDs, identity replacement, excessive fields or ID count | Rejected before write; explicit-memory unchanged assertions | Injected writes and explicit memory; selected real identity checks |
| Mongo dependency outage | Mock failures plus actual owned SIGTERM/SIGKILL daemon stop/restart | Sanitized unavailable state, no memory fallback, same persisted record/value/revision recovered | Mock driver and real owned Mongo; hosted outage NOT RUN |
| PostgreSQL pool exhaustion | Fresh strengthened owned run, pool size 1 and 150 ms acquisition deadline | Sanitized 503; recovery after release | Fresh strengthened owned PostgreSQL run |
| PostgreSQL timeout/backend loss | Fresh strengthened owned run timed statement / terminated backend | Prior update rolled back; later operation recovered | Fresh strengthened owned PostgreSQL run |
| PostgreSQL idle transaction | 150 ms idle timeout after uncommitted write | Server termination, sanitized unavailable error, rollback and pool recovery PASS | Fresh owned PostgreSQL; production default 60 seconds |
| PostgreSQL strengthened harness | ENOSPC/startup and later fixture setup failure | Historical setup failures; current rerun PASS, five checks | Current artifact provides five passing fault checks |
| Signed WhatsApp boundary | Injected provider/DB responses and callback verification | Reliability regression PASS | Mock provider/database; real delivery NOT RUN |
| SQS accept boundary | Valid, rejected and poison messages | Only durably accepted valid message deleted; failures retained | Injected SQS; AWS redelivery/DLQ NOT RUN |

Reproduction: Node 24.21.0; scripts/verify-mongo-read-boundary.mjs, verify-mongo-session-boundary.mjs, verify-mongo-mutation-boundary.mjs, verify-mongo-reliability.mjs, verify-mongo-safety.mjs, verify-validation-master-inputs.mjs and verify-owned-mongo-boundaries.mjs. The owned Mongo runner creates only a fresh loopback database, closes its application pool, terminates its daemon and removes its own temporary data. Its disk preflight can explicitly prevent a run. Fixture execution does not establish launch SLOs.

Remaining required injections include real uncertain commit, owned daemon outage during business projection, PostgreSQL sustained contention, multi-provider isolation, long 429 periods, dropped remote acknowledgements, readback disagreement, worker kill/lease races, webhook/poll overlaps, session revocation during mutation, malicious archive memory pressure, hosted deployment interruption, queue backlog and cross-store restore. Acceptance workloads and recovery targets remain unresolved. See PRODUCTION_HARDENING_RELEASE_GATE.md for the full Part 50 scenario matrix.

Latest owned PostgreSQL campaign: seven checks PASS, including real concurrent bounded publication recovery with SKIP LOCKED, rollback and cross-tenant exclusion. See hardening/postgres-failure-evidence.json and QUEUE_RELIABILITY_REPORT.md for exact scope. Earlier six-check results remain historical. This does not establish full worker/provider recovery or launch capacity.

Receipt cross-store regression — 2026-10-08: run-phase-b-isolated.mjs scripts/verify-phase-b-propagation.mjs PASS under Node 24.21.0 on fresh loopback Mongo replica/PostgreSQL stores with the actual migrated inventory schema. Extended suite rejects 16 malformed confirmation requests across the two receipt handlers (coercible/fractional IDs, boolean/array/blank quantities, null lines and aggregate overflow), then checks zero Mongo GRNs, zero durable domain commands, zero inventory events and zero on-hand quantity. Existing valid confirmation/replay, payload conflict, sequence gap, consumer rollback, Mongo result projection, post-PG-commit SIGKILL recovery and combined two-route PO over-receipt checks also PASS. Post-crash replay retained on-hand 7 without a second posting. Harness-owned services/data removed; configured stores/providers untouched.

This strengthens the recent input repairs from memory-only to actual-store no-effect evidence for these cases and verifies valid receipt propagation compatibility. It does not establish hosted authorization, concurrent end-to-end receipt load, cross-store backup restore, production capacity or approved recovery SLOs.

Owned PostgreSQL current campaign: nine checks PASS including real session advisory-lock backend termination, preserved committed result/data, discarded client, fresh pool recovery and lock reacquisition. Evidence: hardening/postgres-failure-evidence.json. Earlier seven/eight-check entries remain historical. Provider acknowledgement loss, replica election, host failure and hosted recovery remain separately unverified.

Latest owned PostgreSQL evidence is ten checks PASS, now including actual TCP commit acknowledgement loss: explicit uncertainty, no automatic replay and independently verified single committed result. Detailed scope and remaining domain/hosted limits are in CHAOS_RECOVERY_REPORT.md. Earlier nine-check count is historical.

Receipt task lease recovery: fresh Mongo/PostgreSQL fixture PASS for expired claim replay and bounded dead transition after the eighth claimed attempt. A second runner cannot complete under the old claim token. One command replay and one result replay followed durable consumer identity and left authoritative stock unchanged. See QUEUE_RELIABILITY_REPORT.md for source and remaining timing/hosted limits.
