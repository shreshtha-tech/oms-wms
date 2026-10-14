# Target architecture

Status: source-backed research synthesis complete; implementation requires roadmap approval. Scope/unknowns are recorded in completion-audit.md.

Retain React/Vite + Express and the PostgreSQL Central Inventory authority (LOC-001). Keep operational Mongo data ownership explicit, with durable validated bridge events/checkpoints where a business workflow crosses the boundary (LOC-003/004). A bridge is not a cross-database transaction; acceptance and projection completion must be separate observable states.

Proposed command path: authenticated actor → explicit operation permission → tenant/account/warehouse/object binding → validated domain transition and stable request identity → one PostgreSQL transaction for ledger/reservation/projection/outbox → asynchronous worker with attempt ownership → provider adapter → durable acknowledged/unknown/readback/mismatch result → reconciliation. Evidence: LOC-001/002/003/005/006/007/012 and UP-001/003/004/005/009.

Keep separate state dimensions for provider observation, reservation, warehouse custody, financial refund and physical return disposition (LOC-005/007; UP-003/004/007). A signed webhook can describe external state; it cannot itself prove local physical receiving. New physical workflows need explicit states, partial quantities, evidence identity, actor and cancellation/reversal rules before code (LOC-004/005 and UP-002/008).

Extend existing authority boundaries rather than adding parallel writers. A server-owned SKU import should validate/stage uploaded data, expose preview/outcome, enforce idempotent commit and persist trustworthy history; no per-row browser writes (LOC-009). The exact transaction model depends on approved catalog ownership and supported Mongo topology; no fake atomicity promise.

Operational design should build on current bounded logs and job states: durable attempts, backlog age, held uncertainty, stale worker, provider throttling, event gap and reconciliation mismatch, with redacted correlation IDs (LOC-007/008/013). Backup and restore plans must cover PostgreSQL ledger/outbox and Mongo operational data plus key custody under owner-approved RPO/RTO (R-08); no recovery guarantee from source alone.

Runtime additions deferred: Temporal, Kafka, NATS, RabbitMQ, Debezium, a separate authorization service and generalized multitenancy. Reconsider only against measured queue/consumer/workflow/isolation needs. Debezium requires a dedicated immutable event contract if introduced; mutable task status rows do not match its insert-event assumptions (UP-011).

First proposed implementation after approval: R-01 return-approval authorization and provenance, with no new stock semantics. See 14-implementation-roadmap.md for acceptance and boundaries.

Detailed competing models: strongest-seven-comparison.md, ledger-and-state-comparison.md, audit-history-comparison.md, provider-endpoint-contract-review.md, local-receipt-workflow-trace.md and upstream linked traces. Preserve local conflict detection and uncertainty rather than adopt weaker policies from a mature-looking repository.
