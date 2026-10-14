# Production system audit — Part 1

Date: 2026-10-08 (Asia/Kolkata). Status: **IN PROGRESS; production approval BLOCKED**.

The controlling request is the 50-part production hardening specification supplied in the referenced attachment. The subsequent instruction, “all one by one,” sets sequential execution. This packet inventories Part 1 and identifies prioritized work; it does not certify completion of Part 1 or start later implementation phases.

## Evidence and boundaries

The current worktree already contains substantial tracked and untracked changes. None of those changes is attributed to this audit. No application runtime code, migration, configured database, credential, provider account, deployment or historical event was changed. The new inventory utility does not import application modules or load environment files.

`node scripts/audit-production-surface.mjs` produces [source-surface.json](hardening/source-surface.json): source paths, sizes, line counts, route candidates and inspection locations. It reads bounded text files across backend, frontend, migrations, tools and reports. Automated inventory is not semantic review. Dynamic SQL, dynamically registered routes, ignored files, binaries and deployment artifacts require separate inspection. Candidate counts include tests and tooling and must not be interpreted as vulnerability counts.

Reviewed context: `PRODUCTION_FORENSIC_ANALYSIS.md`, `PROVIDER_CAPABILITY_CONTRACT.md`, `docs/reliability/COMPLETION_AUDIT.md`, `DISCOVERY.md`, `REPORT_2026-10-04.md`, and the current architecture/recovery notes. Historical test and configured-provider results in those reports remain historical; they were not promoted to fresh evidence.

## Dependency and security graph

| Entry or component | Authority/dependency | Present boundary | Outstanding review |
|---|---|---|---|
| Browser / React | Express APIs | HttpOnly session; shared request timeout | Every screen's permission, stale-response, draft, cancellation and storage behavior |
| Login / session | PostgreSQL `ci_auth_session`; environment-owned accounts | Token hashes, expiry, credential fingerprint; login limiter | Full role matrix, rotation, session replacement, password-work bounds, deployed proxy |
| Private legacy APIs | Shared session; Mongo collections | Server-wide authentication | Object ownership, tenant isolation, operation permissions for all handlers |
| Private inventory APIs | Configured authorized tenant; PostgreSQL | Reject foreign body/query tenant; selected granular permissions | Provider/admin/export permission coverage; all foreign IDs |
| Shopify/Woo ingress | Account lookup, stored credential, raw signature | Body limits, signed intake, digest/delivery identity | Every topic/schema, flooding, genuine delivery, timestamp contracts |
| WhatsApp callback | Raw HMAC, configured tenant/sender identity | Signed callback and monotonic status tests | Real sender/account permissions and deployed callback behavior |
| OAuth / Tally public routes | State or agent token; configured tenant | Public routes mount before browser session middleware | Route-specific replay, TTL, account binding and abuse controls |
| Central ledger | PG transaction and row locks | Event hash/replay, reservation state, balance constraint, transactional outbox | Exhaustive writer and lock-order graph; multi-SKU deadlock campaign |
| Provider publication | Durable task plus guarded transport | Remote dispatch marker, held uncertainty, readback/reconciliation | Genuine providers, all transport callers, concurrency/pacing and lease expiry |
| Worker / poller / SQS | PG leases, provider account, IAM/queue | Bounded attempts, tenant claims, poison handling in selected paths | All job types; retention/admission; multiple deployed workers; missing-event recovery |
| Mongo receipt bridge | Mongo transaction, domain outbox, PG inbox/result | Separate durable commits and projection | Restart/restore compatibility across stores; every receipt boundary |
| Excel/CSV/XML/report | Parsers and export buffers | Selected upload/body/row bounds and parser safeguards | All parsers, CPU/decompression limits, request-path resource cost and ownership |
| Health / operations | PG/Mongo probes; process metrics | Separate live/ready; authenticated diagnostics | Durable monitoring, percentile timing, held-work alerting and hosted probes |
| Deployment | Render web + worker; pre-deploy migration | Additive migration path and drain source | Real deployment, restart, rollback, restore and compatibility evidence |

