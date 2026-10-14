# Phase B implementation and evidence checkpoint

Date: 2026-10-07. Scope: the 12 existing native propagation flows identified in `PHASE_B_PREPARATION.md`, the two D08 receipt envelopes, and D06/D07 safety repairs. This is a checkpoint, not a Phase B exit or a production-readiness claim. D11 traffic volumes and recovery budgets remain pending.

## Implemented boundary

- The two D08 events, `inbound.receipt.requested.v1` and `inbound.receipt.result.v1`, have closed runtime envelope checks. Mongo stages the GRN, immutable PO receipt authorization, and `_domain_outbox` entry in one replica-set transaction. PostgreSQL consumes with tenant/event digest and aggregate-sequence receipts, applies the existing ledger in one PG transaction, and writes `ci_domain_outbox` with the result. Mongo projects that result with an inbox receipt and GRN status in one transaction. The worker polls both durable outboxes; change streams are not used for business dispatch.
- The native provider/order/ledger/publish/alert flows remain native; the 12 corresponding proposed `.v1` catalog events are **not** falsely labelled runtime schema consumers. Their existing task and direct-call paths were audited in `PHASE_B_PREPARATION.md`. Scoped repairs add alert claim dedupe, packing readiness after all reservations, SQS poison isolation, retry jitter, and a safer Shopify poll high-water mark.
- Existing Woo `completed` and Amazon MFN full `Shipped` deduction remains for preexisting accounts via a one-time, audited Stage 1 provider-authoritative cutover. Newly created accounts default off. When off, a full provider shipment produces an aged review record without stock deduction; an authenticated audited setting change can enable it. A posted deduction has `provider-evidence` tied to the account/order. Amazon partial shipment is review-only and keeps the remainder reserved. Operator handover scan/manifest posting and partial package deductions remain outside this stage.

2026-10-09 scope correction: the one-time migration now grants Stage 1 authority only to existing WooCommerce/Amazon accounts. A new idempotent migration removes an old automatic grant from unrelated platforms only when its current revision still matches the original migration audit; later explicit operator decisions remain intact. The restored local fixture contained two Shopify accounts and one Flipkart account, all of which stayed off. Fresh two-store dispatch tests retained the existing Woo/full-shipment behavior and Amazon partial-shipment hold. Configured production migration remains unrun.

The runtime authority toggle now requires `central_inventory.provider_authority.manage` in the authenticated user's configured permissions and refuses enable requests for unrelated platforms. Fresh two-store tests cover missing permission, foreign tenant account, unsupported platform and stale revision alongside the authorized dispatch path. No configured operator permission policy or hosted account was changed.
- Both inbound screens now treat HTTP 202 as queued, retain the request identity, poll the authoritative inbound row, and show committed only after the Mongo projection reports committed. An interrupted refresh leaves the pending request visible for later recovery.

## Isolated verification

| Check | Result | Boundary |
| --- | --- | --- |
| `node scripts/verify-phase-b-guard.mjs` | PASS | Offline rejection of non-loopback/SRV, wrong `_test` names and override targets. |
| `node scripts/run-phase-b-isolated.mjs` | PASS in earlier run | Fresh native single-node Mongo replica set and PG processes, `_test` names, transaction abort/commit, change-stream resume token and PG rollback. |
| `node scripts/run-phase-b-isolated.mjs scripts/verify-phase-b-propagation.mjs` | PASS on 2026-10-07 | Two inbound routes, atomic staging, duplicate/digest conflict, sequence gap, PO quantity limit, post-PG-commit child `SIGKILL`, result replay and one physical receipt. |
| `node scripts/run-phase-b-isolated.mjs scripts/verify-phase-b-dispatch.mjs` | PASS on 2026-10-07 | One-time existing-account cutover, new default off, review with no deduction, audited toggle, provider evidence, alert after reservations, Amazon partial-shipment reservation hold/full-status conflict and migration rerun safety. |
| `node scripts/verify-phase-b-sqs.mjs` | PASS | Synthetic poison message does not abort later batch items; only durable accepts are acknowledged. |
| TypeScript `tsc --noEmit`, Vite production build, JS syntax, `git diff --check` | PASS | Static/build checks; no browser or hosted service claim. |
| JSON Schema Draft 2020-12 meta-validation and 58 catalog-branch alignment | PASS | Design schema integrity, not full runtime validation of the other 56 events. |

