# Adversarial test plan

Detailed specifications only unless an existing executed check is explicitly identified. Latest user brief forbids new application implementation until roadmap approval. Proposed paths are not claims of existing files.

Common fixture boundary: generated tenant/account/request identities, independent database connections, deterministic barriers rather than sleeps, synthetic providers and owned disposable stores. No env.js import, configured credentials or production traffic. Assert durable database/event state after failure, not merely HTTP status.

## S01 — Final unit reservation

- Invariant: At most one unit reserved; no negative stock or orphan event.
- Initial state: One tenant/SKU/location, on_hand=1, all blocked buckets zero.
- Concurrent actions/fault injection: Two independent DB connections enter reservation simultaneously; use barriers to hold the first lock through commit.
- Expected final state: One success, one stock conflict; reserved_order=1, on_hand=1.
- Database assertions: One active reservation and one reserve event; event deltas rebuild balance.
- Event/audit assertions: One logical publication effect per committed stock change; loser emits no success timeline.
- Recovery: Repeat winner request key returns duplicate; changed quantity/key payload conflicts.
- Location/feasibility: scripts/verify-reservation-race-postgres.mjs (proposed)
- Evidence: LOC-001, UP-001/004/007

## S02 — Twenty duplicate webhooks

- Invariant: One accepted business effect for same provider/account/message identity.
- Initial state: Mapped synthetic Shopify order, valid raw-body HMAC and unique delivery ID.
- Concurrent actions/fault injection: POST identical raw payload twenty times, including concurrent requests; then replay same ID with changed body and valid HMAC.
- Expected final state: Exact deliveries accepted/deduplicated; changed digest rejected.
- Database assertions: One ci_ingress receipt, one logical order/line and one work item.
- Event/audit assertions: No repeated reservation or alert; duplicate metrics may count receipt attempts.
- Recovery: Replay after worker restart remains duplicate.
- Location/feasibility: scripts/verify-webhook-duplicate-burst.mjs (proposed)
- Evidence: LOC-002, UP-006/009

## S03 — Out-of-order events

- Invariant: Older observations cannot revive canceled/shipped stock effects.
- Initial state: Order has revision R2 or internal aggregate checkpoint 2.
- Concurrent actions/fault injection: Deliver R1 after R2; separately deliver internal sequence 4 before 3.
- Expected final state: Provider view must not regress; internal gap rejected/held until 3 available.
- Database assertions: Checkpoint cannot skip 3; terminal reservation state unchanged by older event.
- Event/audit assertions: Stale/gap is visible without fabricating fulfillment progress.
- Recovery: Replay 3 then 4 advances exactly once; inspect timestamp tie/null policy.
- Location/feasibility: scripts/verify-order-revision-gap.mjs (proposed)
- Evidence: LOC-003/007

## S04 — Cancel races with picking

- Invariant: A unit cannot both be dispatched and released to sellable stock.
- Initial state: One active reservation; proposed physical pick evidence exists only in an isolated approved fixture.
- Concurrent actions/fault injection: Race cancellation with pick/dispatch transition under shared line/order locks.
- Expected final state: One legal transition wins; conflicting action requires explicit recovery.
- Database assertions: No active+consumed/released contradiction; net stock matches winning custody.
- Event/audit assertions: Record losing transition conflict and actor/request identity.
- Recovery: Picked-but-not-shipped outcome requires approved unpick/cancel policy; currently physical workflow contract incomplete.
- Location/feasibility: scripts/verify-cancel-pick-race.mjs (proposed; blocked on physical state contract)
- Evidence: LOC-001/007, UP-004/007

## S05 — External shipment succeeds; local persistence fails

- Invariant: Ambiguous success must never cause blind duplicate shipment or stock deduction.
- Initial state: Synthetic provider accepts one shipment operation with stable request identity.
- Concurrent actions/fault injection: After provider acceptance, inject local update/commit connectivity failure.
- Expected final state: Persist uncertainty if possible; otherwise reconstruct using stable request ID and provider readback.
- Database assertions: At most one ledger consume; attempt identity preserved; no falsely confirmed outcome.
- Event/audit assertions: Timeline distinguishes dispatched externally, unknown local, and reconciled.
- Recovery: Read provider result before resend; unsupported connector must remain unavailable.
- Location/feasibility: scripts/verify-shipment-commit-loss.mjs (proposed; adapter contract required)
- Evidence: LOC-007, UP-003

## S06 — Crash after DB commit before message ACK

- Invariant: Redelivery cannot duplicate committed effects.
- Initial state: Synthetic accepted inbox message and pending task.
- Concurrent actions/fault injection: Kill owned worker after transaction commit and before synthetic queue delete/ACK; redeliver.
- Expected final state: Receipt/event replay yields same result; message eventually acknowledged.
- Database assertions: One receipt/effect/event set; task completion recovers.
- Event/audit assertions: Crash/recovery attempts visible without repeated customer alerts.
- Recovery: Reclaim lease with fencing; stale worker cannot overwrite a later attempt.
- Location/feasibility: scripts/verify-worker-commit-ack-crash.mjs (proposed)
- Evidence: LOC-001/002/007, UP-005/010

## S07 — Partial transfer failure

- Invariant: Atomic local transfer conserves total physical stock.
- Initial state: Source=5, destination=0 for same SKU; requested transfer=3.
- Concurrent actions/fault injection: Inject failure after source event but before destination event/commit.
- Expected final state: Rollback leaves source=5, destination=0; successful retry yields 2 and 3.
- Database assertions: Failure leaves neither transfer leg; success has exactly two paired request-derived events.
- Event/audit assertions: No success audit/publication survives rolled-back movement.
- Recovery: Repeat same request adds no movement; changed destination/quantity conflicts. Separate in-transit transfers are not this workflow.
- Location/feasibility: scripts/verify-transfer-atomicity.mjs (proposed)
- Evidence: LOC-004

