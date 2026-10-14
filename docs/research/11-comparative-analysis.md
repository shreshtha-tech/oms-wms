# Comparative analysis

Status: research synthesis completed within the scope in completion-audit.md. Strongest current comparisons are reservation/allocation and job/inbox semantics; incomplete rows remain explicitly unverified.

| Workflow | Approach A | Approach B | Approach C | Local comparison / recommendation |
|---|---|---|---|---|
| Reservation | Saleor ordered stock row locks and allocations UP-001 | ERPNext Bin/SRE or aggregate gates UP-007 | Medusa provider-key lock plus reservation totals UP-003; Vendure batch row locks UP-004 | LOC-001 parent-SKU lock and exact transitions; retain it and test all writers and caller transactions |
| Stock ledger | ERPNext sorted processing gates and mutable cancellation/repost UP-007 | Vendure movement+locked stock adjustment transaction UP-004 | Odoo physical move/quant model UP-002 | LOC-001 exact event/balance/outbox retained; distinct history/UOM/negative-stock semantics; see ledger-and-state-comparison.md |
| Order state machine | Vendure configurable transition guards and strategies UP-004 | Saleor locked derived status and commercial return records UP-013/024 | Tryton physical shipment transition graph UP-015 | Distinct order/payment/custody layers; preserve local revision/terminal rules and unavailable physical shortcut; no framework replacement |
| Warehouse allocation | Saleor channel/country stock eligibility UP-001 | Vendure location policy and transaction UP-004 | Medusa inspected step chooses location_ids[0] UP-003 | Selection policy and inventory correctness are separate; local mapping is not proven optimization |
| Webhook ingress | Shopify validator/HMAC/header tests UP-006 | Woo sender HMAC/delivery identity UP-012 | Camel repository idempotent consumer UP-009 is a mechanism comparison, not marketplace ingress | Only two marketplace-specific source approaches read; LOC-002 durable inbox already valuable |
| Retry/recovery | pg-boss SQL/retry assertions UP-005 | Graphile partial-batch failures and release-error handling UP-010 | Camel key ownership/completion behavior UP-009 | Preserve local held external uncertainty LOC-007; compare failure classes, not promise exactly-once delivery |
| Multi-tenant authorization | Saleor mutation permission + selected order channel UP-013 | Vendure refund payment-order channel enforcement UP-017 | Frappe type/document/owner/user-permission sharing and Administrator bypass UP-018 | LOC-012 configured tenant binding is not general tenant isolation; retain it and add explicit operation/object/warehouse tests LOC-006 |
| Returns | Saleor commercial return/refund/replacement, distinct from restock UP-013/024 | Medusa normal/damaged receipt and inverse compensation UP-014 | Tryton customer→input receipt then input→storage UP-015 | Preserve local dispatched-quantity/replay bounds; add operation/actor/disposition controls LOC-005/006 |
| Audit logging | Saleor structured order events with nullable actor/app UP-021 | Vendure typed context-actor history with update/delete UP-022 | Frappe configurable diff/version with impersonator fields UP-023 | Business history is not immutable security audit; define explicit approval/denial provenance and retention LOC-005/006/013 |

A recommendation is mature only when the compared mechanism, transaction boundary, configuration limits, tests and local compatibility are understood. Vendure's exactly-one-winner test is constrained to a custom same-transition allocation strategy; Medusa's locking test protects a toy counter and does not independently certify all inventory-service callers. These limits materially change what can be inferred from test presence.

## Expanded returns and authorization comparison

The earlier returns row describes the initial evidence gap. Three distinct source models are now compared in return-workflow-comparison.md (UP-013/014/015), with explicit unmatched-test and framework-policy limits. Vendure refund/channel validation adds a financial object-scope example (UP-017). This closes the absence of competing return source mechanisms, not the full recovery/authorization test audit.

## Inbox and policy follow-up

UP-019 adds an independent TypeScript PostgreSQL same-client handler/completion transaction, NOWAIT locking and late-timeout pool-client tests. Unlike local invalid-command holds, its no-handler branch may mark a message complete; that policy is not appropriate to silently copy. Its setup SQL is destructive and was never executed. Local receipt bridge source/test assertion chain is in local-receipt-workflow-trace.md. Three authorization mechanisms are compared in standards-and-security-control-map.md (UP-013/017/018), with exact ASVS control IDs rather than broad compliance claims.

Linked workflow detail now includes [Saleor return/refund/delivery](saleor-return-workflow-trace.md) and [independent PostgreSQL storage/polling/completion](postgres-outbox-workflow-trace.md). After-commit callback, transactionally stored message and remote mutation have different crash boundaries. Silent duplicate-ID acceptance is weaker than local canonical-digest conflict rejection.
