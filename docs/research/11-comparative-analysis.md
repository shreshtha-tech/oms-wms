# Comparative analysis

Status: IN PROGRESS. Strongest current comparisons are reservation/allocation and job/inbox semantics; incomplete rows remain explicitly unverified.

| Workflow | Approach A | Approach B | Approach C | Local comparison / recommendation |
|---|---|---|---|---|
| Reservation | Saleor ordered stock row locks and allocations UP-001 | ERPNext Bin/SRE or aggregate gates UP-007 | Medusa provider-key lock plus reservation totals UP-003; Vendure batch row locks UP-004 | LOC-001 parent-SKU lock and exact transitions; retain it and test all writers and caller transactions |
| Stock ledger | ERPNext backdated valuation/reposting source retrieved, partial reading | Vendure stock movement record with atomic stock update UP-004 | OpenBoxes transaction service only partially traced UP-008 | LOC-001 event/balance/outbox authority present; full three-way immutable-ledger comparison incomplete |
| Order state machine | Vendure configurable transition/allocation test UP-004 | Medusa step/compensation UP-003 | Saleor allocation is not a full order state machine UP-001 | Full competing transition traces missing; no replacement recommendation |
| Warehouse allocation | Saleor channel/country stock eligibility UP-001 | Vendure location policy and transaction UP-004 | Medusa inspected step chooses location_ids[0] UP-003 | Selection policy and inventory correctness are separate; local mapping is not proven optimization |
| Webhook ingress | Shopify validator/HMAC/header tests UP-006 | Woo sender HMAC/delivery identity UP-012 | Camel repository idempotent consumer UP-009 is a mechanism comparison, not marketplace ingress | Only two marketplace-specific source approaches read; LOC-002 durable inbox already valuable |
| Retry/recovery | pg-boss SQL/retry assertions UP-005 | Graphile partial-batch failures and release-error handling UP-010 | Camel key ownership/completion behavior UP-009 | Preserve local held external uncertainty LOC-007; compare failure classes, not promise exactly-once delivery |
| Multi-tenant authorization | Medusa Enterprise exclusions documented UP-003 | Vendure context/channel source partially read UP-004 | Third complete implementation not yet read | LOC-012 is single configured tenant; returns operation guard gap LOC-006 requires design review |
| Returns | ERPNext delivery cancel restores reservation UP-007 | Medusa generic compensation is not return workflow UP-003 | Third return implementation missing | LOC-005 has dispatch-bounded restock; insufficient upstream comparison; do not fill with weak analogies |
| Audit logging | Debezium trace/event headers UP-011 are not an audit policy | OpenBoxes timestamps UP-008 are not an immutable audit trail | Full third implementation missing | Local ledger/timeline evidence is useful but actor/approval/retention/access policy incomplete LOC-005/006 |

A recommendation is mature only when the compared mechanism, transaction boundary, configuration limits, tests and local compatibility are understood. Vendure's exactly-one-winner test is constrained to a custom same-transition allocation strategy; Medusa's locking test protects a toy counter and does not independently certify all inventory-service callers. These limits materially change what can be inferred from test presence.

## Expanded returns and authorization comparison

The earlier returns row describes the initial evidence gap. Three distinct source models are now compared in return-workflow-comparison.md (UP-013/014/015), with explicit unmatched-test and framework-policy limits. Vendure refund/channel validation adds a financial object-scope example (UP-017). This closes the absence of competing return source mechanisms, not the full recovery/authorization test audit.

## Inbox and policy follow-up

UP-019 adds an independent TypeScript PostgreSQL same-client handler/completion transaction, NOWAIT locking and late-timeout pool-client tests. Unlike local invalid-command holds, its no-handler branch may mark a message complete; that policy is not appropriate to silently copy. Its setup SQL is destructive and was never executed. Local receipt bridge source/test assertion chain is in local-receipt-workflow-trace.md. Three authorization mechanisms are compared in standards-and-security-control-map.md (UP-013/017/018), with exact ASVS control IDs rather than broad compliance claims.
