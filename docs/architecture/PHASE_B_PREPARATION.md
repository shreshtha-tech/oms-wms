# Phase B preparation and minimum event scope

Date: 2026-10-05. Preparation only. Phase B has NOT begun; no application module imported, database contacted or harness executed.

## Reviewed decisions

Owner approved D01-D05, D07-D09 and D12. D10 is approved only for the minimum consumed set. D06 direction is approved in stages: receipts, reservations and dispatch first; dispatch authorization/partial-shipment rules remain pending. D11 remains pending owner volumes and recovery requirements. Approval does not establish implemented ownership, measured SLOs or provider permission evidence.

This dated review supersedes the pending-review wording in the historical Phase A artifacts. The 58-event catalog remains a design inventory, not an implementation backlog for Phase B.

## What consumed means

**Exact versioned consumers: 0 of 58.** No `.v1` envelope router/validator is implemented. The table distinguishes existing native propagation inputs (tasks, callbacks or direct propagation calls) from proposed standalone change events. Merely reading a table, updating CRUD metadata or performing an effect inside a command does not make that proposed change event consumed. Source inspection is not executed workflow proof.

**Minimum Phase B scope: 12 existing native flows + 2 D08 bridge events = 14 catalog entries. The other 44 standalone events are excluded.** Adapt only boundaries that need transport/validation; preserve local transactional calls without adding redundant queues. Provider ingress and normalized intake are layers of one flow, not two authorizations to reserve/send. Ledger balance and publish request are likewise one transactional publication chain.

Reservation/release/consume and existing dispatch effects remain inside the included native provider/ledger flow. Their standalone proposed envelopes are excluded. This does not omit idempotency, replay, sequence fencing, all-line rollback, D07 alert repair or the D08 receipt bridge. It does not authorize a new carrier, partial-shipment, transfer, pricing or master-sync implementation. D06 answers must determine first-stage dispatch behavior before building.

### All 58 entries

