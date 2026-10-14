# Production hardening release gate

## Expanded database-authority brief checkpoint — 2026-10-09

Current follow-up: `node scripts/verify-sku-import-provenance.mjs` PASS under the available Node 20.14.0 runtime using explicit empty-memory Mongo. A filename and caller-claimed success count receive HTTP 501; no SKU or import-history record changes. This closes only the false-success behavior for this disconnected route. Actual server-side SKU import remains unimplemented, so import functionality is still unavailable and the security/data-integrity release gate remains BLOCKED. This local fixture does not verify configured databases, authenticated roles or hosted behavior.

Scope caveat from the active UI/API trace: `/app/sku-import` currently sends per-row `/api/skus` POST/PUT requests before submitting `/api/sku-imports`. Therefore, the fixture proves that the final disconnected import endpoint does not itself mutate SKUs; its “No SKU changes” response can still be false for the complete UI operation after earlier row requests. The active browser workflow's partial effects and test-server store identity have not been verified in an isolated runtime.

The later 64-part brief adds PostgreSQL-first database ownership and cross-database consistency as explicit release requirements. The [authority matrix](DATABASE_AUTHORITY_MATRIX.md) and [Mongo module source inventory](hardening/MONGO_MODULE_OWNERSHIP_REVIEW.md) are initial evidence only. They do not prove configured data equivalence, tenant ownership, migration safety, or production readiness.

| Expanded Part 63 status | Current |
|---|---|
| DATABASE_AUTHORITY | BLOCKED |
| SECURITY | BLOCKED |
| PERFORMANCE | BLOCKED |
| RELIABILITY | BLOCKED |
| DATA_INTEGRITY | BLOCKED |
| TENANT_ISOLATION | BLOCKED |
| PROVIDER_RESILIENCE | BLOCKED |
| QUEUE_RESILIENCE | BLOCKED |
| CROSS_DATABASE_CONSISTENCY | BLOCKED |
| DISASTER_RECOVERY | BLOCKED |
| OBSERVABILITY | BLOCKED |
| DEPLOYMENT | BLOCKED |
| PRODUCTION_READINESS | BLOCKED |

Fulfillment, returns, provider readback and reconciliation also require direct evidence before these statuses can change. No configured Mongo or PostgreSQL data was accessed for the source inventory; no migration or cutover was performed.

Campaign checkpoint, 2026-10-08. **RELEASE: BLOCKED.** This is an interim assessment against Parts 46–50 of the supplied specification, not a completed audit or production approval. The active goal remains incomplete. Passing disposable tests cannot substitute for real-provider, staging, deployment, recovery, security and representative-load evidence.

| Required gate | Status |
|---|---|
| SECURITY | BLOCKED |
| PERFORMANCE | BLOCKED |
| RELIABILITY | BLOCKED |
| DATA INTEGRITY | BLOCKED |
| TENANT ISOLATION | BLOCKED |
| PROVIDER RESILIENCE | BLOCKED |
| QUEUE RESILIENCE | BLOCKED |
| DISASTER RECOVERY | BLOCKED |
| OBSERVABILITY | BLOCKED |
| DEPLOYMENT | BLOCKED |

Approved workload, latency percentiles, capacity, RPO and RTO remain unresolved. Source scans are review queues, not exhaustive security certification. Configured databases and providers have not been accessed for these repairs. Mongo local tests establish their stated boundaries only.

## Required failure scenarios

All 24 scenarios listed in Part 50 are included below. CURRENT records observed implementation/test scope; every overall production scenario remains BLOCKED pending its missing evidence.