Shared authentication currently depends on PostgreSQL even for Mongo-backed legacy routes. A PostgreSQL outage can therefore interrupt authenticated capabilities across stores. This requires an explicit dependency design decision; it must not be “fixed” by bypassing authentication. Marketplace or WhatsApp failure must remain outside the local order/ledger commit path.

## Source-backed findings requiring repair or further proof

These are source observations, not completed exploitation or load findings. Severity is a triage priority pending measured impact.

| ID | Priority | Source/function | Observation | Required evidence/control |
|---|---|---|---|---|
| P1-001 | High | `inventory/http.js`, GET `/balances` | Tenant balance query has no row limit and returns all rows. | Bounded authorized pagination, large-dataset query and compatibility tests. |
| P1-002 | High | `inventory/read-model.js`, `readInventoryOverview` | Five fixed concurrent queries load all products, locations, accounts, open alerts and mappings. `/summary` also materializes the overview. | Aggregate summary query, bounded page model, representative EXPLAIN/latency and UI tests. Fixed Promise.all size itself is bounded. |
| P1-003 | High | `inventory/exports.js`, `inventoryExportData`, XLSX/PDF builders | Optional selected-SKU validation occurs after the full overview read; all balances are read then filtered. Full export has no selected-row ceiling; XLSX/PDF output is buffered. | SQL-side selection, admission/resource limits, durable export job and expiry/ownership as justified by workload. |
| P1-004 | High | `inventory/connections.js`; `api/auth-session.js` | Granular stock permissions exist, but reviewed provider administration routes lack corresponding operation-specific permission middleware. Shared authentication is not a role matrix. | Explicit authorized roles, scoped permissions and wrong-role/wrong-account HTTP tests before enabling high-risk operations. |
| P1-005 | High | `src/eretail/procurement/ProcurementWorkflows.tsx`, terms preview | HTML preview passes `value` into `dangerouslySetInnerHTML`. Sanitization/provenance across edit/save/load must be traced. | Controlled stored/DOM XSS test; prove sanitization or render permitted content safely. Sink presence alone is not exploit proof. |
| P1-006 | Medium | `reliability/postgres-connection.js`, pool defaults | Connection, statement and idle-pool bounds exist; no explicit idle-in-transaction timeout in wrapper defaults. A statement deadline does not bound time between statements. | Actual idle transaction/lock fault test; choose justified server settings and verify migration/worker compatibility. |
| P1-007 | High | `reliability/telemetry.js`, `increment`; `reliability/operations.js` | Process-lifetime totals cannot provide requested p50/p95/p99 or survive restart. Operational queue query counts pending/retry/dead but omits held uncertainty. | Bounded histograms or external tracing; durable scrape/retention; held/publication/reconciliation age metrics and restart proof. |
| P1-008 | Medium | `src/lib/api.ts`, `apiRequest` | Same in-flight mutation deduplication and timeout exist; no caller cancellation parameter. Timeout text recommends retry without distinguishing mutation ambiguity. | Per-workflow durable identity and truthful timeout handling; cancel/stale-response/session-expiry browser matrix. |
| P1-009 | High | `inventory/ledger.js`, publication enqueue; worker queues | Durable enqueue exists, but global queue admission/retention policy is not established by reviewed source. One event may enqueue per active mapping. | Measure backlog/retention/amplification and enforce safe admission without losing ledger effects or deleting audit evidence. |
| P1-010 | Medium | `reliability/provider-call.js`, `providerFetch` | Retry/circuit state is bounded and local to process; transport uses origin circuit keys rather than distributed account isolation. Retry-After is capped to five-second sleep. | Account pacing and long-429 multi-instance campaign; avoid early repeated requests after provider-mandated long waits. |
| P1-011 | High | `server.js`, auth middleware | PG-backed authentication is a common dependency for protected legacy and inventory APIs. | Exhaustion/outage HTTP evidence, truthful unavailable status, admission bounds and explicit availability model. |
| P1-012 | Medium | `render.yaml` | Hosting health check points to liveness; readiness is a separate route. Blueprint text alone does not prove traffic gating on readiness. | Current hosting documentation and real staging deployment/probe behavior; retain liveness while unhealthy dependencies prevent ready state. |
| P1-013 | High | `api/mongo.js`, `findImpl`, `findOneImpl` | Shared find materializes every match; findOne delegates to it and selects the first result. Helpers add no tenant scope. | Query-level result/deadline bounds and actual findOne; route-specific tenant/storage isolation contract and compatibility acceptance. |
| P1-014 | High | `api/admin.js`, handler/audit | Selected admin mutations and their audit inserts are separate writes. Audit failure can occur after business mutation commits; optimistic version checks do not enforce roles. | Atomic durable audit ownership plus authorized operation matrix and post-write failure injection. |
| P1-015 | High | `api/admin-parity.js`, report/searchLogs | Export path reads and filters full collections then persists CSV content in a report record synchronously. | Database-side filtering, bounded row/output/job admission, formula boundary, export ownership and expiration evidence. |
| P1-016 | High | `scripts/inventory-worker.mjs`, `runInventoryTaskBatch` | Tenant main outbox loop awaits sequential task processing; publication can delay unrelated intake/provider tasks. Publication holds a PG session connection during I/O. | Bounded task-class/provider fairness and simultaneous-failure/pool-pressure measurements. |
| P1-017 | High | `inventory/whatsapp.js`, `whatsappFetch` | DNS and socket-inactivity bounds exist, but no explicit overall response deadline. A slow-drip response can extend sender/connection occupancy. | Overall deadline/abort with uncertainty preservation and slow-drip failure injection. |
| P1-018 | High | `inventory/workers.js`, reconciliation and expiry; `inventory/whatsapp.js`, expiry | Multiple recovery/readback queries select/update all eligible tenant rows before processing. | Bounded recovery pages, fair cursors, diagnostic retention and large-backlog lock/memory evidence. |
| P1-019 | High | `api/sku-imports.js`, POST | Fresh isolated regression proves client success counts yield HTTP 201 / Processed history with no parsed file or SKU effect. | Fail closed for disconnected processor; preserve regression and historical evidence. |
| P1-020 | High | `inventory/workbook.js`, `workbook-inspector.js` | Compressed upload/row checks do not establish decompressed workbook/cell/CPU/memory bounds before ExcelJS load. | Parser/decompression budgets and controlled oversized/malicious workbook campaign. |
| P1-021 | High | `api/downloads.js`, PUT; `api/exports.js`, seed | Alternate methods can write content/status outside the reviewed create/processing validation. Ownership/tenant contract unresolved. | Uniform method schemas/bounds, server-derived provenance/status, owner/role predicates and regression tests. |

