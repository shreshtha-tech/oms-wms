# Shopify inventory publication: version-specific review

Inspected 2026-10-15. DOCUMENTED ONLY for provider behavior; VERIFIED IN CODE for local request construction. No configured Shopify calls made.

The [2026-07 mutation reference](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/inventorySetQuantities) restricts absolute publication to an inventory authority and requires inventory write scope/permission. Its idempotency notice requires the directive from 2026-04 onward. Local inventory/connectors/shopify.js pins 2026-07 and includes the directive. Preserve that implementation.

The mutation page contains older compareQuantity prose/examples. The [2026-07 quantity input schema](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/InventoryQuantityInput) instead specifies explicit changeFromQuantity; stale expected values fail CAS. Local code supplies the observed integer through changeFromQuantity. Do not downgrade it using the stale prose. The initial direct schema fetch failed; following the actual mutation input links succeeded.

The [input reference](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/InventorySetQuantitiesInput) supports an identifying referenceDocumentUri. The worker uses a balance-version URI. These are contract checks, not live provider proof.

Local inventory/workers.js reads authoritative balance and pack size, reads remote quantity before mutation, derives idempotency from mapping/balance version/target quantity, persists attempt/acknowledgement/readback and holds unresolved outcomes. It rejects a missing observed location. Therefore missing CAS/idempotency is NOT a confirmed defect. Existing keys deliberately follow fresh balance version rather than an old task ID. Evidence LOC-007. Tests for hosted scopes, stale CAS, idempotency retention, quota recovery and more than 100 inventory levels remain open; readQuantity currently checks only its first 100 levels. Missing location fails closed and does not itself prove wrong publication.