| Scenario | EXPECTED | CURRENT | EVIDENCE | REMAINING RISK | RECOMMENDED CONTROL |
|---|---|---|---|---|---|
| One marketplace unavailable | Isolate account; retain durable work | Guarded transport and held publication states reviewed | [PROVIDER_RESILIENCE_MATRIX.md](PROVIDER_RESILIENCE_MATRIX.md) | Live account outage not run | Inject outage alongside healthy-provider traffic |
| Multiple marketplaces fail | Local business operations remain bounded | Independent transport controls; tenant task loop is sequential | [QUEUE_RELIABILITY_REPORT.md](QUEUE_RELIABILITY_REPORT.md) | Pool and scheduler starvation unmeasured | Measure multi-provider outage and local order latency |
| Provider latency increases 20x | Bound wait and preserve task identity | Publication occupies mapping lock and pool connection | [QUEUE_RELIABILITY_REPORT.md](QUEUE_RELIABILITY_REPORT.md) | Cross-provider fairness unproven | Bound account concurrency and measure independent work |
| 429 for 20 minutes | Pace retries without exhausting workers | Capped transport retry; durable task paths reviewed | [PROVIDER_RESILIENCE_MATRIX.md](PROVIDER_RESILIENCE_MATRIX.md) | Long sustained rate-limit test not run | Run timed 429 campaign with backlog and recovery checks |
| Database connections exhausted | Truthful unavailable state and recovery | Fresh owned PG exhaustion/recovery passed | [DATABASE_PERFORMANCE_REPORT.md](DATABASE_PERFORMANCE_REPORT.md) | Mixed-pool pressure and production capacity unmeasured | Rerun owned harness and measure mixed-pool pressure |
| One worker crashes | Durable reclaim without duplicated effect | Supervisor and leases reviewed | [QUEUE_RELIABILITY_REPORT.md](QUEUE_RELIABILITY_REPORT.md) | Fresh end-to-end crash not run | Kill owned worker at write/ack boundaries |
| Two workers race | Exactly-once business effect via fencing/deduplication | Singleton and mapping locks reviewed; Mongo default concurrency passed | [hardening/MONGODB_FIXES_2026-10-08.md](hardening/MONGODB_FIXES_2026-10-08.md) | General queue races not proven | Race workers across lease expiry and account classes |
| Duplicate webhook | Authenticate and deduplicate effect | Signature/digest ingress reviewed | [PROVIDER_RESILIENCE_MATRIX.md](PROVIDER_RESILIENCE_MATRIX.md) | Hosted genuine duplicate not run | Replay signed event and verify ledger/business effect |
| Missing webhook | Polling detects missing events | Shopify bounded scan preserves successful high-water | [PROVIDER_RESILIENCE_MATRIX.md](PROVIDER_RESILIENCE_MATRIX.md) | Genuine gap recovery unverified | Withhold event and verify poll convergence |
| Polling overlaps webhook | One authoritative order revision/effect | Durable ingress revision paths reviewed | [PROVIDER_RESILIENCE_MATRIX.md](PROVIDER_RESILIENCE_MATRIX.md) | Fresh overlap race not run | Inject same revision through both paths |
| Mutation accepted; response lost | Unknown outcome held for readback | Durable uncertainty design reviewed | [PROVIDER_RESILIENCE_MATRIX.md](PROVIDER_RESILIENCE_MATRIX.md) | Real remote acceptance loss unverified | Drop acknowledgement after genuine acceptance |
| Provider readback disagrees | Hold mismatch; preserve central truth | Mismatch/reconciliation states reviewed | [PROVIDER_RESILIENCE_MATRIX.md](PROVIDER_RESILIENCE_MATRIX.md) | Genuine eventual-consistency behavior unknown | Exercise stale and conflicting readbacks |
| WhatsApp unavailable | Inventory remains independent; alert outcome truthful | Injected reliability tests passed; separate job scheduling | [QUEUE_RELIABILITY_REPORT.md](QUEUE_RELIABILITY_REPORT.md) | Slow-drip total-response bound gap | Add total deadline and verify outage isolation |
| Mongo unavailable | Fail closed; no persistent-to-memory fallback | Mock and owned daemon outage/restart passed | [hardening/MONGODB_FIXES_2026-10-08.md](hardening/MONGODB_FIXES_2026-10-08.md) | Hosted outage/receipt bridge recovery not run | Run owned daemon interruption and projection recovery |
| PostgreSQL slow | Bound queries; preserve transactional rollback | Fresh owned timeout/backend-loss rollback passed | [DATABASE_PERFORMANCE_REPORT.md](DATABASE_PERFORMANCE_REPORT.md) | Contention and production workload unmeasured | Repeat timeout/lock/slow-query campaign |
| Large Excel workbook | Bound parsing and report rejected workload truthfully | Workbook inspector fixture suite passed | [PRODUCTION_SECURITY_HARDENING_REPORT.md](PRODUCTION_SECURITY_HARDENING_REPORT.md) | Archive expansion/peak memory unmeasured | Measure compressed expansion and upload concurrency |
| Malicious file | Reject executable/path/archive attacks | XML and delimited export boundary tests passed | [PRODUCTION_SECURITY_HARDENING_REPORT.md](PRODUCTION_SECURITY_HARDENING_REPORT.md) | Whole upload matrix incomplete | Test content/extension mismatch, zip bombs and traversal |
| Attacker changes tenant IDs | Server rejects unauthorized tenant access | Tenant route review remains incomplete | [API_SECURITY_MATRIX.md](API_SECURITY_MATRIX.md) | Cross-tenant access not proven absent | Execute two-tenant object/action negative matrix |
| Attacker changes object IDs | Authorize object ownership on every route | Legacy route evidence traced; policies unresolved | [API_SECURITY_MATRIX.md](API_SECURITY_MATRIX.md) | Legacy ownership contract missing | Map object authority and test guessed IDs |
| Session expires during mutation | Authorize boundary; preserve outcome identity | Auth implementation present; no fresh race evidence | [API_SECURITY_MATRIX.md](API_SECURITY_MATRIX.md) | Expiry/commit race untested | Expire/revoke session around dispatch and commit |
| Double-click destructive action | One intended effect; truthful replay result | Selected transaction/revision guards tested | [hardening/MONGODB_FIXES_2026-10-08.md](hardening/MONGODB_FIXES_2026-10-08.md) | All destructive routes not covered | Concurrent same-key request tests per route |
| Deployment restarts during processing | Reclaim durable state; reconcile uncertain effects | Shutdown/supervisor source reviewed | [QUEUE_RELIABILITY_REPORT.md](QUEUE_RELIABILITY_REPORT.md) | Hosted restart not run | Restart staging during dispatch/commit/ack |
| Database restore | Restore consistency and reconcile external state | Offline BSON integrity/dry-run guard tests passed | [hardening/MONGODB_FIXES_2026-10-08.md](hardening/MONGODB_FIXES_2026-10-08.md) | Real restore and RPO/RTO not proven | Owned PG/Mongo cross-store restore drill |
| Large queue backlog | Bound admission, reclaim and fair service | Several recovery/reconciliation sweeps unbounded | [QUEUE_RELIABILITY_REPORT.md](QUEUE_RELIABILITY_REPORT.md) | Retention/admission/capacity unresolved | Bound sweeps and measure backlog drain fairness |

