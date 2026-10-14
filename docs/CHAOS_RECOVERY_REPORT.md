# Chaos recovery report

Campaign checkpoint, 2026-10-08. **PRODUCTION CHAOS/RECOVERY GATE: BLOCKED.** New evidence uses a fresh owned loopback Mongo replica set and synthetic records. Configured databases, genuine providers and hosted services were not interrupted.

## Actual Mongo process-loss campaign

Command: Node 24.21.0 scripts/verify-owned-mongo-boundaries.mjs. Single-node replica set, default journaling, fresh mongo_boundaries_test database, no inherited configured credentials. Sequence:

1. Commit a business record and revision update; run transaction rollback, default-concurrency and identity assertions.
2. Send SIGTERM to the owned daemon and wait for process exit.
3. Read through the existing application connection: DATABASE_UNAVAILABLE; mode never becomes memory.
4. Restart the daemon against its same owned data directory. Existing application connection recovers the same ID, business value and revision 1.
5. Repeat with SIGKILL and verify the same unavailable/recovery invariants.
6. Close application and direct driver pools, stop the owned daemon and remove only its temporary data.

**PASS:** graceful shutdown recovery and abrupt process-loss recovery. The abrupt-loss read awaited server selection before the sanitized outage result. No launch recovery target is approved, and this run did not calculate recovery-duration distributions or claim an RTO. The process had already acknowledged the record writes; the experiment does not establish interrupted-commit certainty, unacknowledged-write durability, host power-loss recovery, election resilience or restore correctness.

The original graceful-loss attempt failed because a raw EPIPE escaped the connection classification. api/mongo-connection.js now classifies socket/DNS codes as dependency failure, with permanent mock regression coverage and passing actual restart tests. This repair preserves business/constraint errors and the separate query-timeout classification.

## Remaining required campaign

Worker kill during claim, dispatch, remote acceptance, local commit and projection; simultaneous workers and lease expiry; provider blackout/20x latency/20-minute 429; webhook/poll races; PostgreSQL slow/terminated backends and pool saturation; replica election and real commit acknowledgement loss; backlog growth and drain; cross-store backup/restore with external reconciliation; hosted deployment restart. Each must verify authoritative business invariants, bounded resources, audit records and recovery against approved workload/RPO/RTO. Current absence of these results blocks the production gate. See PRODUCTION_HARDENING_RELEASE_GATE.md.

## Open-transaction crash continuation

PASS on a fresh owned replica: mongoDomainTransaction updates the committed fixture record with an uncommitted marker using its session, then the test kills the daemon before commit and throws a controlled primary error. The transaction wrapper preserves that exact error. After restart, the record retains its committed value/revision and the marker is absent. Thus this run establishes rollback/recovery of a write interrupted before commit, distinct from a commit accepted with its acknowledgement lost, which remains NOT RUN.

The first continuation failed the test's overly narrow expectation that every stopped-daemon read must be DATABASE_UNAVAILABLE; the driver can instead consume its operation deadline and return sanitized DATABASE_TIMEOUT while selecting a server. The updated assertion accepts only these two sanitized 503/504 outcomes and requires the outage read to finish within 20 seconds (15-second operation budget plus scheduling allowance). It still rejects successful/empty fallback results and verifies exact post-recovery data. The corrected full run PASS. No production RTO follows from this fixture bound.

## PostgreSQL commit acknowledgement loss

2026-10-08 owned PostgreSQL campaign PASS, ten checks. verify-postgres-commit-loss.mjs places the actual pg driver behind a harness-owned loopback TCP proxy. After dispatching COMMIT, the proxy suppresses response frames, observes the server CommandComplete COMMIT message, then closes both sockets before the driver receives acknowledgement. The real transaction wrapper reports DATABASE_COMMIT_UNCERTAIN (postgresql, 503), never successful completion, and invokes its callback exactly once. A separate direct connection verifies exactly one committed fixture record with value 77. Rollback on the lost connection fails explicitly as cleanup without replacing the uncertainty classification. Proxy/client/pool and owned daemon/data are closed/removed.

This supersedes the prior NOT RUN limitation for actual PostgreSQL commit acknowledgement loss in this controlled transport window. It does not establish domain-specific same-identity reconciliation for every mutation, receipt result-outbox recovery through this fault, Mongo commit loss, replica election, host failure or hosted fault handling. No configured service or provider was interrupted. The proxy uses plaintext loopback test traffic; configured TLS was not changed.

Receipt commit-loss reconciliation: extended fresh migrated propagation suite PASS using the same loopback TCP proxy on consumeReceiptCommand's actual transaction connection. The server completes COMMIT while its acknowledgement is dropped; consumer reports DATABASE_COMMIT_UNCERTAIN. Reconsuming the identical event via the normal pool returns duplicate:true from the durable consumer receipt. Authoritative state contains exactly one receipt event and on-hand 2, with the existing result outbox projected into Mongo committed status. Remaining suite checks pass: changed payload/sequence rejection, additional receipt, post-commit SIGKILL recovery and combined PO limit. No second stock movement occurs on retry.

This verifies same-event receipt reconciliation after PostgreSQL acknowledgement loss, beyond the earlier generic committed-record test. It does not prove every domain's identity/recovery contract, hosted network faults, Mongo commit acknowledgement loss or cross-store restore. The fixture temporarily supplies the consumer's pool connection from the owned proxy and restores the original connect function afterward; application code requires no fault-injection switch. Configured stores/providers untouched.