The replacement harness creates fresh owned loopback processes and databases named `_test`; it constructs a child environment from a small allowlist, preloads an outbound non-loopback socket guard before application imports, and cleans up only its own temporary stack. Initial sandboxed `initdb` was denied; the same test was rerun through the approved escalated command and passed. The forbidden `scripts/run-isolated-mongo-reliability.mjs` was never invoked. No Atlas, configured database, provider, Render or deployment request was made.

## NOT RUN / remaining risk

- p50/p95/p99 event-to-visible distributions and capacity against ADR-003: D11 volume/workload and recovery targets are still pending. One isolated happy-path fixture is not a latency sample set. Browser DOM revision timing, provider readback, Meta acceptance/delivery, disaster RPO/RTO, restore and host loss are NOT RUN.
- Live-provider evidence is pending. Partial package and per-line quantity rules are proposals, not approved execution paths. Provider-authoritative for unsupported providers does not create a new adapter.
- The receipt bridge uses durable polling. Change-stream capability and token resume were proved on the local replica set, but the bridge has no change-stream cursor to lose; Atlas tier capability is not inferred from that local test.
- Generic versioned adapters for the 12 native flows are deliberately unimplemented. The Phase B minimum-scope decision preserves their existing contracts; review is needed before claiming a common `.v1` runtime layer.
- Session authentication guards the provider-authority toggle. Fine-grained operator roles remain Phase H work. The Stage 1 audit records the actor/reason/revision but is not evidence of role authorization.

## Review boundary

No production data, external connection, commit, push or deployment was changed. Do not start Phase C from this checkpoint. Resolve D11 workload and recovery targets, then finish scoped latency/fault evidence and the remaining Phase B audit before an exit claim.

## Files changed in this Phase B checkpoint

- Receipt transport, validation and storage: `api/inbound-create-edit.js`, `api/inbound-realtime.js`, `api/mongo.js`, `inventory/receipt-bridge.js`, `inventory/domain-events.js`, `inventory/wms-operations.js`, `inventory/db.js`, `db/migrations/020_domain_event_receipts.sql`, `docs/architecture/event-catalog.json`, `docs/architecture/event-schemas.json`.
- Native propagation and dispatch safety: `inventory/workers.js`, `inventory/connections.js`, `inventory/order-alert-routing.js`, `inventory/whatsapp.js`, `inventory/sqs-worker.js`, `inventory/shopify-orders.js`, `scripts/inventory-amazon-sqs.mjs`, `db/migrations/021_alert_once_and_partial_review.sql`, `db/migrations/022_provider_dispatch_authority.sql`.
- Runtime/UI integration: `scripts/inventory-worker.mjs`, `server.js`, `src/eretail/modules/InboundCreateEdit.tsx`, `src/eretail/modules/InboundRealtime.tsx`.
- Isolated harness and fixtures: `env.js`, `scripts/lib/isolated-stack-guard.mjs`, `scripts/isolated-stack-preload.mjs`, `scripts/run-phase-b-isolated.mjs`, `scripts/verify-phase-b-stack.mjs`, `scripts/verify-phase-b-guard.mjs`, `scripts/verify-phase-b-propagation.mjs`, `scripts/phase-b-receipt-crash-child.mjs`, `scripts/verify-phase-b-dispatch.mjs`, `scripts/verify-phase-b-sqs.mjs`.
- Documentation: this report and `docs/architecture/README.md`. Some listed files were already present from earlier Phase B work; the current worktree remains uncommitted and contains preexisting changes outside this list. Use `git status` and a scoped diff for review; do not infer a clean base from this checkpoint.
