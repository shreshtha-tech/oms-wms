# Prioritized implementation roadmap — provisional

Status: IN PROGRESS. Latest brief requires roadmap approval before any further application implementation. Earlier confirmed fixes remain documented separately. Recommendations below map to evidence; final prioritization awaits remaining competing-source and failure-history work.

Engineering scores are ordinal judgments (1 low, 5 high), not measured business targets. Columns: business criticality B, correctness C, security S, reliability R, complexity X, compatibility K, migration risk M, testability T, maintenance cost O, evidence quality E. High X/M/O are costs. Evidence quality is scoped; it does not imply runtime certification. Ranking favors critical correctness/security and compatible, testable changes rather than a numeric aggregate that could hide risk.

| ID | Priority | Improvement | B/C/S/R/X/K/M/T/O/E | Evidence |
|---|---|---|---|---|
| R-01 | P0 provisional | Return approval permission, object/warehouse scope and actor/inspection provenance | 5/5/5/4/2/5/2/5/2/4 | LOC-005/006/012, DOC-004/005 |
| R-02 | P1 | Complete shared stock-writer and state-transition adversarial coverage | 5/5/3/5/3/5/1/5/2/4 | LOC-001/003/004/007, UP-001/003/004/007 |
| R-03 | P1 | Prove worker ownership, ACK-gap replay and external uncertainty recovery | 5/5/3/5/3/5/2/5/3/4 | LOC-002/007, UP-005/009/010/011 |
| R-04 | P1 | Per-provider contract, history/reconciliation and quota scheduling | 5/5/4/5/4/5/2/4/4/3 | LOC-008/014/015, DOC-001/002/003, UP-006/012 |
| R-05 | P1 | Real server-owned SKU intake with durable truthful outcomes | 4/5/3/4/4/5/3/5/3/4 | LOC-009; approved import authority contract still required |
| R-06 | P1 if business requires | Define and implement physical pick/pack/return/transfer custody contract | 5/5/4/5/5/4/4/4/4/3 | LOC-004/005/007, UP-002/007/008 |
| R-07 | P2 | Durable operational correlation, backlog/uncertainty dashboards and privacy controls | 4/3/4/5/3/5/2/4/3/3 | LOC-007/008/013 |
| R-08 | P1 release evidence | Owned restore/recovery and approved workload tests | 5/5/4/5/4/5/2/4/4/2 | LOC-001/003/010/013; evidence gap itself prevents readiness claim |
| R-09 | P2 | Hosted CI/security and supply-chain policy validation | 4/4/5/4/3/5/1/5/3/3 | LOC-011; complete versioned license/advisory review still needed |
| R-10 | P3 deferred | Broker/CDC/workflow/auth-service additions only for demonstrated need | 2/3/3/3/5/2/5/3/5/2 | UP-003/005/009/010/011 and objective triage |

R-01 matters because a user authenticated for viewing orders should not thereby receive authority to restock physical inventory; quantity integrity and authorization answer different questions. Source shows no route operation guard, but exploitability, intended grants and warehouse model remain unverified (LOC-006; DOC-004/005). Proposed slice: add a narrowly named capability to the existing allowlist, enforce it before DB work, bind actor from authenticated session, validate tenant/object/warehouse association and persist minimal reason/evidence provenance. Do not automatically grant it to existing accounts or infer roles from UI. Preserve ledger and dispatched-quantity bounds (LOC-001/005). Acceptance: anonymous 401; authenticated ungranted 403 before effects; foreign object denied; authorized exact replay stable; altered replay 409; one event/receipt/audit result. Existing clients/configuration impact must be reviewed in roadmap approval.

R-02/R-03 matter because tests can miss the exact caller boundary or commit/ACK window. Vendure's custom same-transition test and Medusa's separate locking/provider tests demonstrate why full-chain proof is necessary (UP-003/004). Execute deterministic owned-store cases from 17-adversarial-test-plan.md before claiming production correctness.

R-04 matters because the official provider contracts do not promise complete ordered webhook delivery, pagination completeness from one page, or a single account-wide quota (DOC-001/002/003). Fix concrete adapter gaps only after exact contract/version and sanitized evidence review; do not enable stock writes through observation setup.

R-05 preserves the current honest 501 until real server validation/commit/history exists. Agree file/content bounds, schema/attribute validation, catalog ownership, partial-vs-atomic semantics, transaction topology, idempotency and rollback before coding. No browser row loop or client-reported processed counts.

R-06 cannot be implemented from a label such as Picked or QC Approved. Approve physical evidence and partial-unit/condition/custody transitions first; no generic stock mutation shortcut. R-08 is release-critical proof, not evidence of a currently reproduced backup defect. Workload, retention, RPO and RTO must be owner-approved.

Unresolved research: complete 10 end-to-end workflows; further ERP/WMS/returns/authorization sources; exact fix PRs; ASVS/OpenAPI/OTel/supply-chain primary implementation evidence; all applicable marketplace contracts; final version/license match and document consistency audit. This roadmap is not yet the final approval request.

R-02 refinement (LOC-016, INFERRED): test receipt SKU-code ordering against provider worker internal-ID ordering using a deliberately inverted mapping before selecting a shared lock-key order. Preserve canonical payload/event ordering if changing execution lock order later; request digest stability is a separate contract. No application edit made.

R-03 refinement (UP-019, LOC-019): explicitly test a timeout that fires after COMMIT/client release and a timeout whose rollback queues behind a successful COMMIT. Late observers must not operate on a pooled connection reused by another request. Preserve local unknown-commit outcomes and claim-token fencing. ASVS/OpenAPI mappings for R-01/R-07/R-09 are in standards-and-security-control-map.md (STD-001/002); no new dependency is recommended.
