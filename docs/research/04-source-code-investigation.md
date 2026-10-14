# Source-code investigation

Status: IN PROGRESS. Twelve repository records below describe bounded source readings, not twelve complete end-to-end workflow audits. Exact mandatory fields are maintained in evidence.json. Upstream tests were read, not executed.

## UP-001 — saleor/saleor

[Source](https://github.com/saleor/saleor/blob/925b69959a97c9deda7cdc85092494896d0aa1f4/saleor/warehouse/management.py); revision `925b69959a97c9deda7cdc85092494896d0aa1f4`.

allocate_stocks evaluates a locking stock query, sums allocations, optionally subtracts checkout reservations and allocates across eligible warehouses.

Consistency: stock_select_for_update_for_existing_qs orders by primary key and applies select_for_update(of=self); allocation is inside traced_atomic_transaction.

Failure behavior: InsufficientStock raised before allocation insertion; matching test asserts no Allocation exists when checkout reservations exhaust stock.

Tests: https://github.com/saleor/saleor/blob/925b69959a97c9deda7cdc85092494896d0aa1f4/saleor/warehouse/tests/test_stock_management.py

Limits: Source and named assertion read; upstream tests NOT RUN. Reservation helper and full HTTP caller chain still need tracing.

License/reuse: BSD-3-Clause root license retrieved; license review pending final inventory.

Project decision: Learn from eligibility and locking; retain local ledger. Confidence: high.

## UP-002 — odoo/odoo

[Source](https://github.com/odoo/odoo/blob/993abab95278f488f47c231be38d9cbc85213c41/addons/stock/models/stock_quant.py); revision `993abab95278f488f47c231be38d9cbc85213c41`.

_update_available_quantity gathers quants by product/location/lot/package/owner; attempts to lock a quant; updates it or creates a quant. Reserved quantity delegates to this path.

Consistency: Uses try_lock_for_update; caller transaction and ORM lock semantics still need tracing.

Failure behavior: No lockable quant causes create path; returned availability permits negative values.

Tests: Not yet established.

Limits: Does not establish final-unit safety from this helper alone. Negative-stock policy is incompatible with simply copying into local strict ledger. Retrieved test_quant.py not yet read.

License/reuse: LGPL-3.0 root text read; bundled contributions may have other licenses.

Project decision: Learn physical stock dimensions; adapt only with local invariants. Confidence: medium.

## UP-003 — medusajs/medusa

[Source](https://github.com/medusajs/medusa/blob/0b97a96ea0d32ff3f4b18dbeeeeba9e763600a15/packages/modules/inventory/src/services/inventory-module.ts); revision `0b97a96ea0d32ff3f4b18dbeeeeba9e763600a15`.

createReservationItems_ validates inventory levels, creates reservation records, aggregates per-item/location adjustments, and updates reserved quantities.

Consistency: Workflow calls locking.execute on distinct inventory IDs around reservation creation and compensation deletion; PostgreSQL provider uses transaction-scoped advisory locks. Provider selection is deployment-specific.

Failure behavior: Compensation deletes saved reservation IDs under same lock keys. Inventory module tests assert excessive reservation rejection leaves reserved_quantity zero and deletion releases reserved quantity.

Tests: https://github.com/medusajs/medusa/blob/0b97a96ea0d32ff3f4b18dbeeeeba9e763600a15/packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts

Limits: Tests are read, not run. PostgreSQL lock test uses a shared in-memory stock counter, not the complete checkout inventory database path. Multi-key lock order and full workflow crash semantics remain open.

License/reuse: MIT except enumerated Enterprise paths; Enterprise license read. RBAC and SSO materials are proprietary; reviewed inventory and locking paths are outside the listed RBAC/SSO paths.

Project decision: Compare reservation model; do not import workflow framework on this evidence. Confidence: high.

## UP-004 — vendure-ecommerce/vendure

[Source](https://github.com/vendure-ecommerce/vendure/blob/530fa0afad87c449635d3864b604de93d7dd0a43/packages/core/src/service/services/stock-movement.service.ts); revision `530fa0afad87c449635d3864b604de93d7dd0a43`.

createAllocationsForOrderLines opens transaction, loads order lines, batch-locks variants, resolves allocation locations, records per-order shortfalls and builds allocations.

Consistency: Batch helper deduplicates/sorts variants then locks stock rows in ID order with pessimistic_write; allocation starts/joins withTransaction. Locking reads bypass cached loaders.

Failure behavior: Only unsupported-lock/absent-transaction errors allow unlocked fallback with warning; other errors propagate.

Tests: https://github.com/vendure-ecommerce/vendure/blob/530fa0afad87c449635d3864b604de93d7dd0a43/packages/core/e2e/stock-level-concurrency.e2e-spec.ts

Limits: Final-unit test uses AllocateOnCheckoutStrategy so check and allocation share one transition; row-lock tests skip SQL.js. This does not prove the default two-request checkout has the same guarantee. Upstream tests NOT RUN.

License/reuse: Root LICENSE.md read: GPLv3 by default or commercial VCL; plugin exception referenced but not analyzed. Pattern-only recommendation, no copied implementation.

Project decision: Apply transaction-entry and batch-lock-order review to existing workers. Confidence: high.

## UP-005 — timgit/pg-boss

[Source](https://github.com/timgit/pg-boss/blob/b53278b0afea34aa9110c6b0ebd927cee48dd4ae/src/plans.ts); revision `b53278b0afea34aa9110c6b0ebd927cee48dd4ae`.

SQL plans include SKIP LOCKED and retry/dead-letter schema; retryTest.ts asserts re-fetch after expiry/failure, fixed delays and exponential delay bounds.

Consistency: Claims and full completion SQL still require detailed reading; no exactly-once business-effects claim.

Failure behavior: Test includes regression #839: backoff with unset retryDelay must remain nonzero.

Tests: https://github.com/timgit/pg-boss/blob/b53278b0afea34aa9110c6b0ebd927cee48dd4ae/test/retryTest.ts

Limits: Tests read, not executed; issue #839 and historical diff not yet independently fetched.

License/reuse: MIT root license retrieved.

Project decision: Adapt retry specifications; no need established for replacing local outbox. Confidence: medium.

## UP-006 — Shopify/shopify-app-js

[Source](https://github.com/Shopify/shopify-app-js/blob/e409d06d03aebb88c3b0af85ea6b0120e439fd6b/packages/apps/shopify-api/lib/webhooks/validate.ts); revision `e409d06d03aebb88c3b0af85ea6b0120e439fd6b`.

validateFactory converts request, identifies webhook type, validates HMAC over rawBody, then checks required headers.

Consistency: Authentication helper only; no durable inbox or delivery deduplication demonstrated here.

Failure behavior: Invalid HMAC returns structured failure before header validation.

Tests: https://github.com/Shopify/shopify-app-js/blob/e409d06d03aebb88c3b0af85ea6b0120e439fd6b/packages/apps/shopify-api/lib/webhooks/__tests__/validate.test.ts

Limits: Named tests cover missing body/HMAC/headers and invalid or cookie-signature-replayed HMAC. Tests read, not run; durable inbox behavior is outside this validator.

License/reuse: MIT root license retrieved.

Project decision: Compare authentication boundary with inventory/ingress.js; retain durable local inbox. Confidence: medium.

## UP-007 — frappe/erpnext

[Source](https://github.com/frappe/erpnext/blob/655186714ce8b163cf32effc1ab4f335b99df7ca/erpnext/stock/doctype/stock_reservation_entry/stock_reservation_entry.py); revision `655186714ce8b163cf32effc1ab4f335b99df7ca`.

get_available_qty_to_reserve subtracts active outstanding reserved quantities; PostgreSQL branch locks Bin and matching SRE rows, MariaDB branch locks aggregate query.

Consistency: Database-specific lock paths; complete surrounding Frappe submit transaction not traced.

Failure behavior: Reservation tests assert reserved stock cannot be consumed by unrelated issue and delivery cancellation restores reserved status/quantity.

Tests: https://github.com/frappe/erpnext/blob/655186714ce8b163cf32effc1ab4f335b99df7ca/erpnext/stock/doctype/stock_reservation_entry/test_stock_reservation_entry.py

Limits: Batch helper delegates separately; full first-reservation race and framework transaction behavior not established.

License/reuse: GPL-3.0 license.txt retrieved; pattern-only use.

Project decision: Compare first-reservation gates, cancellation restoration, lot/batch validation. Confidence: medium.

## UP-008 — openboxes/openboxes

[Source](https://github.com/openboxes/openboxes/blob/94f393a240347209ad88fa6b48124e0238dd17ad/grails-app/domain/org/pih/warehouse/inventory/InventoryItem.groovy); revision `94f393a240347209ad88fa6b48124e0238dd17ad`.

InventoryItem is product lot identity shared across facilities; holds lotNumber, expirationDate and status. Quantity fields are transient; lot/product uniqueness is constrained.

Consistency: InventoryService uses Transactional annotation; no complete mutation/locking path traced.

Failure behavior: Persistence callbacks publish snapshot/availability refresh events; delivery durability not established.

Tests: Not yet established.

Limits: toJson quantityATP reuses quantity with a TODO; cannot claim available-to-promise correctness from this view. Matching tests still missing.

License/reuse: EPL-1.0 header and root epl-v10.html retrieved.

Project decision: Learn lot identity versus location balance; do not infer stock authority from serialized view. Confidence: medium.

## UP-009 — apache/camel

[Source](https://github.com/apache/camel/blob/1afa3af6f48b54763b2982726ccb7e29cba93948/core/camel-core-processor/src/main/java/org/apache/camel/processor/idempotent/IdempotentConsumer.java); revision `1afa3af6f48b54763b2982726ccb7e29cba93948`.

Consumer supports eager repository add or contains check, marks duplicate exchanges, optionally skips them, and registers completion only for the key owner.

Consistency: Repository durability/atomicity is pluggable; this processor alone is not a transactional inbox.

Failure behavior: Duplicate continuation cannot confirm/remove another exchange key; removeOnFailure passed to completion handler.

Tests: Not yet established.

Limits: Completion handler/repository tests still need tracing; contains-only check is not established concurrent protection.

License/reuse: Apache-2.0 source header and LICENSE.txt retrieved.

Project decision: Retain local transactionally stored receipt; use owner/failure semantics as test inspiration. Confidence: medium.

## UP-010 — graphile/worker

[Source](https://github.com/graphile/worker/blob/4cda192c5df254392a1dff350e5d73f7d2c18a85/src/worker.ts); revision `4cda192c5df254392a1dff350e5d73f7d2c18a85`.

Worker awaits task results, retains only failed payload items for batch retry, routes outcomes to failJob or completeJob.

Consistency: Job acquisition/release SQL implementations not yet traced.

Failure behavior: Release failure rejects worker and releases worker execution; event observer failures are separately logged.

Tests: Not yet established.

Limits: No exactly-once business effect claim; matching worker tests/SQL still pending.

License/reuse: MIT LICENSE.md retrieved.

Project decision: Compare per-item retry and operational observer failure boundaries without adding another queue. Confidence: medium.

## UP-011 — debezium/debezium

[Source](https://github.com/debezium/debezium/blob/2f84b29c03638d261823172d1d8bfa9ca3a99824/debezium-connect-plugins/src/main/java/io/debezium/transforms/outbox/EventRouterDelegate.java); revision `2f84b29c03638d261823172d1d8bfa9ca3a99824`.

Outbox SMT ignores tombstones/deletes, handles unexpected updates by configured policy, extracts payload, adds event ID header and derives event key/routing.

Consistency: Transforms captured records; it neither writes a business transaction nor atomically commits a provider request.

Failure behavior: Missing payload/event-ID fields cause configuration/data errors; unexpected update policy is explicit.

Tests: https://github.com/debezium/debezium/blob/2f84b29c03638d261823172d1d8bfa9ca3a99824/debezium-connect-plugins/src/test/java/io/debezium/transforms/outbox/EventRouterTest.java

Limits: PostgreSQL CDC slot/offset retention and broker outage recovery not inspected. Tests read for tombstone/deletion ignoring only.

License/reuse: Apache-2.0 LICENSE.txt retrieved.

Project decision: CDC requires an insert-event contract; existing mutable ci_outbox is not a drop-in Debezium event table. Confidence: medium.

## UP-012 — woocommerce/woocommerce

[Source](https://github.com/woocommerce/woocommerce/blob/5f57267f9f8bd40d2e12d84d2207c399910d8869/plugins/woocommerce/includes/class-wc-webhook.php); revision `5f57267f9f8bd40d2e12d84d2207c399910d8869`.

Delivery generates HMAC-SHA256 and delivery ID headers; stock functions separately use per-order-item _reduced_stock markers.

Consistency: Stock decrement and item metadata are separate visible calls; full datastore transaction/lock policy not traced.

Failure behavior: Stock update error adds an order note and continues; sender delivery failure policy needs remaining review.

Tests: Not yet established.

Limits: No generic atomic multi-line fulfillment guarantee; official extension hooks can alter behavior. Tests and exact root license still pending.

License/reuse: UNVERIFIED at this revision: LICENSE path failed; no copying proposed.

Project decision: Compare webhook identity and mutation marker limits; retain local ledger idempotency. Confidence: medium.

## UP-013 — saleor/saleor

[Source](https://github.com/saleor/saleor/blob/925b69959a97c9deda7cdc85092494896d0aa1f4/saleor/graphql/order/mutations/fulfillment_return_products.py); `925b69959a97c9deda7cdc85092494896d0aa1f4`.

Return mutation requires MANAGE_ORDERS, invokes explicit channel permission check, validates line quantities/refund amount through base helpers, and passes authenticated user/app and reason to order action. Base mutation enforces configured permissions before perform_mutation.

Consistency: create_fulfillments_for_returned_products wraps return/refund/replacement processing in traced_atomic_transaction; may call payment plugin refund inside this scope. DB transaction cannot prove external refund rollback.

Failure: PaymentError mapped to mutation error. Named test denies staff with all permissions restricted to a different channel.

Tests: https://github.com/saleor/saleor/blob/925b69959a97c9deda7cdc85092494896d0aa1f4/saleor/graphql/order/tests/mutations/test_fulfillment_return_products.py

Limits: Refund plugin timeout/idempotency and exact restock behavior need further service trace; return fulfillment status must not be assumed to mean a physical warehouse receipt. Tests read, not run.

License: BSD-3-Clause root text read.

Applicability: Use explicit function plus channel checks and actor/reason provenance; preserve separate physical receipt controls.

## UP-014 — medusajs/medusa

[Source](https://github.com/medusajs/medusa/blob/0b97a96ea0d32ff3f4b18dbeeeeba9e763600a15/packages/core/core-flows/src/order/workflows/return/confirm-receive-return-request.ts); `0b97a96ea0d32ff3f4b18dbeeeeba9e763600a15`.

Authenticated return confirm route passes actor_id as confirmed_by. Workflow rejects canceled order/return or inactive change; differentiates normal and damaged receipt actions. Only normal receipt quantities feed restock adjustment; return status can be partially received.

Consistency: Updates return, return items, order change confirmation and inventory adjustments as parallel workflow steps, not one demonstrated DB transaction. Adjustment step uses configured item lock provider and inverse-quantity compensation.

Failure: Invalid target inventory location throws. Inventory adjustment compensation negates original deltas; crash-safe compensation persistence still needs orchestration trace.

Tests: https://github.com/medusajs/medusa/blob/0b97a96ea0d32ff3f4b18dbeeeeba9e763600a15/integration-tests/modules/__tests__/order/workflows/return/items.spec.ts

Limits: Retrieved items.spec.ts tests return-request action and invalid/missing entities, not the full receive-confirm workflow. No full end-to-end receive test claim. Enterprise RBAC/SSO is separately licensed.

License: MIT outside enumerated Enterprise paths; reviewed return/inventory files are not the listed RBAC/SSO materials.

Applicability: Separate received, damaged and restock quantities; bind confirmer to authenticated identity; do not copy parallel workflow without recovery proof.

## UP-015 — tryton/tryton

[Source](https://github.com/tryton/tryton/blob/8a743492cd18002a2c47f877e87aa32d79360c78/modules/stock/shipment.py); `8a743492cd18002a2c47f877e87aa32d79360c78`.

ShipmentOutReturn represents customer returns with company/customer/warehouse/input/storage fields; explicit draft→received→done transitions, receiver/completer employee attribution, incoming moves then inventory moves.

Consistency: Receive executes incoming moves; do checks movement quantities before completing storage moves. Move assignment uses NOWAIT locking when supported, otherwise model lock. Framework request transaction not fully traced.

Failure: Cancel cancels incoming and inventory moves; transition graph and model validation constrain movement. Button visibility alone is not proven server authorization.

Tests: Not established.

Limits: Module tests were retrieved but only test names inspected; no dedicated return scenario found at guessed path. No concurrency or ACL test result claimed.

License: modules/stock/COPYRIGHT and LICENSE read: GPLv3 or later.

Applicability: Use explicit receiving vs storage/custody stages and actor evidence; do not infer return-to-saleable stock from a single QC label.

## UP-016 — apache/ofbiz-framework

[Source](https://github.com/apache/ofbiz-framework/blob/b8b72d556e829d4a0818f8a4fed57e0750efcacb/applications/product/src/main/java/org/apache/ofbiz/product/inventory/InventoryServices.java); `b8b72d556e829d4a0818f8a4fed57e0750efcacb`.

prepareInventoryTransfer reads item ATP/QOH, rejects insufficient available quantity and can split inventory item/details; completeInventoryTransfer changes destination/ownership and inventory details through service calls.

Consistency: Dispatcher service transaction and item locking not yet traced; services_inventory.xml auth=true entity-auto entries are not proof of transfer operation transaction boundaries.

Failure: Service errors propagate lookup/detail/store failures; explicit cancelInventoryTransfer path exists but full invariant not yet traced.

Tests: Not established.

Limits: Entity model guess failed; matching tests/service declarations for prepare/complete still unresolved. Do not claim concurrent correctness.

License: Apache-2.0 root LICENSE and source headers retrieved.

Applicability: Compare available-to-promise versus physical quantity and explicit transfer preparation/completion, without replacing local atomic moves.

## UP-017 — vendure-ecommerce/vendure

[Source](https://github.com/vendure-ecommerce/vendure/blob/530fa0afad87c449635d3864b604de93d7dd0a43/packages/core/src/service/services/order.service.ts); `530fa0afad87c449635d3864b604de93d7dd0a43`.

refundOrder validates nonempty intent and consistent line order, loads payment, checks payment order belongs to active channel before provider refund; rejects inappropriate order states. Resolver declares transaction and UpdateOrder permission.

Consistency: Order findOne explicitly joins active channel. Auth guard reads permission metadata and calls configured access-control strategy; behavior may differ with custom strategy or disableAuth.

Failure: Cross-channel payment check precedes money-moving handler even when input.lines is empty, closing a bypass in naive line-derived scope checks.

Tests: Not established.

Limits: Permission decorator is metadata only; guard strategy and channel helper implementations/test matrix still need complete trace. Guessed channel-permissions test path failed.

License: GPLv3/VCL root text read; pattern-only use.

Applicability: Enforce object scope from actual source object, not only optional line arrays; apply to local return/order/account IDs.

## HIST-001 — openboxes/openboxes

[Source](https://github.com/openboxes/openboxes/commit/ea5ba4bc5fc1060f985febbad55a47a548843ecb); `ea5ba4bc5fc1060f985febbad55a47a548843ecb`.

Historical security patch replaces Groovy template evaluation with restricted property resolution and validates ZEBRA_TEMPLATE document type at four endpoints.

Consistency: Security boundary, not stock transaction proof.

Failure: Resolver rejects blocked names/types, method calls and template tags; patch adds controller and resolver tests.

Tests: https://github.com/openboxes/openboxes/blob/ea5ba4bc5fc1060f985febbad55a47a548843ecb/src/test/groovy/org/pih/warehouse/core/BeanPropertyTemplateServiceSpec.groovy

Limits: Patch source and test diff read, not executed. Advisory states fixed in v0.9.8; no local Groovy exposure or full current OpenBoxes release safety claim.

License: EPL-1.0 project; historical patch used for analysis only.

Applicability: Learn to validate object type before interpretation and test template trust boundaries; exploit itself not applicable to the Node app without matching evaluator.

## HIST-002 — medusajs/medusa

[Source](https://github.com/medusajs/medusa/issues/17022); `Reporter package version 2.13.1; issue accessed 2026-10-15`.

Reporter describes nested cart workflow returning before all parallel steps finish and failed compensation leaving order/payment inconsistent.

Consistency: Reported timing/recovery issue; no reproduction independently run.

Failure: Reporter describes workaround; not endorsed as a verified fix.

Tests: Not established.

Limits: Issue state/page and report inspected; no exact fixing commit, public reproduction or affected-current-version proof. Do not promote report to source-verified bug.

License: Public issue referenced in paraphrase only.

Applicability: Investigate completion/checkpoint/compensation ordering before workflow adoption.

## UP-018 — frappe/frappe

[Source](https://github.com/frappe/frappe/blob/4857b04809270c03c5e3dced4908168c15bed516/frappe/permissions.py); `4857b04809270c03c5e3dced4908168c15bed516`.

has_permission separates type-level role permissions from document owner/user/share permissions, handles child records and disabled modules, and explicitly bypasses for Administrator.

Consistency: Policy evaluation, not tenant-routing proof. Passing a document is a separate scope check from only testing a document type.

Failure: Denied document checks log context; sharing policy can alter access according to action and system settings.

Tests: https://github.com/frappe/frappe/blob/4857b04809270c03c5e3dced4908168c15bed516/frappe/tests/test_permissions.py

Limits: Custom hooks, query-list filtering, site isolation and complete authentication/permission caller chain not traced. No general multi-tenant security certification.

License: MIT LICENSE retrieved/read.

Applicability: Compare operation/object/owner policies with Saleor channel and Vendure context checks; do not copy privileged bypasses.

## UP-019 — Zehelein/pg-transactional-outbox

[Source](https://github.com/Zehelein/pg-transactional-outbox/blob/5556d4532961907ac88d1fdd4c6c02ca9c6bc35d/lib/src/handler/create-message-handler.ts); `5556d4532961907ac88d1fdd4c6c02ca9c6bc35d`.

Handler locks/reloads message with FOR NO KEY UPDATE NOWAIT, calls handler with the same database client and marks processed inside executeTransaction. Started/finished attempt differences inform poison handling.

Consistency: Same-client database effects and processed marker share transaction; external side effects cannot become atomic merely by invoking a callback here.

Failure: Timeout callback checks transactionFinished before rollback/release; tests assert late timeout must not release a client again or roll back after completion. No handler can lead to marking complete.

Tests: https://github.com/Zehelein/pg-transactional-outbox/blob/5556d4532961907ac88d1fdd4c6c02ca9c6bc35d/lib/src/handler/create-message-handler.spec.ts

Limits: Unit tests use client mocks; real multi-process integration not run. Setup exporter includes DROP TABLE CASCADE, so it must never be used on existing local stores. README exactly-once claim narrowed to actual same-transaction effects.

License: MIT LICENSE.md retrieved/read.

Applicability: Adapt late-timeout/client-ownership and missing-handler acceptance tests; retain existing queue until measured need exists.

## UP-020 — ossf/scorecard

[Source](https://github.com/ossf/scorecard/blob/a1fe90aafa9169f150b2733fb608f6551077b371/checks/pinned_dependencies.go); `a1fe90aafa9169f150b2733fb608f6551077b371`.

Pinned-dependencies check calls raw collector, probe runner and score evaluation; internal collection/probe failures become runtime error results.

Consistency: Repository check orchestration; not package artifact or vulnerability verification.

Failure: Explicit error result distinguishes failure from a valid score.

Tests: https://github.com/ossf/scorecard/blob/a1fe90aafa9169f150b2733fb608f6551077b371/checks/pinned_dependencies_test.go

Limits: Inspected wrapper test covers Dockerfile fixture; GitHub-action pin parser/probe implementation not yet traced. No local Scorecard run or score claimed.

License: Apache-2.0 LICENSE and source header retrieved/read.

Applicability: Use immutable-action policy and explicit scan failures; do not treat a green scanner label as whole supply-chain safety.

## STD-001 — OWASP/ASVS

[Source](https://github.com/OWASP/ASVS/blob/5cf9b032440be53ce345ab3c130fda46ba1ce7a2/5.0/en/0x17-V8-Authorization.md); `5cf9b032440be53ce345ab3c130fda46ba1ce7a2`.

ASVS 5.0 authorization defines function/data/field policy, trusted enforcement and cross-tenant controls.

Consistency: Normative control reference; no application correctness claim.

Failure: Authorization proof must include denied operation and object/field scope.

Tests: Not applicable or unverified.

Limits: Only V8 and V16 chapters inspected; no whole-ASVS verification or selected conformance level established.

License: CC BY-SA 4.0 source license read; requirements paraphrased and attributed.

Applicability: Map exact control IDs to local evidence and unverified gaps.

## STD-002 — OAI/OpenAPI-Specification

[Source](https://github.com/OAI/OpenAPI-Specification/blob/69d8b7953c3259e243cf746388a0951b89649763/versions/3.1.1.md); `69d8b7953c3259e243cf746388a0951b89649763`.

OpenAPI 3.1.1 Security Requirement Object: schemes within an object combine; listed alternative objects permit alternatives; empty object permits anonymous access.

Consistency: Describes API contract; schema documentation does not enforce runtime permissions.

Failure: Wrong security declaration can misrepresent anonymous access; server tests still required.

Tests: Not applicable or unverified.

Limits: 3.1.1 intentionally inspected as a versioned specification, not asserted latest. No complete local OpenAPI inventory found/verified in this scope.

License: Apache-2.0 LICENSE retrieved/read.

Applicability: Document return/provider/idempotency contracts with explicit security and accepted-vs-committed semantics.

## LOC-019 — local OMS/WMS checkout

[Source](/Users/shreshthagupta/AI-Workspaces/oms-wms/inventory/receipt-bridge.js); `9fe3fc3d54c2c3fe2a7ac3c6154814f74ec41bf0 + sha256:6eaf8e399945578a65a548714964d5ebd35dd98d49de633b725843126318e9bc`.

HTTP202 stages Mongo command+pending receipt; worker consumes validated command into PG receipt/ledger/balance/result outbox transaction; Mongo result inbox/projection confirms only matching causation/digest/request; claims use ownership tokens.

Consistency: Separate per-store transactions with durable bridge and result, not cross-store atomic commit. PG consumer reuses same db in inbound ledger transaction.

Failure: Commit uncertainty preserves request identity; expired claims recover under token conditions; invalid/conflicting work held, dependencies retry, attempt exhaustion handled. Sequence gaps retry rather than silently advancing checkpoint.

Tests: /Users/shreshthagupta/AI-Workspaces/oms-wms/scripts/verify-phase-b-propagation.mjs

Limits: Test assertions read for queued/no-stock-before-commit, injected commit loss duplicate replay, projection duplicate and expired/fair claim recovery; not executed in this research. Full route permission policy and hosted topology remain unverified.

License: Local project

Applicability: Preserve existing bridge as a strong foundation; improve actor/permission/recovery evidence rather than replace it.