## S08 — Adjustment overlaps reservation

- Invariant: Combined committed buckets remain valid; neither writer loses an update.
- Initial state: on_hand=2, request adjustment -1 and reservation 2.
- Concurrent actions/fault injection: Execute both through independent transactions with controlled lock interleavings.
- Expected final state: Either reserve 2 and reject adjustment, or adjust to1 and reject reserve2.
- Database assertions: No reserved sum above on_hand; every successful command has a matching ledger delta.
- Event/audit assertions: Loser logs a conflict without success audit.
- Recovery: Retry after read refresh requires preserved intent/new revision where appropriate.
- Location/feasibility: scripts/verify-adjustment-reservation-race.mjs (proposed)
- Evidence: LOC-001, UP-004/007

## S09 — Extended rate limiting

- Invariant: Backpressure respects provider contract and preserves pending business intent.
- Initial state: Synthetic provider account returns 429 and contract-specific retry headers repeatedly.
- Concurrent actions/fault injection: Advance injected clock across long numeric and HTTP-date Retry-After, restart worker and test two replicas.
- Expected final state: Attempts scheduled no earlier than allowed; no spin/retry storm; operator sees delay.
- Database assertions: Durable next-attempt state survives restart; no mutation duplicated.
- Event/audit assertions: Rate-limit vs terminal/permanent errors separately visible; no credentials in logs.
- Recovery: Recovery drains within approved capacity targets; no invented latency/SLO numbers.
- Location/feasibility: scripts/verify-provider-quota-scheduling.mjs (proposed)
- Evidence: LOC-008, UP-005

## S10 — Cross-tenant access

- Invariant: Authenticated tenant A cannot read/mutate tenant B or infer object existence.
- Initial state: Two synthetic tenants/accounts/locations plus read-only and approving users.
- Concurrent actions/fault injection: Try foreign IDs in URL/body/query; omit tenant; alter warehouse/account ownership.
- Expected final state: Configured tenant mismatch denied; foreign object absent/denied according to approved contract; no effects.
- Database assertions: No foreign events, receipts, balances, credential read or outbox tasks.
- Event/audit assertions: Denied action audit without sensitive object payload.
- Recovery: Refresh/replay remains denied; test full authenticated parent mounts, not middleware alone.
- Location/feasibility: scripts/verify-tenant-object-authorization.mjs (proposed)
- Evidence: LOC-006/012

## S11 — Repeat successful shipment update

- Invariant: Logical dispatch must be idempotent across retries and provider acknowledgments.
- Initial state: Consumed reservation and successful synthetic provider update for request K.
- Concurrent actions/fault injection: Replay K serially/concurrently; also replay with altered lines or package.
- Expected final state: Exact replay returns original outcome; changed intent conflicts.
- Database assertions: One consume event, terminal line and provider evidence association.
- Event/audit assertions: No repeated handover/alert; replay outcome auditable.
- Recovery: If provider has finite key retention, reconcile durable local intent before long-delayed retry.
- Location/feasibility: scripts/verify-shipment-replay.mjs (proposed; adapter contract required)
- Evidence: LOC-001/007

## S12 — Mid-sequence migration failure

- Invariant: Failure is visible; unverified schema never marked successfully verified.
- Initial state: Fresh disposable PostgreSQL and an owned incompatible relation fixture.
- Concurrent actions/fault injection: Race migration runners; inject SQL failure; separately alter recorded checksum and create invalid concurrent-index condition.
- Expected final state: History unchanged on failed sequence; pool reusable; repair/retry succeeds; drift rejected.
- Database assertions: Constraints/business rows preserved; successful history matches SQL; concurrent-index validity checked.
- Event/audit assertions: Sanitized migration failure and reason visible, no secret connection URL.
- Recovery: Use owned repair only; production rollout requires separate migration review. Existing authorized verifier covers concurrency/failure/drift/adoption; invalid-index failure injection still needs targeted proof.
- Location/feasibility: scripts/verify-migration-history.mjs (exists; reviewed/ran during authorized fixes)
- Evidence: LOC-010

## S13 — Opposing caller lock orders

- Invariant: committed receipts/reservations remain atomic; deterministic lock ordering avoids avoidable deadlock churn.
- Initial state: two synthetic SKUs A/B with SKU code ordering opposite internal UUID ordering, same physical location and adequate existing stock.
- Actions: independent receipt and order transactions, barriers after their first parent-SKU locks, then both attempt second lock.
- Expected state: current behavior is an investigation, not a presupposed PASS. If a deadlock occurs, one transaction must abort completely; no partial successful receipt/reservation may remain.
- DB assertions: balances equal committed ledger deltas; no one-leg/one-line committed operation, orphan reservation or duplicate request effect.
- Audit assertions: deadlock/conflict observable without success for aborted work; original request identity retained.
- Recovery: retry only the whole aborted operation with stable identity; prove no duplicate event/alert/publication effect.
- Proposed test location: scripts/verify-cross-writer-lock-order.mjs. Not implemented under research-only policy.
- Evidence: LOC-001/007/016, UP-004/007. This scenario was initially inferred; the execution update below supersedes that status.

S13 execution update: research fixture docs/research/fixtures/lock-order-research.mjs exists and was executed against actual local functions on disposable PostgreSQL. It reproduced 40P01 and passed rollback/retry/replay assertions; see lock-order-reproduction.json. The previously proposed scripts/ path remains unimplemented. No load or hosted result inferred.
