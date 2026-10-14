# Executive research findings and implementation decision

Research completed within the explicit source, test and access boundaries in [completion audit](completion-audit.md). Application implementation awaits roadmap approval. This is architectural research, not production-readiness certification.

## What was actually inspected

Relocated React/Vite/Express checkout, original and current Git snapshots,159 literal legacy routes/imports,29 migrations, inventory authority and caller transactions, provider observations, inbox/outbox workers, permissions/tenant binding, return receipts, bin audit, telemetry, backup/restore, tests and CI. Public discovery attempted48 repository metadata candidates and triaged24 successful responses;19 distinct upstream repositories have meaningful bounded source analyses,26 upstream mechanism records,61 total evidence records and246 unique retrieved source/test/license/spec files. Retrieval is not reading or execution. GitHub anonymous403/tree failures,404 path corrections and bounded archive stops are logged. No credentials, production service, live provider, remote settings, deployment or push accessed.

## Strongest evidence and comparisons

[Strongest seven](strongest-seven-comparison.md): Saleor, ERPNext, Odoo, Medusa, Vendure, OpenBoxes and pg-boss. Reservations compare ordered stock locks, processing gates, provider-key locking and configuration-dependent strategies. [Ledger/state comparison](ledger-and-state-comparison.md) distinguishes mutable valuation/reposting, stock movements, physical quants and local exact ledger events. [Returns](return-workflow-comparison.md), [audit](audit-history-comparison.md), authorization/standards and retry/ingress comparisons retain test and framework limits. Independent Zehelein outbox and Saleor return/delivery traces expose duplicate-ID policy, client lifetime and commit-to-callback gaps. Tests inspected are NOT RUN unless a specific local result says otherwise.

## Most important findings and current risks

- Keep Central Inventory and its transactional event/balance/reservation/outbox foundation (LOC-001/002/003/007/019). No evidence justifies replacing databases, splitting microservices or adding a broker.
- Return approval has no inspected operation guard or authenticated actor provenance (LOC-005/006). Quantity/replay bounds already exist; strengthen authority without replacing them. Configured exploitability and intended grants remain unverified.
- Receipt/order writers acquire shared SKU locks in different orders. Actual caller paths deterministically deadlock40P01 on owned PostgreSQL; full rollback, stable retry and exact replay passed (LOC-016). This is confirmed availability failure, not demonstrated stock corruption.
- Amazon Listings2021 PATCH limiter starts at10 while current official default is5. Offline actual adapter permits six immediate calls (LOC-021/DOC-008). Account-specific quota and live rejection are unverified; current GET docs conflict is retained.
- Shopify2026-07 already supplies CAS and required idempotency; preserve it. Provider observation, delivery acceptance, queue readiness, complete history, publication acknowledgement and readback are separate proofs (LOC-007/014/015).
- Bin audit completion and real SKU import correctly remain unavailable. Physical lot/serial/pick/pack/return custody cannot be inferred from UI fields or commercial refund states (LOC-009/020).
- Process-local telemetry and sampled OTel are not durable security audit. Held-task visibility, configured restore/replay, index reconstruction and hosted CI remain operational evidence gaps (LOC-013/017/018, UP-025/026).

## Target and priorities

[Target architecture](13-target-architecture.md): authenticated operation/object authority → explicit domain command → existing SQL transaction/ledger/outbox → fenced worker → adapter → durable uncertainty/readback/reconciliation; validated Mongo bridge projections remain separate from authoritative commit. Keep financial, provider, reservation and physical custody states distinct. Preserve strict integer/nonnegative policy and replay identity.

[Ranked roadmap](14-implementation-roadmap.md) contains ten scored proposals. First R-01 return authority/actor; next R-02 shared lock order and R-03 recovery; R-04 provider quota/reconciliation; then reviewed R-05 import and R-06 physical contracts; R-07 operations/audit, R-08 restore/load evidence, R-09 CI/supply chain; R-10 new infrastructure deferred. R-01 priority is a proposed control judgment; runtime severity is not inferred from source alone.

## Verification and limits

Earlier authorized fixes and their isolated typecheck/import/browser/migration results remain in confirmed-defect-validation.json, tied to historical hashes. Fresh research executions: actual PostgreSQL deadlock/retry/replay and offline Amazon limiter reproduction. Current documentation reference/hash/whitespace validation is recorded separately. Upstream suites, configured providers, hosted CI, production load, disaster recovery and full dependency advisory/file-scoped legal clearance NOT RUN or not established. No SLO, RPO/RTO, capacity or compliance claim invented.

Open implementation/owner decisions: intended return operators and warehouse grant policy; physical QC/disposition evidence; catalog import ownership/commit semantics; actual account scopes, quota plans and history completeness; workload/recovery objectives; deployment permissions/retention/key custody. They are explicit future gates, not a request to supply research keywords. Further broad discovery now has diminishing decision value.

## First slice proposed for approval

[first-implementation-slice.md](first-implementation-slice.md) proposes `central_inventory.returns.approve`, server-session actor provenance, a backward-compatible receipt audit migration and full-mounted401/403/foreign-object/replay/rollback tests. No automatic grants, new stock semantics or production actions. The roadmap must be approved before application edits, as required by the latest brief.