No index has been proposed or introduced without EXPLAIN evidence. No runtime repair is claimed in this packet.

## Fresh narrow verification

| Command | Result | Layer / exact claim | Limitation |
|---|---|---|---|
| `node scripts/audit-production-surface.mjs` | PASS | Offline current-source inventory | Candidate enumeration only; semantic review incomplete |
| `node scripts/verify-postgres-reliability.mjs` | PASS | Mock pool: bounded defaults, safe connection error, query timeout classification, recovery, constraint preservation, shutdown | No actual database, exhaustion or transaction termination in this run |
| `node scripts/verify-provider-reliability.mjs` | PASS | Injected transport: capped safe-read retries, circuit opening, auth/permanent failure classification, mutation no-retry | No genuine provider, distributed account pacing, 20-minute 429 or latency proof |
| `node scripts/verify-workbook-inspector.mjs` | PASS | Controlled workbook/loopback fixture: structural inspection, row-content redaction, 50,000-row limit | Initial sandbox listener denied; identical authorized rerun passed. No massive-workbook memory/CPU or full parser security campaign |
| `node scripts/verify-whatsapp-reliability.mjs` | PASS | Mock DB/transport and signed loopback callbacks: uncertain dispatch, retry classification, acceptance persistence boundary, callback tenant/signature/order checks, OTP controls | Initial sandbox listener denied; identical authorized rerun passed. No real Meta delivery or production DB |
| Real PG/Mongo outage, EXPLAIN, load, browser, staging, providers, backup/restore | NOT RUN | — | Required independent evidence |

