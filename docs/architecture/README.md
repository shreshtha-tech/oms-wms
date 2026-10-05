# Phase A: Ownership and event-contract review

Date: 2026-10-05. DESIGN ARTIFACTS COMPLETE; review decisions recorded in [Phase B preparation](PHASE_B_PREPARATION.md). D06 details and D11 remain pending. No Phase B implementation or database execution has begun.

Assumptions: use the current worktree as source truth, preserve all existing changes, and perform Phase A as a documentation-only static audit. Do not contact Atlas/configured databases, import application modules (which may load `.env` and connect), run migrations/seeds, commit, push or deploy. Existing tests/reports are source pointers, not fresh runtime evidence. Owner-supplied Atlas-tier statements remain unverified until the permitted documentation/sanitized-fact gate in a later phase.

Read these artifacts together:

| Artifact | Purpose |
| --- | --- |
| [ADR-001](ADR-001-systems-of-record.md) | Current/proposed system-of-record rules, permitted domain writes, 12 explicit decisions D01–D12 and later disposable-stack prerequisite. |
| [Ownership matrix](ownership-matrix.csv) | 42 entity groups: current/proposed authority, actual writer entrypoints, readers/caches, ownership flags, proposed write permissions and source references. |
| [Storage inventory](storage-inventory.md) | 66 Mongo collection names, 45 PG tables and 75 literal generic module/entity partitions with source call sites; flags every multiple-writer/no-owner candidate without pretending guarded branches execute. |
| [ADR-002](ADR-002-event-contracts.md) | Real transport boundaries vs proposed envelope, ordering, idempotency, retry/DLQ/replay rules and no-dual-write topology. |
| [Event catalog](event-catalog.md) / [machine catalog](event-catalog.json) | 58 proposed v1 events with aggregate/key, schema, idempotency, producer/consumer, current native task/row contract and retry/ordering policy. |
| [Event schemas](event-schemas.json) | 36 typed payload definitions, one discriminated event branch per catalog name. Design schemas only; runtime validation is not implemented. |
| [ADR-003](ADR-003-SLOs-and-recovery.md) | 16 measurable flow latency targets plus draft stock-publish lag, alert acceptance/delivery, loss/RPO/RTO, availability and retention budgets for owner approval. |
| [Evidence and exit audit](PHASE_A_EVIDENCE.md) | Reproducible commands/results, PASS/FAIL/NOT RUN, residual risks, every file touched and explicit phase stop. |
| [Source evidence](source-evidence.json) | 250 source-file hashes and exact literal Mongo/SQL call sites, no database content or credentials. |
| [Complete additions diff](PHASE_A.diff) | Every Phase A documentation addition, excluding this diff file itself; no implementation diff. |

Proposed healthy targets include ≤60s confirmed stock-publish lag, ≤60s Meta acceptance and ≤120s delivered receipt, with declared traffic/provider eligibility limits. These are NOT measured or accepted. Source facts reveal several missing contracts, including master identity bridges, a durable Mongo origin outbox, general consumer receipts, full WMS lifecycle and Flipkart order intake.

Phase A review gate: approve or amend D01–D12 and the SLO budgets; say `next` only when authorizing Phase B. A bare `next` authorizes the next phase but does not silently resolve unspecified ownership/provider contracts. Reconcile any remaining decisions before dependent implementation; independent permitted stack work can proceed only after that phase is authorized. No source feature is described as production ready, synchronized, populated or latency-verified.

Current scope: [all 58 consumption classifications](event-consumption-matrix.csv) and [minimum Phase B scope, approvals and harness requirements](PHASE_B_PREPARATION.md). Historical pending-review statements below describe the original Phase A stop; the dated preparation records the subsequent owner review.
