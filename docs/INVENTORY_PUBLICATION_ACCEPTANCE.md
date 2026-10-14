# Inventory publication acceptance

Assessment: 2026-10-08. This is a source and disposable-database acceptance record. It does not enable a provider or establish real-provider, hosted, staging, capacity or production evidence.

## Contract implemented

Each durable `publish_stock` outbox command now keeps its own sanitized publication evidence. Before an external mutation, the worker persists the provider/account context, internal SKU and location, provider SKU/listing/location, pack size, source ledger event where present, expected absolute quantity, Agon request fingerprint and remote-attempt timestamp. The request fingerprint is Agon correlation evidence; it is not claimed as provider-supported idempotency for adapters that do not offer that feature.

Acknowledgement is recorded separately from independent readback. A task is `RECONCILED` only after a readback matches the expected quantity. A provider response followed by a failed readback is `READBACK_PENDING`; a lost response is `UNKNOWN_REMOTE_STATE`; a readback that differs from the attempted quantity is `MISMATCH` and remains held for operator reconciliation. Existing per-mapping serialization prevents a later write from crossing an unresolved command. Historical mapping values are retained on the outbox command so later mapping edits do not rewrite the attempted identity.

The Central Inventory publication view now exposes command state, ledger event, mapping snapshot, attempt target, Agon request fingerprint, provider response reference when the adapter supplies one, acknowledgement time, command readback and reconciliation result. Provider response bodies and credentials are not exposed.

## Evidence

| Check | Result | What it proves | What it does not prove |
|---|---|---|---|
| `npm run test:stock-publication-isolated` | PASS on 2026-10-08 in fresh owned loopback PostgreSQL `_test` databases, removed after each run | Simulated Shopify, WooCommerce and Amazon paths cover provider acceptance followed by lost response, unknown-state hold, independent matching readback, worker-lease crash, mismatch quarantine and no blind resend. The added case covers a received Shopify acknowledgement followed by unavailable readback, then readback-only recovery without another mutation. Publication snapshots retain source event, SKU/location, pack, expected quantity and request identity. | Current provider API behavior, seller permissions, account mappings, provider idempotency/CAS guarantees, hosted scheduling, or real provider acceptance. |
| `scripts/verify-inventory-publish-order.mjs` through the isolated runner | PASS on 2026-10-08 | Two durable same-mapping publication commands serialize and the final absolute quantity reflects the later reservation; provider drift is detected and queued for correction. | Multi-host deployment timing, provider eventual consistency or a production traffic race. |
| `npm run typecheck` | PASS on 2026-10-08 | Frontend/API publication evidence fields typecheck. | Runtime or hosted UI behavior. |
| `git diff --check` and JavaScript syntax checks | PASS on 2026-10-08 | Edited files have no whitespace errors or syntax parse errors. | Business semantics outside the listed integration fixture. |
| Real provider write/readback, staging worker recovery, timeout-after-success, load and DR | NOT RUN | Nothing. | All real-provider, staging, production-capacity and recovery claims. |

## Capability status

| Provider | Source path | Disposable test | Configured account | Real provider | Staging | Production enabled |
|---|---|---|---|---|---|---|
| Shopify | IMPLEMENTED | TESTED | NOT VERIFIED | NOT RUN | NOT RUN | NO |
| WooCommerce | IMPLEMENTED | TESTED | NOT VERIFIED | NOT RUN | NOT RUN | NO |
| Amazon MFN | IMPLEMENTED | TESTED | NOT VERIFIED | NOT RUN | NOT RUN | NO |
| Flipkart, Meesho, AJIO and other reviewed channels | No complete Central Inventory stock-publication adapter established | NOT RUN | NOT VERIFIED | NOT RUN | NOT RUN | NO |

`provider_response_reference` is intentionally nullable. The adapter records a sanitized provider reference only when the response exposes a usable value; an absent reference is not fabricated. The current account-level capability display remains conservative and does not promote this source/test evidence into provider readiness.

## Remaining acceptance gates

- Verify current official provider contracts and permissions against owner-approved test accounts, SKU/listing and location before live mutation.
- Capture real acknowledgement and independent post-write readback for each enabled provider. Exercise provider acceptance followed by network loss and prove the scheduled worker resolves it without a duplicate mutation.
- Verify the hosted worker and PostgreSQL advisory-lock behavior across deployed instances; local tests do not prove distributed provider semantics.
- Add operator-authenticated case resolution for a persistent `MISMATCH`/`REQUIRES_RECONCILIATION`; until that exists, the command stays held and no automatic retry is allowed.
- Exercise stale mapping edits, mapping deactivation, auth expiry, 429/5xx, DNS failure, DB failure after remote acknowledgement, queue backlog, backup restore and measured workload in controlled staging.
- Keep stock publication disabled for every account/provider that lacks approved physical stock, active mapping/location identity, capability evidence and readback/reconciliation acceptance.

**Decision:** the local uncertainty and traceability gap is improved and isolated tests pass. Inventory publication is **not real-provider verified, not staging verified and not production enabled**.