The above verifiers ran under host Node 20.14.0. The project's current engine declaration requires Node 22.12+ in the listed supported major versions. These narrow results are not supported-runtime build/deployment acceptance.

## Part 1 completion checklist

Source inventory: implemented. Main dependency graph and prioritized findings: reviewed in the scope above. Exhaustive semantic review of every endpoint, query, parser, worker and screen: **incomplete**. Binary forensic dossier, dependency vulnerability feed, Git history, actual runtime listeners, authenticated browser, configured data and staging: **not refreshed**. No complete attack-surface or production baseline claim is made.

Next Part 1 work: trace all legacy route mounts into an endpoint matrix; review each handler's tenant/ownership/permission and database footprint; expand job/queue/transport/writer graphs; inspect remaining parsers, frontend HTML/storage, shutdown and deployment paths. Keep all 50 requirements in scope, with the 13 final reports produced as their evidence matures. Workload, p95/p99 targets and RPO/RTO remain unresolved.

Continuation evidence: the offline legacy matrix now resolves 159 mounted paths to 138 distinct handlers and 831 direct collection-reference candidates. [API_SECURITY_MATRIX.md](API_SECURITY_MATRIX.md) records the shared authentication trace, modern mount boundaries, storage findings and unresolved role/ownership verdicts. It is an initial required report artifact, not a completed security campaign. The source scanner's excluded text artifact is `docs/live-exploration/external-apps-dependent-controls-audit.json` (2,117,965 bytes), above its per-file budget; it still needs bounded targeted review. The endpoint/semantic checklist remains incomplete.

Queue/provider continuation: [QUEUE_RELIABILITY_REPORT.md](QUEUE_RELIABILITY_REPORT.md) and [PROVIDER_RESILIENCE_MATRIX.md](PROVIDER_RESILIENCE_MATRIX.md) trace the current queue contracts, worker/session lock graph and four outbound transport surfaces. Fresh `verify-phase-b-sqs.mjs` passed using injected transport/accept functions only; actual SQS/DB/IAM and staging remain NOT RUN. Slow-provider fairness, total Meta deadline and unbounded recovery/readback work are open findings. No runtime repair has begun.

Input/browser continuation: [PRODUCTION_SECURITY_HARDENING_REPORT.md](PRODUCTION_SECURITY_HARDENING_REPORT.md) records parser/export bounds and the editable/stored terms-to-HTML-sink dataflow. A permanent SKU import provenance regression FAILS under Node 24.21.0: disconnected processor creates Processed history from client counts. Direct Tally XML boundary and shared CSV/TXT/HTML serializer checks PASS within their narrow fixture scope. Browser XSS execution, decompression/CPU/large-file stress and method/ownership campaigns remain NOT RUN.

## Files added by this audit

| File | Purpose |
|---|---|
| `scripts/audit-production-surface.mjs` | Reproducible bounded, snippet-free source inventory |
| `docs/hardening/source-surface.json` | Per-file and candidate locations; explicit review limitations |
| `docs/PRODUCTION_SYSTEM_AUDIT.md` | Part 1 dependency graph, findings, fresh verification and remaining work |
| `scripts/audit-api-security-matrix.mjs` | Reproduce direct legacy handler and modern route mount traces |
| `docs/hardening/legacy-api-matrix.csv` | Per-mount ownership/permission review queue |
| `docs/hardening/legacy-api-evidence.json` | Line-level storage, import and method candidates |
| `docs/hardening/modern-api-evidence.json` | Modern literal route prefixes and unresolved security verdicts |
| `docs/API_SECURITY_MATRIX.md` | Required API matrix report with source findings and explicit evidence gaps |
| `docs/QUEUE_RELIABILITY_REPORT.md` | Queue/worker contracts, failure isolation and unverified recovery/admission/retention |
| `docs/PROVIDER_RESILIENCE_MATRIX.md` | Outbound transport boundaries, retry/uncertainty and per-capability evidence gates |
| `scripts/verify-sku-import-provenance.mjs` | Permanent no-false-success regression, currently failing against disconnected SKU import |
| `docs/PRODUCTION_SECURITY_HARDENING_REPORT.md` | Input/export/HTML findings, reproduced provenance violation and exact verification boundaries |