| Event | Phase B | Existing consumer or reason excluded |
| --- | --- | --- |
| catalog.sku.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| catalog.vendor.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| catalog.customer.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| catalog.transporter.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| catalog.client.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| catalog.partner.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| catalog.channel.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| catalog.location.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| commercial.price.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| commercial.tax.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| procurement.budget.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| catalog.metadata.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| wms.metadata.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| legacy.metadata.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| procurement.purchase-order.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| inbound.asn.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| inbound.receipt.requested.v1 | D08_BRIDGE | api/inbound-create-edit.js; api/inbound-realtime.js; inventory/wms-operations.js — Explicit D08 addition: replace synchronous cross-store receipt sequence with transactional local outboxes, consumer dedupe and committed-result projection. |
| inbound.receipt.result.v1 | D08_BRIDGE | api/inbound-create-edit.js; api/inbound-realtime.js; inventory/wms-operations.js — Explicit D08 addition: replace synchronous cross-store receipt sequence with transactional local outboxes, consumer dedupe and committed-result projection. |
| provider.shopify.order.observed.v1 | EXISTING_NATIVE_FLOW | inventory/ingress.js:20; inventory/workers.js:231 — recordIncomingOrder; processShopifyOrder. Updated orders are observation-only; no new stock semantics. |
| provider.woocommerce.order.observed.v1 | EXISTING_NATIVE_FLOW | inventory/http.js:37; inventory/workers.js:229 — recordIncomingOrder; processWooOrder. Dispatch meaning remains gated by D06/D09. |
| provider.amazon.order.observed.v1 | EXISTING_NATIVE_FLOW | inventory/ingress.js:30; inventory/workers.js:232 — recordIncomingOrder; processAmazonOrder. MFN eligibility and partial-shipment holds preserved. |
| provider.shopify.order.recovered.v1 | EXISTING_NATIVE_FLOW | inventory/shopify-orders.js:25 — Poll calls recordIncomingOrder; observation/alert flow only, no reservation/cancellation task. |
| provider.flipkart.order.observed.v1 | EXCLUDED_STANDALONE_DESIGN | No order adapter/consumer; bounded probe is not intake. |
| report.meesho.order.observed.v1 | EXISTING_NATIVE_FLOW | inventory/meesho-orders.js:48 — Report calls recordIncomingOrder with notify:false; no stock effect or live-feed claim. |
| order.offline.intake.requested.v1 | EXCLUDED_STANDALONE_DESIGN | Business import processor absent; existing routes return 501. |
| order.intake.recorded.v1 | EXISTING_NATIVE_FLOW | inventory/unified-orders.js:73 — Direct transactional routeIncomingOrderAlerts call; no separate current event dispatcher. |
| order.intake.reconciliation-required.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| order.reservation.created.v1 | EXCLUDED_STANDALONE_DESIGN | Reservation is a local ledger effect inside included provider tasks, not a consumed standalone event. |
| order.reservation.released.v1 | EXCLUDED_STANDALONE_DESIGN | Release is a local ledger effect inside included provider tasks, not a consumed standalone event. |
| order.reservation.consumed.v1 | EXCLUDED_STANDALONE_DESIGN | Consume is a local ledger effect inside included provider tasks, not a consumed standalone event. |
| ledger.balance.changed.v1 | EXISTING_NATIVE_FLOW | inventory/ledger.js:32-34 — Direct stock-alert evaluation and durable publish_stock enqueue in ledger transaction. |
| channel.mapping.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| channel.connection.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| channel.stock.publish.requested.v1 | EXISTING_NATIVE_FLOW | inventory/workers.js:228 — publish_stock task consumed by publishStockTask; re-read latest approved mapping/balance. |
| channel.stock.publish.result.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| channel.stock.observed.v1 | EXISTING_NATIVE_FLOW | inventory/workers.js:235-243 — Shopify/Amazon native quantity notifications consumed by recordStockObservation; no ledger writes. |
| provider.woocommerce.product.observed.v1 | EXCLUDED_STANDALONE_DESIGN | Native task is accepted but consumer returns without effect (inventory/workers.js:80). No-op is excluded. |
| stock.policy.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| stock.alert.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| order.alert.queued.v1 | EXISTING_NATIVE_FLOW | inventory/whatsapp.js:98 — Durable ci_order_alert queue consumed by runWhatsAppBatch; D07 purpose/dedupe repair in scope. |
| order.alert.send-result.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| order.alert.delivery-observed.v1 | EXISTING_NATIVE_FLOW | inventory/whatsapp.js:193-199 — Signed native Meta status callbacks consumed by tenant-scoped monotonic status handler. |
| alert.recipient-policy.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| fulfilment.allocation.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| wms.picklist.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| wms.packing.completed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| shipment.dispatch.confirmed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone shipment event consumer. Existing Woo/Amazon deductions are inside the included provider tasks; new dispatch authority awaits D06. |
| shipment.manifest.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| wms.placement.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| stock.transfer.changed.v1 | EXCLUDED_STANDALONE_DESIGN | Immediate transfer command directly posts paired ledger effects; no transfer-change event consumer. New transfer transport excluded. |
| return.case.observed.v1 | EXISTING_NATIVE_FLOW | inventory/ingress.js:22; inventory/http.js:37 — Native refund observations consumed by recordReturn; financial refund never authorizes restock. |
| return.receipt.approved.v1 | EXCLUDED_STANDALONE_DESIGN | Existing QC command directly posts ledger/timeline; no receipt-approved event consumer or Mongo projector. |
| programme.order-associated.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| programme.stock-observed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| catalog.import.committed.v1 | EXCLUDED_STANDALONE_DESIGN | Workbook commit directly writes catalog and optional ledger effects; no import-committed event consumer. |
| accounting.voucher.held.v1 | EXCLUDED_STANDALONE_DESIGN | Encrypted held task has no approved automatic consumer. |
| sync.checkpoint.changed.v1 | EXCLUDED_STANDALONE_DESIGN | No standalone event consumer found. Current CRUD, configuration reads, local command effects or UI/state reads do not constitute consumption of this proposed event. |
| projection.visible.v1 | EXCLUDED_STANDALONE_DESIGN | Current NOTIFY/SSE is a refresh hint; no versioned visible-revision event consumer. |

## Required harness replacement

**Do not run `scripts/run-isolated-mongo-reliability.mjs`.** Replace it during authorized Phase B before any database test. No replacement has been built or run during this preparation.

