# Return workflows and authorization — expanded comparison

Status: IN PROGRESS. Source code was read at the exact revisions in UP-013 through UP-017. Upstream tests NOT RUN.

| Approach | Entry/permission/object scope | Physical/financial model | Consistency/failure boundary | Test evidence and limit |
|---|---|---|---|---|
| Saleor UP-013 | Base mutation enforces MANAGE_ORDERS; return mutation checks order channel explicitly | Return/refund/replacement fulfillment records, reason and user/app attribution; refund optional | Transaction wraps actions; external refund plugin call is not made atomic by DB wrapper | Named test denies all-permission user scoped to another channel; payment failure tests present/read in part; physical QC/restock/replay still needs trace |
| Medusa UP-014 | Authenticated route derives confirmed_by from actor_id; full RBAC policy separate | Separate normal/damaged actions, partially received status, normal-only stock increment | Parallel workflow steps with inverse-delta inventory compensation under configured locks | Retrieved item-request tests validate missing/inactive inputs, not receive-confirm recovery; no full receive test claim |
| Tryton UP-015 | Company/customer/warehouse-bound model; server ACL path not fully traced | Customer→warehouse input receipt, then input→storage completion; received_by/done_by attribution | Explicit transition graph and move execution; framework transaction/ACL needs trace | General stock module tests retrieved; guessed dedicated return scenario 404; no matched return assertion claim |
| Local LOC-005/006 | Authenticated/configured tenant; no inspected operation permission on approve-receipt | Order/dispatch-bounded receipt, one qc_status approved marker; actor and physical condition evidence incomplete | One PostgreSQL receipt/ledger/timeline transaction and stable replay keys | Existing service tests not refreshed for full permission/QC campaign; current wrong-role full-route test NOT RUN |

Strong recommendation: preserve local cumulative dispatched/received quantity and replay protections while designing operation permission, actor/reason/evidence provenance and disposition-specific stock buckets (R-01/R-06). A return/refund record is not a physical inspection. Saleor is useful for permission plus channel denial; Medusa for damaged versus sellable handling; Tryton for receiving versus storage custody. Their mechanisms differ and must not be copied wholesale.

Financial edge case from Vendure UP-017: a refund with no product lines can still move money. Source checks payment.order channel before calling payment service, rather than relying on line-derived order identity. This illustrates why local object authorization must validate the actual return/order/account/warehouse even when optional detail arrays are empty. Guard metadata and active channel policy remain separate enforcement obligations.

Additional warehouse comparison: OFBiz UP-016 distinguishes ATP from physical QOH and explicit prepare/complete transfer stages. Local LOC-004 is an instantaneous atomic move. Do not describe it as asynchronous goods-in-transit support. OFBiz transaction/locking and tests remain incomplete, so no stronger guarantee claimed.

Next traces: Saleor actual restock and payment idempotency path; Medusa receive-confirm matching tests and workflow checkpoint semantics; Tryton stock RPC/ACL/return scenario plus first-assignment lock behavior; local return full mount with defined permission/warehouse policy. No application code changed.
