# Tenant isolation report

Campaign checkpoint, 2026-10-08. **TENANT ISOLATION: BLOCKED.** The current inventory HTTP contract is one configured INVENTORY_ALLOWED_TENANT_ID per deployment, not a demonstrated multi-tenant user membership model.

## Inventory request boundary

inventory/http.js mounts the private tenant boundary before central, connections and unified routers. Authentication is supplied by the parent server mount. inventory/tenant-boundary.js now exposes the existing boundary for direct behavioral verification: absent tenant configuration returns 503, foreign or non-string supplied body/query tenantId returns 403, and accepted requests receive the configured authoritative inventoryTenantId. Private responses disable caching. The balances route now uses that authoritative value rather than re-reading the caller query and requiring redundant tenant input.

TESTED: scripts/verify-inventory-tenant-middleware.mjs PASS, covering foreign strings, arrays, objects, null, numeric and boolean values in both body and query; absent and matching supplied tenant; overwrite of preexisting foreign request tenant state; cache header; missing configuration. Rejected requests never reach downstream handlers. These are direct middleware tests, not real cross-tenant database/object authorization tests.

## Storage and public ingress review

WooCommerce public ingress looks up an account using configured tenant, account ID and platform before credential/signature verification. Shopify ingress resolves account under configured tenant and verifies raw-body signature. WhatsApp callback tests exercise selected tenant-scoped SQL and signature boundaries. Private inventory SQL generally consumes inventoryTenantId, but exhaustive query/object review remains incomplete.

Legacy api/mongo.js helpers do not establish tenant predicates. A database-per-tenant deployment could provide store isolation only if enforced consistently across sessions, web, worker, tools and restore; that contract is not proven. Numeric-ID mutation validation and uniqueness work protect record identity, not tenant ownership. Do not infer legacy isolation from the inventory router guard.

## Remaining acceptance evidence

Create two distinct tenant datasets and authorized identities in fresh owned stores; test foreign SKU, location, account, order, receipt, file/export, queue task and notification recipient IDs on every relevant action. Verify server-side object ownership independently of user-supplied tenant input. Exercise guessed IDs, expired/wrong-role sessions, callbacks, worker claims, exports, restore and operator diagnostics. Establish the intended legacy tenant/store model before adding guessed predicates to historical business records. No configured tenant data or authentication policy changed in this checkpoint.

Integration checkpoint: original verify-inventory-tenant-boundary.mjs is preserved, alongside the separate new verify-inventory-tenant-middleware.mjs. Both PASS under Node 24.21.0. The original test mounts the actual inventory router on an owned loopback listener and verifies foreign query/body tenant denial and missing configuration; it does not query configured databases. The direct middleware checks supplement that HTTP coverage. An accidental test-file replacement during extraction was corrected; existing HTTP assertions were restored.
