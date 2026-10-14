# Existing-project gap analysis

Status: IN PROGRESS. Source correctness assessments are bounded to named mechanisms. Whole-system correctness requires all caller and failure paths; research gaps are not automatically missing implementation.

| Capability | Classification | Exact local evidence | Action / supporting external evidence |
|---|---|---|---|
| Central quantity authority and event replay | Implemented; correctness supported in named path | inventory/ledger.js applyInventoryEventInTransaction (LOC-001) | Retain; complete shared writer/concurrency campaign (UP-001/004/007) |
| Marketplace inbox/outbox atomicity | Implemented but complete recovery proof incomplete | inventory/ingress.js acceptShopifyWebhook (LOC-002) | Duplicate/out-of-order/commit-before-ACK specs; UP-006/009 |
| Internal aggregate sequence | Implemented but recovery policy incomplete | inventory/domain-events.js consumeEvent (LOC-003) | Gap/replay durable visibility; do not drop out-of-order internal effects |
| Local location transfer | Implemented for instantaneous atomic movement | inventory/wms-operations.js transferCentralWmsStock (LOC-004) | Test both legs and changed replay; in-transit custody is separate scope |
| Return restocking quantity bounds | Implemented but incomplete physical control | inventory/return-service.js approveReturnReceipt (LOC-005) | Keep cumulative dispatched/received limits; add designed QC/actor/condition contract |
| Return approval authorization | Implemented with security risk | inventory/unified-orders.js approve-receipt route; api/auth-session.js allowlist; server.js private mount (LOC-006) | R-01 proposed permission/object/warehouse/audit slice, DOC-004/005 |
| Publication uncertainty and reconciliation | Implemented but complete provider proof missing | inventory/workers.js publish/batch/reconcile paths; publication-recovery.js (LOC-007) | Preserve held uncertainty; prove late worker and independent readback |
| Provider quota recovery | Implemented but incomplete | reliability/provider-call.js providerCall (LOC-008) | R-04 contract-specific durable scheduling; DOC-003 |
| Real SKU import | Missing processor; previous unsafe client path fixed | src/eretail/masters/SkuImport.tsx; api/sku-imports.js (LOC-009) | 501 remains truthful. R-05 server-owned bounded intake requires approved contract |
| Migration revision history | Implemented after authorized fix; isolated tests PASS | inventory/migration-history.js and db.js (LOC-010) | Preserve replay; configured schema rollout unverified |
| CI/dependency checks | Configured but hosted execution unverified | .github/workflows/ci.yml; .github/dependabot.yml (LOC-011) | Run/review when authorized publishing occurs; no remote settings claim |
| General multitenancy | Not required by current single-tenant boundary; future need undetermined | inventory/tenant-boundary.js (LOC-012) | Do not replace with a multi-tenant framework absent business requirement; still test foreign IDs |
| Telemetry | Implemented but operational durability incomplete | reliability/telemetry.js (LOC-013) | R-07 define cardinality/privacy/correlation/storage/SLO contract before OTel adoption |
| Flipkart order observation | Implemented but configured completeness unproven | inventory/flipkart-orders.js, flipkart-order-observation.js (LOC-014) | Compare all filters and checkpoint semantics with DOC-002; source is not full-history proof |
| Channel readiness | Implemented with explicit partial/unsupported states | inventory/connection-readiness.js (LOC-015) | Retain distinctions; close listed feeds rather than relabel Connected |
| Bin/LPN/serial/expiry picking | Cannot determine full coverage; core ledger dimensions insufficient | inventory/ledger.js, wms-operations.js; ancillary modules not fully traced | UP-002/007/008 comparison; no UI-based implementation claim |
| DR/load/restore readiness | Cannot determine yet | No current executed source-to-operational evidence established | R-08 requires approved workloads/RPO/RTO and isolated restore proof; no invented targets |

This table supersedes any interpretation that the application is empty or needs wholesale replacement. No current evidence justifies changing React/Express, splitting microservices, replacing PostgreSQL or introducing a broker.