- Create fresh owned Mongo replica-set and PostgreSQL processes/data directories; every database name ends `_test`. Do not reuse the configured local PostgreSQL instance or existing databases.
- Construct child environments from an explicit minimal allowlist of necessary OS/runtime keys and harness-generated test configuration. Never spread/inherit `process.env`, load `.env`, or retain configured store/provider credentials.
- Generate explicit loopback-only connection URLs and ports. Validate all hosts and database names before creating clients/importing application modules; reject SRV, non-loopback hosts, multiple hosts, host overrides and configured URL fallback. Mongo/PostgreSQL processes bind only loopback. Reject Atlas endpoints regardless of name.
- Test refusal of non-loopback/SRV/Atlas URLs and inherited connection values offline before allowing a test-store connection. Enforce the same guard in each spawned child, not only the parent. Use a network restriction denying non-loopback egress where available; document its verification rather than claiming URL checks alone are an OS firewall.
- Track ownership of processes/data directories/databases. Cleanup can affect only this harness-created stack. A missing binary, replica-set election or transaction capability stops execution; no configured-store/Atlas fallback.

## Questions pending before building

1. D06: what evidence authorizes first-stage dispatch deduction (scanned/operator-confirmed carrier handover, verified provider full-shipment status, or both), and do partial shipments stay blocked until package/line quantity rules exist?
2. D11: SKU count, physical locations, accounts, daily/peak-minute orders, concurrent users and alert recipients per order/bursts.
3. D11: retain or change the provisional 60s publish confirmation, 60s alert acceptance, 120s delivery diagnosis, zero acknowledged-event loss, 5-minute disaster RPO and 60-minute disaster RTO? No volume, throughput or backup guarantee is assumed.

## Verification and stop

PASS: source-only consumer call-site review; 58 unique entries classified; 12 existing native flows, 2 bridge additions and 44 excluded standalone events; machine-readable matrix agrees with this table. No product source changed.

NOT RUN: harness construction, DB startup/connection, migrations, runtime propagation, browser, load, recovery/restore or provider tests. The forbidden Mongo harness was not invoked.

Files touched in this preparation: this report (review/scope/harness gate), event-consumption-matrix.csv (all 58 classifications), and README.md (current review pointer). No change to the historical Phase A diff or source evidence.

Stop before Phase B. Wait for owner `next` and resolve the dependent D06/D11 answers before building affected behavior.

## D06 owner clarification: Stage 1 dispatch

Owner reports that packers do not scan today. The final instruction overrides handover-only authorization for Stage 1: use provider-authoritative mode for all existing channels. This is an explicit owner policy selection, not evidence that every provider adapter or full-shipment contract exists.

- Preserve current Woo `completed` and Amazon MFN full `Shipped` deduction behavior in Stage 1, label its evidence `provider-evidence`, and retain current mapping, custody, idempotency and full-quantity guards.
- Add an audited per-channel `provider-authoritative` setting whose default is off. The owner's explicit Stage 1 selection applies to existing channels; record each enablement and its actor/time/reason. Do not infer support for unavailable provider dispatch adapters or invent credentials, permissions or shipment semantics. An enabled setting alone cannot authorize an unsupported provider effect.
- For channels with provider-authoritative off, provider shipment status creates a review item with an aging timer and does not deduct. The timer duration/escalation is pending D11; do not invent a threshold.
- Handover scanning/closed-manifest authorization is a later stage. Its evidence must include type, operator, time, carrier and AWB/manifest ID. Handover without provider update deducts once and flags the mismatch. Proposed handover idempotency identity is order line plus package/manifest ID, scoped by tenant/order; a later handover must not repeat an already posted provider-authoritative deduction. Before that stage, define correlation between provider deductions and handover identities.
- Partial-shipment observations mark the order partially shipped and hold it for review; no partial deduction is enabled in Stage 1, and outstanding reservations remain reserved. Already committed deductions are never undone by a later partial observation.
- RTO and physical returns use the return receipt/QC flow. They never reverse the original dispatch deduction or restock solely from a provider status.

Proposed later partial-shipment rules (NOT approved or implemented): each package has a stable identity and explicit quantities for each immutable order-line identity; shipped quantities are positive and cumulative committed shipped quantity cannot exceed ordered quantity. Commit package receipt/digest, line totals, reservation consumption and ledger deductions atomically. Same package/line and same digest is a no-op; changed content conflicts. Deduct only confirmed package quantities, leaving the remainder reserved. Release a remainder only through an explicit audited command with actor, reason, exact quantity and expected revision. Returns are separate positive receipt events linked to original dispatched lines and cannot create negative shipped totals. Provider revisions and handover correlation must prevent two evidence paths posting the same goods.

D06 dispatch policy is recorded. D11 volume and SLO/recovery answers remain pending. Phase B remains unstarted until `next`; no channel setting has been changed in this preparation.
