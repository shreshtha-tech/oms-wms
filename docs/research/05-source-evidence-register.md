# Source evidence register

Initial commit-pinned source readings. Records are partial investigations, not complete workflow certification. Exact required fields are in evidence.json; retrieval success/failure and hashes are in source-retrieval-manifest.json. Upstream tests NOT RUN.

## UP-001 — saleor/saleor

[Source](https://github.com/saleor/saleor/blob/925b69959a97c9deda7cdc85092494896d0aa1f4/saleor/warehouse/management.py) — `925b69959a97c9deda7cdc85092494896d0aa1f4`

allocate_stocks evaluates a locking stock query, sums allocations, optionally subtracts checkout reservations and allocates across eligible warehouses.

Consistency: traced_atomic_transaction wraps allocation; lock helper implementation still needs review.
Failure handling: Insufficient stock accumulated and raised; complete rollback path and lock order require helper/caller review.
Limitations: test_stock.py was read for channel/country eligibility assertions; it does not prove concurrent reservation safety. test_management.py guessed path returned 404.
License: BSD-3-Clause root license retrieved; license review pending final inventory.
Applicability: Learn from eligibility and locking; retain local ledger.

## UP-002 — odoo/odoo

[Source](https://github.com/odoo/odoo/blob/993abab95278f488f47c231be38d9cbc85213c41/addons/stock/models/stock_quant.py) — `993abab95278f488f47c231be38d9cbc85213c41`

_update_available_quantity gathers quants by product/location/lot/package/owner; attempts to lock a quant; updates it or creates a quant. Reserved quantity delegates to this path.

Consistency: Uses try_lock_for_update; caller transaction and ORM lock semantics still need tracing.
Failure handling: No lockable quant causes create path; returned availability permits negative values.
Limitations: Does not establish final-unit safety from this helper alone. Negative-stock policy is incompatible with simply copying into local strict ledger. Retrieved test_quant.py not yet read.
License: LGPL-3.0 root text read; bundled contributions may have other licenses.
Applicability: Learn physical stock dimensions; adapt only with local invariants.

## UP-003 — medusajs/medusa

[Source](https://github.com/medusajs/medusa/blob/0b97a96ea0d32ff3f4b18dbeeeeba9e763600a15/packages/modules/inventory/src/services/inventory-module.ts) — `0b97a96ea0d32ff3f4b18dbeeeeba9e763600a15`

createReservationItems_ validates inventory levels, creates reservation records, aggregates per-item/location adjustments, and updates reserved quantities.

Consistency: InjectTransactionManager decoration; actual locking decorator/repository path not yet traced.
Failure handling: Transactional intent visible; cross-module compensation not established.
Limitations: Insufficient basis to claim concurrent safety. reserve-inventory.ts guessed path returned 404; matching test not yet inspected.
License: Root MIT explicitly excludes Enterprise Edition materials; ENTERPRISE-LICENSE.md and file scope must be verified before reuse.
Applicability: Compare reservation model; do not import workflow framework on this evidence.

## UP-004 — vendure-ecommerce/vendure

[Source](https://github.com/vendure-ecommerce/vendure/blob/530fa0afad87c449635d3864b604de93d7dd0a43/packages/core/src/service/services/stock-movement.service.ts) — `530fa0afad87c449635d3864b604de93d7dd0a43`

createAllocationsForOrderLines opens transaction, loads order lines, batch-locks variants, resolves allocation locations, records per-order shortfalls and builds allocations.

Consistency: withTransaction and lockStockLevelsForVariants are explicit; shared lock order helper still needs detailed inspection.
Failure handling: Comments describe nontransactional callers previously lacking valid pessimistic locks; this is source commentary, not verified historical PR evidence.
Limitations: Default process and stock-level files retrieved; matching tests, revision history and license unresolved.
License: UNVERIFIED: LICENSE path returned 404; API NOASSERTION. No copying authorized.
Applicability: Apply transaction-entry and batch-lock-order review to existing workers.

## UP-005 — timgit/pg-boss

[Source](https://github.com/timgit/pg-boss/blob/b53278b0afea34aa9110c6b0ebd927cee48dd4ae/src/plans.ts) — `b53278b0afea34aa9110c6b0ebd927cee48dd4ae`

SQL plans include SKIP LOCKED and retry/dead-letter schema; retryTest.ts asserts re-fetch after expiry/failure, fixed delays and exponential delay bounds.

Consistency: Claims and full completion SQL still require detailed reading; no exactly-once business-effects claim.
Failure handling: Test includes regression #839: backoff with unset retryDelay must remain nonzero.
Limitations: Tests read, not executed; issue #839 and historical diff not yet independently fetched.
License: MIT root license retrieved.
Applicability: Adapt retry specifications; no need established for replacing local outbox.

## UP-006 — Shopify/shopify-app-js

[Source](https://github.com/Shopify/shopify-app-js/blob/e409d06d03aebb88c3b0af85ea6b0120e439fd6b/packages/apps/shopify-api/lib/webhooks/validate.ts) — `e409d06d03aebb88c3b0af85ea6b0120e439fd6b`

validateFactory converts request, identifies webhook type, validates HMAC over rawBody, then checks required headers.

Consistency: Authentication helper only; no durable inbox or delivery deduplication demonstrated here.
Failure handling: Invalid HMAC returns structured failure before header validation.
Limitations: Underlying HMAC helper and matching tests pending. Official provider contract still needs refresh.
License: MIT root license retrieved.
Applicability: Compare authentication boundary with inventory/ingress.js; retain durable local inbox.

## Current register

The expanded, corrected register is evidence.json and 15-evidence-register.md under the latest brief. Entries above describe the earlier partial reading; updated lock/test/license findings are in 04-source-code-investigation.md.
