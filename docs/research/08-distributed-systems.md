# Distributed systems

Status: IN PROGRESS. Evidence: LOC-001/002/003/007/008/010 and UP-003/005/009/010/011.

Keep the PostgreSQL ledger and transactional outbox as the default consistency boundary (LOC-001). A DB transaction cannot include an arbitrary marketplace request; at-least-once execution must be paired with stable operation identity, outcome evidence and reconciliation. The local publication path already distinguishes unknown remote state, acknowledged but unread-back, mismatch and confirmed reconciliation (LOC-007). Do not replace that distinction with generic safe retry.

| Mechanism | Place in this project | Evidence and limits |
|---|---|---|
| Pessimistic row locks | Stock authority and quantity-derived transitions | LOC-001; UP-001/004. Hold through commit and use stable multi-object ordering |
| Optimistic version check | Human/configuration edits and authority revisions | inventory/connections.js provider_authority_revision observed; full competing optimistic stock implementation not yet read |
| Transactional inbox | Authenticated provider intake plus accepted observation/outbox | LOC-002. Same message/hash dedupe is distinct from stale revision handling |
| Sequence checkpoint | Internal ordered aggregate effects | LOC-003. A rejected sequence gap needs durable recovery; do not silently drop it |
| Task lease and retry | Existing ci_outbox claim/recovery worker | LOC-007; pg-boss retry tests UP-005. Prove fencing of late workers and exhaustion visibility |
| External compensation | Explicit business reversal with its own identity | Medusa step compensation UP-003; not a distributed rollback guarantee |
| Mutable task queue vs CDC event log | Keep existing queue for current workflows | Debezium SMT UP-011 ignores delete and handles updates specially. Mutable ci_outbox task status changes are not a ready-made immutable event stream |
| Idempotent consumer repository | Compare ownership/failure cleanup | Camel UP-009 pluggable repository does not itself guarantee DB atomicity. Local receipt/effect transaction is stronger for local effects |
| Batch retry | Retry unsuccessful work units only when identity remains stable | Graphile UP-010 reads allSettled results and passes only failed payloads; full release SQL pending |
| Backpressure/circuit breaker | Provider/account/operation admission and persistent scheduling | LOC-008 circuits are process-local; five-second retry cap may under-wait quota windows. Official operation contracts needed |

Adding Kafka, NATS, RabbitMQ, Temporal or Debezium is not justified by source popularity. Their operational cost and migration risk must be weighed against measured requirements. No local throughput target, queue bottleneck, recovery objective or cross-service consumer requirement has been approved or measured, so runtime adoption remains deferred (LOC-001/007 and metadata-only triage).

Next proofs: two workers around lease expiry and provider timeout; task completion recorded after effects; commit-uncertain replay of same request; poisoning and attempts exhausted while diagnostic storage also fails; ordering-gap replay; rate-limit scheduling across replicas. See 17-adversarial-test-plan.md.