The goal remains active. Failure safety and production readiness are not yet proven.

## Authorized Mongo repair continuation

The later explicit user request to “check analyze and fix mongodb part” starts scoped Mongo runtime repair despite the broader Part 1 audit remaining incomplete. [MONGODB_FIXES_2026-10-08.md](hardening/MONGODB_FIXES_2026-10-08.md) supersedes the initial P1-013 unbounded shared-find/findOne observation for those shared reads. Specialized direct reads and tenant isolation remain unresolved. New read-boundary, existing mock recovery and corrected offline safety tests pass under Node 24.21.0. Real Mongo/Atlas/hosted acceptance is NOT RUN; production approval remains BLOCKED. Earlier statements that no runtime repair had begun describe the prior audit checkpoint only.

Mongo transaction continuation adds outcome-preserving session cleanup, explicit unknown-commit classification and bounded session-owned tax-group reads. Injected-session fault regression plus existing read/safety regressions PASS. Actual commit-loss, replica-set transactions and server-side timeout behavior are NOT RUN; direct mutation/readback and ownership work remain open.

## Current-state follow-up — 2026-10-09

The P1 rows above describe the earlier audit checkpoint. Reconcile them with current source before reuse:

- **P1-001 superseded in source:** GET `/balances` now delegates to `inventory/balance-read.js` with a tenant-scoped SQL limit of 10,001 (10,000 result rows) and an 8 MiB serialized-byte cap. The injected helper regression passes. Express/PostgreSQL route parity and representative cardinality remain NOT RUN.
- **P1-002 partly superseded:** `/summary` now uses one aggregate query and its injected-boundary regression passes. `readInventoryOverview` still materializes the tenant's full product/location/account/alert/mapping sets; database semantics, query plans and UI-compatible pagination remain unverified.
- **P1-019 resolved at the source boundary:** the disconnected SKU import now returns HTTP 501 without creating a processed-history row or changing SKU records. Its explicit in-memory verifier passes. Actual SKU ingestion remains unimplemented.
- **P1-020 remains open:** a synthetic 50,002-row workbook (830,101 compressed bytes) used 458 MiB max RSS across workbook generation plus inspection; this is not parser-only memory or a production load result. ExcelJS decompression/cell/job/output budgets are still absent. The inspector HTTP verifier did not complete because local bind returned EPERM.
- **Returns mutation follow-up:** the untyped `/api/returns` POST/PUT/DELETE fallbacks were reproduced creating and rewriting caller-selected return status/fields in memory. Those fallbacks now return 501; `verify-returns-integrity.mjs` passes record non-mutation checks. This does not establish authenticated role/object ownership or enable missing physical return, QC, restock or refund workflows.
- **Inbound CSV:** duplicate headers and alternate radix/exponent integer spellings are now rejected in the browser parser; the focused helper test, typecheck and Vite build pass. No browser/server receipt integration claim follows.
- **PO receipt admission:** pending receipt GRNs now count against PO capacity inside the Mongo staging transaction, and a two-route concurrency case has been added. Static/offline checks pass, but its owned Mongo/PostgreSQL test is NOT RUN because disposable PostgreSQL initialization failed before application tests.

These follow-ups update selected observations only. The route-by-route, tenant/role, workflow, performance, provider, disaster-recovery and production readiness audit remains incomplete.