## Artifact completeness

Existing reports cover initial security, API/provider matrices, database plans, queue review, failure injection, owned chaos recovery and this gate. Performance baseline, sustained load, tenant isolation, disaster recovery and deployment resilience reports remain required. Creating a report alone does not pass its gate. Permanent Mongo regressions cover read limits, session cleanup/uncertain commit classification, mutation validation, actual rollback, concurrency, default uniqueness, input validation and owned numeric-ID query plans. Production-wide invariants, all source surfaces and all required failure campaigns are not yet proven.

## Integration checkpoint

Vite production frontend build PASS under Node 24.21.0 (1,949 modules, 6.29 seconds). Existing chunk-size warning remains; exceljs minified chunk approximately 937 kB (271 kB gzip). Build completion is not typecheck, browser parity, load, security or deployment evidence. Both the preserved actual-router HTTP tenant test and separate direct middleware regression PASS. Package JSON duplicate-key check and diff whitespace check PASS. These checks do not change any production gate to PASS.

All 13 required report files now exist as scoped interim evidence reports. Artifact existence does not establish gate completion: representative load, real-provider/staging/deployment/restore evidence and exhaustive security/integrity review remain incomplete.

## Original scope preservation checkpoint

hardening/goal-requirements.json preserves the complete supplied preamble and all 50 numbered parts with source line ranges and SHA-256. audit-hardening-requirements.mjs rejects missing/reordered parts. Exact text reconstruction from the registry matched the original source, and all 13 Part 47 report files were verified present and nonempty. These are scope/artifact checks only: each whole part remains NOT_PROVEN pending detailed requirement-level evidence assessment. Reports and passing fixtures do not satisfy the required real-provider, staging, deployment, recovery or representative security/load proof. All ten release gates remain BLOCKED. Do not infer completion from artifact existence or the number of repairs.

Latest additions improve receipt input/arithmetic safety with real cross-store regression, bounded publication recovery/readback pages, advisory-lock cleanup with actual backend loss, and owned Mongo restore fidelity/corruption/partial-failure/memory guards. Remaining launch workload/SLO/RPO/RTO targets and configured/hosted acceptance are unresolved. The active objective retains its full original scope.
