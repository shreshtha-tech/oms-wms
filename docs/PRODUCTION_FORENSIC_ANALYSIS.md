# Production Forensic Analysis

Assessment date: 2026-10-07. Analysis artifact only. It examines current source and existing audit records, including the uncommitted Phase B checkpoint. No production code or configured data was changed for this report. Earlier test results are historical evidence and were not rerun during this analysis.

Evidence scale: A source implementation; B unit/fixture; C disposable database; D real local integration; E signed-in browser; F configured environment; G real provider; H hosted/staging; I production-like end-to-end. Levels apply only to the exact claim.

## 1. Executive Summary

Agon contains a substantial PostgreSQL Central Inventory ledger, selected unified-order adapters, durable task/outbox patterns, a WhatsApp alert lifecycle, and numerous legacy Mongo-backed OMS/WMS modules. It does not prove the complete enterprise order-to-cash, warehouse custody, returns, marketplace publication, and reconciliation lifecycle for any provider.

Meaningful recent evidence comes from generated PostgreSQL/Mongo tests for selected reservations, pack conversion, duplicate handling, cancellation/dispatch races, returns, callback progression, tenant-scoped worker claims, cross-store inbound receipt replay, and failure injection. This is C evidence unless a narrower result says otherwise. The 2026-10-04 configured inventory snapshot found 3,243 central SKUs and 636 mappings but zero Central Inventory locations, balances, events, or reservations. A dated Shopify probe authenticated and read shop identity/scopes, but location access was rejected and no inventory write/readback was attempted. The 2026-10-05 reliability report later recorded Mongo TLS and authenticated ping recovery, without proving populated operational business data.

**Decision: NOT PRODUCTION READY.** No complete real-feed-to-ledger-to-warehouse-to-provider-readback path has provider, hosted, or production-like evidence. Core launch blockers include no demonstrated legitimate physical stock/location basis, missing or incomplete order recovery for several channels, absent full warehouse custody workflow, incomplete RMA/QC lifecycle, unproven publication/readback/reconciliation, incomplete role and legacy-route security evidence, and no measured recovery/capacity/DR objectives.

## 2. Actual Business Objective

The objective is a multi-channel real-time eRetail OMS/WMS platform: authenticate and tenant-scope marketplace orders; durably ingest and normalize them; map SKU, pack and location; reserve authoritative physical stock; execute warehouse work and exact dispatch; handle cancellation, return and refund without corrupting physical quantities; publish absolute marketplace stock; read it back and reconcile; and send operational WhatsApp alerts with durable provider-confirmed status.

The source only partially achieves this. PostgreSQL Central Inventory is intended to own physical quantities, while Mongo owns much commercial/procurement intent and legacy modules. ADR-001 is proposed, with unresolved ownership decisions D01–D12. The presence of code or UI is not evidence of workflow completion.

## 3. Current Architecture

- Frontend: React/Vite under src, with Central Inventory, Unified Orders, inbound receipts, legacy OMS/WMS, channel setup, returns and alert administration. Modern order views use PostgreSQL routes; many legacy views read Mongo generic records.
- Backend: Express wiring in server.js; session/auth and health middleware; modern routes in inventory/http.js and inventory/unified-orders.js; domain logic under inventory/; legacy APIs under api/.
- PostgreSQL: ci_inventory_event, ci_inventory_balance, ci_reservation, provider accounts/mappings, ci_unified_order/lines, task/outbox, observations, alerts and receipts.
- MongoDB: commercial masters, legacy records and procurement intent. Current Phase B receipt bridge uses durable Mongo outbox/inbox around a PostgreSQL consumer.
- Workers: scripts/inventory-worker.mjs supervises tenant-scoped work; inventory/workers.js handles tasks/publication; scripts/inventory-amazon-sqs.mjs is a separate SQS CLI; inventory/whatsapp.js sends alerts.
- Provider edge: inventory/connection-provider.js, inventory/connections.js, inventory/connectors/, inventory/shopify-orders.js and inventory/sqs-worker.js support differing, incomplete provider paths.

ADR-001/002/003, event catalog/schemas, ownership matrix, storage inventory and module matrix are design/static/source artifacts. ADR-001/002 remain proposed. Catalog event schemas do not imply every native flow uses them at runtime.

## 4. Current Data Flow

Shopify: raw webhook → inventory/http.js validation → inventory/ingress.js HMAC/delivery digest → transaction writes ci_ingress/order/timeline/task via inventory/unified-orders.js → inventory/workers.js maps/reserves or handles provider-authorized shipment → ledger/outbox → provider publication. Shopify recovery polling in inventory/shopify-orders.js is observational and does not enqueue stock reservation tasks per ADR-002.

WooCommerce: signed webhook → durable task → worker mapping, pack conversion and reservation/completion/cancellation. General order polling recovery is not evidenced; product.updated is documented as a no-op.

Amazon MFN: SQS notification → inventory/sqs-worker.js durable acceptance → queue deletion → order worker. Fixture tests cover poison isolation; queue subscription, IAM, visibility, DLQ/redrive and hosted consumer are unknown.

Meesho/report paths ingest validated files but do not establish a real-time API feed or ledger effect. Programme reports associate with existing orders and do not create orders or physical movements. Flipkart has token/probe scripts but no complete order adapter.

Ledger commands in inventory/ledger.js append events, update balance/reservation, evaluate alerts and enqueue publish work in the caller’s transaction. Workers derive sellable quantities and call providers. External HTTP/SQS/Meta calls cannot share DB transactions. Crash after remote success but before local acknowledgement is an unknown state requiring readback/reconciliation. Inbound receipt Phase B uses Mongo durable command → PG consumer/ledger/result outbox → Mongo projection; this is replayable across local transactions, not a distributed ACID transaction.

## 5. Marketplace Capability Matrix

| Provider | Auth / order feed | Stock / fulfillment | Evidence and limits |
|---|---|---|---|
| Shopify | Client auth and identity code; signed webhook and observational poll | Worker reservation/cancel; stock publisher and some readback code | Narrow configured auth/identity G on 2026-10-04; granted scopes lacked read_locations. No configured write/readback or feed delivery proof. A/C elsewhere. |
| WooCommerce | Connector and signed webhook | Worker reservation/completion/cancel; publisher source | A/C; no current real auth, feed recovery or hosted proof. |
| Amazon MFN | SP-API/SQS source | Order-level full shipment policy; partial shipment review-only; publisher source | A/C; live queue/subscription, permissions, write/readback and hosted consumer unverified. |
| Flipkart | Token check/probe scripts only; no order poller/webhook adapter | No Central Inventory order worker or stock lifecycle | A; prior chat check observed GET token 200 and POST 403, token only. Not order permission evidence. |
| Meesho | Report/file intake, not live API feed | No live provider reservation/publication verified | A/B/C file path only. |
| AJIO | Legacy/JIT APIs and replication artifacts | No complete central-ledger lifecycle shown | A/B/E for scoped legacy workflows; no complete provider proof. |
| Amazon FBA/programmes | Report/custody association | Does not create parent orders or warehouse stock movements | A/C; provider contract unverified. |
| Myntra, BigBasket, Snapdeal, quick-commerce, others | No complete central provider adapter established in reviewed paths | No full order/stock/reconciliation lifecycle established | UNVERIFIED; UI/config labels do not prove support. |

Provider-specific registration, account ownership, scopes, rate limits, cancellation/return semantics and readback remain per-account gates.

## 6. Real-Time Order Feed Audit

Shopify raw HMAC and delivery digest handling persist supported ingress transactionally. Updated events and observation-only accounts do not imply stock intake. The documented poll uses a five-minute overlap, 30-day first lookback and bounded pagination; late records beyond overlap/cursor edge cases need provider tests. Woo signed webhook/revision guards exist, but no general order recovery poll is evidenced. Amazon SQS accepts durably before delete, but queue configuration and deployment are unverified. Meesho/programme files are not real-time feeds. Flipkart order feed is absent.

Identity is tenant + account + external order ID; shipment/package identity is a separate provider fact. Selected paths have duplicate/revision handling and mapping failure behavior, but there is no uniform durable cursor, missing-event recovery, provider freshness SLO, schema-change strategy, return/cancellation feed or hosted worker proof. The end-to-end chain stops at incomplete provider delivery, mapping/location basis, and warehouse operation.

## 7. Central Inventory Audit

inventory/ledger.js is the quantity authority: event, balance, reservation, alerts and publish outbox share the caller’s PG transaction. Generic arbitrary event API returns 501. Writer register docs list 12 source families, including adjustment/count, transfer, inbound, workbook, provider order, return and internal ledger. That is not exhaustive proof against dynamically assembled SQL, all scripts, migrations or legacy writers.

Selected tests cover idempotency, nonnegative/reservation behavior, pack conversion, mapping identity, oversell, cancellation/dispatch races and return receipts (C). Provider quantities are observations, not physical truth. The cited configured snapshot had no locations or physical ledger basis. ADR ownership remains proposed; bin/lot/serial and historical reconciliation are incomplete. No synthetic opening balance should be used.

## 8. Inventory Publication / Readback Audit

Ledger mutation queues publish work transactionally. inventory/workers.js derives sellable quantity and pack conversion, serializes mapping operations and calls provider adapters. Some source paths support acknowledgement, observation or readback; states are not a uniform provider contract. Absolute quantity is safer than delta but timeout after remote acceptance remains unknown. Provider idempotency, CAS and eventual consistency must be confirmed per adapter.

Configured Shopify auth/read was observed, but no write or mapped quantity readback was attempted; location scope was absent and configured internal locations were zero in the cited snapshot. Therefore Central Inventory → provider ack → independent readback → mismatch recovery has no complete provider evidence.

## 9. Order Reservation Audit

Selected Shopify/Woo/Amazon workers resolve mapping and call the ledger. Generated DB tests cover exact replay, pack-size conversion, mapping changes, reservation identity and oversell. Correctness in a test DB does not prove real account/SKU/location mapping. With no verified location/balance basis in the cited configured snapshot, correct physical reservation is not operationally established.

## 10. Fulfillment Audit

Unified Orders holds provider/work status; selected provider shipment snapshots can consume reservations under policy. Legacy fulfillment, picklist and shipment APIs are not equivalent to physical proof. ADR-001 identifies missing complete PG pick/pack/shipment/bin/lot/serial domain. Phase B says handover scan/manifest and partial package deductions remain outside scope. Exact stock consumption has selected C evidence; warehouse custody and carrier handover are not a complete source-of-truth chain.

## 11. Cancellation Audit

Provider and local work status are separated until worker transition succeeds. Selected workers require exact line set and original SKU/location identity and release once. Generated tests cover replay, stale revision and cancellation/dispatch races. Live cancellation delivery, provider-specific status semantics, mapping changes during real processing and manual reconciliation remain unverified. A refund must not restore physical stock.

## 12. Return / Refund Audit

inventory/return-service.js supports explicit receipt approval with request identity, row locking, dispatched quantity caps and idempotent stock effect; generated DB tests cover concurrent replay/over-return boundaries. Legacy Mongo return APIs are separate. This is not the full RMA: request, authorization, pickup, receipt, QC, restock/damaged disposition, refund and provider reconciliation are not all represented. No parcel, QC or provider refund was observed. Refund alone is not proof of physical return.

## 13. WhatsApp Audit

inventory/order-alert-routing.js and inventory/whatsapp.js implement tenant-scoped alert selection, rate limiting, send attempts, provider IDs and callbacks. Tests cover dedupe, tenant isolation, callback monotonic progression, duplicate timestamps and rollback on audit failure (C). Phase B delays packing readiness until reservations. No Meta message acceptance/delivery/read was verified. Sender/account ownership, public callback, consent/template, live rate limits and uncertain send recovery remain provider/host gates. UI must distinguish accepted, sent, delivered, read and unknown based on evidence.

## 14. Worker / Queue Audit

PostgreSQL claims use tenant predicates, leases, attempts, retries/dead states and supervisor recovery. Recent generated tests cover tenant isolation, bad credential diagnostic, retry/dead-letter, lease reclaim, atomic task/audit completion and SQS poison isolation. Phase B adds jitter. SQS deployment/redrive, multi-instance behavior, host restart, real DB outage during failure recording, load-driven lease expiry and remote-success/local-failure remain unverified. D11 throughput/recovery budgets are pending.

## 15. Database / Transaction Audit

PG transactions protect ledger and selected order/task/alert mutations. Mongo receipt command and projection use local transactions; PG receipt consumer uses its own transaction. There is no cross-database ACID. Crash before local commit should roll back; after commit before response requires same-key replay. PG commit before Mongo projection leaves pending durable projection. Provider success before local ack yields unknown remote state. DB failure during retry/audit can leave a lease for later reclaim. TLS, database outage and schema absence must remain fail-closed; no memory fallback.

## 16. Concurrency Audit

Generated DB evidence exists for final-stock oversell races, cancellation/dispatch, return receipts, callback status ordering, tenant claims, mapping identity and inbound replay. Still unverified: simultaneous real channels on configured stock, multiple deployed workers, provider poll/webhook overlap, mapping/pack edits during processing, publish versus adjustment, account permission changes, callback versus send acknowledgement, and cross-instance production locks. No full provider concurrency campaign exists.

## 17. Idempotency Audit

Delivery IDs, digests, request UUIDs, unique constraints, event keys, order/reservation identity and task state protect selected operations. Exact replay and changed-payload conflict have C evidence in several paths. This is not universal exactly-once external processing. Provider timeouts require provider idempotency/readback or reconciliation. Legacy imports and unrelated mutations require separate audit.

## 18. Security Audit

- Authentication/session: server.js and middleware protect modern routes; rate-limit/session migrations exist. Authentication is not role authorization; single-admin role matrix remains unresolved.
- Tenant/BOLA: modern worker and alert claim scoping has generated tests. All legacy APIs, callbacks, malformed foreign references and every account lookup are not exhaustively proven.
- Webhooks: Shopify/Woo raw-body signature and digest paths exist. WhatsApp callback signature/tenant ownership requires full route audit; Amazon trusts queue/IAM boundaries not yet configured evidence.
- Credentials: inventory/credentials.js uses AES-GCM. Recent reports repair selected secret serialization/log boundaries. Historical Mongo documents may still contain plaintext. Key rotation/backup and hosted custody are not proven.
- Outbound security: connection-security.js has guarded provider requests; exhaustive SSRF/DNS rebinding and all callers remain to review.
- Inputs: SQL parameterization is common in modern PG paths. CSV/XLSX/XML, path handling, Mongo operator injection, XSS, CSRF/origin and legacy route response boundaries need endpoint-specific review.

No destructive security tests were performed.

## 19. Frontend / UI Audit

Unified Orders separates provider/work status. Phase B inbound UI treats 202 as queued and polls authoritative projection while retaining request identity. Selected inventory forms preserve retry IDs. Operations API reports scoped real queue metrics and fails closed on query errors. These are source/focused test results, not complete signed-in production browser evidence.

Legacy screens depend on Mongo and may show blank/unavailable when data is absent or DB unavailable. Provider labels can be stale; an earlier false-verification bug was repaired, but explicit fresh probe is still required. Operators lack a consistent view of feed freshness, mapping failures, unknown remote state, return/QC backlog and provider readback mismatch. Destructive role controls and stale response races need broad browser review.

## 20. Observability Audit

/health/live and /health/ready are distinct. Authenticated database, metrics and operations routes expose sanitized dependency, queue, dead-letter and heartbeat state. Metrics are process-local. docs/reliability/OPERATIONS.md proposes alert thresholds, explicitly not capacity-tested SLOs; external time-series and alert destination must be configured. Drift is to be investigated against ledger, not auto-corrected from provider quantity. Durable feed freshness, cross-instance traces, tested external paging and order-to-visible latency are missing.

## 21. Failure Injection Coverage

Historical reports document generated DB injections for ledger/receipt rollback, child SIGKILL after PG receipt commit, duplicate/digest conflict, sequence gap, lease reclaim, wrong credential diagnostic, cross-tenant tasks/alerts, mapping mismatch, callback ordering/audit rollback, task success-audit failure and SQS poison isolation. Phase B harness uses owned loopback Mongo replica set and PG _test databases, allowlisted environment and outbound guard.

Not evidenced: real provider timeout-after-success, live 429/5xx/DNS/auth expiry/schema change, hosted DB failover, host loss, backup restore, deployed SQS redrive, Meta outage, real provider readback mismatch, full webhook gap recovery or production-like multi-provider restart.

## 22. Test / Fixture Quality Audit

The script catalog is broad. Tests range from source/handler fixtures and mocked providers to generated PG/Mongo integration, concurrency, crash injection and browser flows. Claims must remain scoped to the exact assertion. A fixture signature is not real provider verification; generated DB is not configured tenant; local browser is not hosted deployment.

The latest Phase B harness is stronger than older runners. Prior reliability guidance flags scripts/run-isolated-mongo-reliability.mjs for non-_test names and inherited environment; do not rely on those older results as compliant without verifying runner provenance. Phase B evidence explicitly does not cover Atlas, provider, Meta, Render, browser timing, DR, or all runtime event schemas. Static matrix integrity is not workflow correctness.

## 23. Deployment / Infrastructure Audit

Render blueprint, readiness/liveness, explicit migration step, shutdown and supervisor designs exist. HTTP startup does not automatically apply migrations. SQS CLI deployment is unclear. Required hosted provider workers, secrets, queue policy, public webhook TLS and Meta callback remain configuration gates. Historical configured Mongo/PostgreSQL observations are time-bound; no staging/production migration, worker restart, rollback, restore, DR, capacity or production-like E2E proof was found. Deployment readiness is unproven.

## 24. Production Readiness Scorecard

0 absent; 1 conceptual; 2 implemented; 3 internally tested; 4 real environment tested; 5 production proven. Scores apply to the full target:

| Area | Score | Reason |
|---|---:|---|
| Architecture | 2 | Useful boundaries, unresolved ownership decisions and legacy duplication. |
| Orders | 2 | Selected implementations/tests; complete feeds and hosted proof absent. |
| Inventory | 2 | Ledger and invariants; configured physical stock basis absent in cited snapshot. |
| Marketplace integration | 1 | Uneven adapters; broad provider set unsupported/unverified. |
| Returns | 2 | Receipt path tested; full RMA/QC/refund lifecycle absent. |
| Fulfillment | 1 | Dispatch guards, incomplete warehouse custody. |
| WhatsApp | 2 | Queue/status code tested; no Meta lifecycle proof. |
| Security | 2 | Specific fixes/tests; roles, legacy and hosted boundary incomplete. |
| Reliability | 2 | Leases/health/failure tests; no hosted SLO/recovery proof. |
| Concurrency | 3 | Strong selected generated DB races; configured/hosted races absent. |
| Data integrity | 2 | Ledger/outbox patterns; ownership and cross-store limitations remain. |
| Observability | 2 | Operations routes exist; process-local metrics and no alert proof. |
| Frontend | 2 | Selected truthfulness/retry improvements; no complete browser acceptance. |
| Operations | 1 | Some controls; provider/reconciliation runbooks incomplete. |
| Deployment | 1 | Blueprint/design exists; worker and hosted proof missing. |
| Testing | 3 | Broad suite and improved isolated failure harness; no provider/hosted E2E. |
| Disaster recovery | 0 | No verified restore/RPO/RTO or host loss evidence. |

No full capability receives 4 or 5.

## 25. P0 Findings

### P0-1: Physical inventory basis not demonstrated
Why: cannot reserve correct stock without real location and opening quantity. Where: ci_location, ci_inventory_balance, ci_inventory_event, inventory/ledger.js; configured snapshot in CONFIGURED_EVIDENCE_2026-10-04.md. Current: cited counts were zero. Evidence F, time-scoped read. Fix: owner-approved location, mappings and audited opening/count events; never synthetic stock. Test: readback, ledger conservation, multi-channel reservation and reconciliation.

### P0-2: Complete live order-to-reservation chain unproven
Why: missing/stale events or mappings lose orders or oversell. Where: inventory/http.js, ingress.js, unified-orders.js, shopify-orders.js, sqs-worker.js, workers.js; Flipkart adapter absent. Current: selected local paths; Shopify poll observational, Woo poll absent, Amazon deployment unknown. Evidence A/C and narrow Shopify auth G. Fix: complete provider-specific feed/recovery and disable unsupported automated channels. Test: real duplicate, out-of-order, missing-event and mapping scenarios with ledger/UI readback.

### P0-3: Warehouse custody/handover is incomplete
Why: provider status alone may consume stock without exact physical handover. Where: inventory/workers.js and legacy fulfillment/picklist/shipment APIs; ADR-001 D06. Current: selected provider shipment deduction; scan/manifest and partial package operation remain out of scope. Evidence A/C. Fix: approved WMS transitions and custody identity. Test: split packages, replay, exact reservation conservation, browser and provider readback.

### P0-4: No complete publication/readback/reconciliation proof
Why: marketplace quantity can diverge and oversell. Where: ledger, workers, connectors, ci_stock_observation. Current: source/local tests, no configured write/readback, no internal location in cited snapshot. Evidence A/C and narrow auth G. Fix: exact provider/location contract and explicit ack/readback/unknown states. Test: timeout after remote success, mismatch and safe recovery.

## 26. P1 Findings

- P1-1 Provider support is uneven. Flipkart token access is not order access; Meesho reports are not live feed; AJIO legacy workflows are not central inventory support; other channels are unverified. Evidence A/B/G-token-only. Disable unsupported capability.
- P1-2 Cross-store inbound receipt uses a durable bridge, not global transaction. C evidence covers selected crashes; hosted polling and projection repair remain unverified.
- P1-3 Return/refund/QC is incomplete. Only explicit physical receipt restores modern central stock; define custody, disposition and historical identity before automated return effects.
- P1-4 WhatsApp lifecycle and callback ownership lack live Meta proof. Verify sender tenant, callback binding, public HTTPS, consent, uncertain send and delivery status.
- P1-5 Fine-grained roles and all legacy tenant boundaries remain unproven. Session auth is not role authorization.
- P1-6 SQS/worker hosted recovery is unverified: deployment, redrive, multi-instance, kill/restart and DB outage during failure recording.
- P1-7 Operator truth is fragmented across PG and Mongo. Expose empty/unavailable/stale/blocked/unknown distinctly and provide feed/mapping/reconciliation controls.

## 27. P2 Findings

- Event schemas/catalog do not mean all native paths are versioned consumers.
- Shopify poll cursor and late-order recovery need provider-backed fault tests.
- Historical account labels and terminal line snapshots may be stale; reconcile, do not rewrite.
- Mapping revision, location, pack, split shipment and provider observation review need UI support.
- Metrics lack durable retention, trace correlation and proven alert delivery.
- Generic/legacy APIs, dynamic records, uploads and duplicate implementations need targeted security/data-owner review.
- Module matrix/static source binding is an inventory aid, not acceptance evidence.

## 28. P3 Findings

- Improve operator UI explanations for queue age, unknown remote state, mapping review and freshness after core controls are defined.
- Consolidate duplicate legacy modules only after ownership/migration approval.
- Add latency dashboards after D11 targets are approved.
- Document enabled provider modes and exclusions in connection setup.

## 29. Missing Capabilities

Complete per-provider order feed and recovery; approved SKU/location/pack identity; real stock basis; full WMS allocation/pick/pack/handover; return/RMA/QC/refund lifecycle; uniform publish/ack/readback/reconciliation; provider-specific rate-limit/schema/auth handling; hosted SQS/receipt/WhatsApp workers and DLQ; fine-grained roles; durable monitoring/DR; unified operator control plane; real-provider, staging and production-like evidence.

## 30. Recommended Target Architecture

Keep PG Central Inventory as sole physical quantity authority. Assign each domain one owner; use durable outbox/inbox projections across Mongo/PG. Provider adapters should bind tenant/account, approved SKU/location/pack revision and provider version. Intake authenticates, persists delivery identity/digest and source revision, then commits normalized order transition and durable downstream work. Workers use tenant leases and provider idempotency; uncertain external outcomes require readback/reconciliation, never blind delta retry.

Model warehouse allocation, pick, pack, package, handover, delivery, cancellation and return custody as explicit state transitions. Only physical evidence may consume/restore stock. Publication uses absolute quantities, monotonic revisions, explicit acknowledgement, independent readback and operator reconciliation. WhatsApp stays separate from stock correctness and records provider message ID plus signed monotonic callbacks. Control plane exposes feed freshness, mapping readiness, queue/lease/dead letters, reservations, publish/readback mismatch, returns/QC and notification health with timestamps and source evidence.

## 31. Required Production Fixtures

Use only synthetic/sanitized fixtures, never as opening stock: per-provider create/update/cancel/replay/revision/multipage/partial-shipment envelopes; tenant/account/SKU/location/pack graph with missing/duplicate/remapped cases; test-only audited ledger opening events; provider success/auth/429/5xx/timeout-after-commit/schema drift/stale readback responses; WhatsApp duplicate/reordered/wrong-sender callbacks; Mongo/PG receipt kill points; two-worker leases/poison/DLQ; return physical receipt/QC/over-return/refund-without-return. Each fixture must state provider version and whether the response is simulated.

## 32. Required Real-Provider Tests

For every enabled provider, verify credential decrypt, auth, account identity, scopes, subscriptions, location access, safe order read, delivery and poll recovery, exact normalization/mapping, replay, cancellation/return/fulfillment, absolute stock write, acknowledgement, independent readback, mismatch repair and error classification. Use an owner-approved test SKU/location before mutation. Flipkart specifically requires sanitized shipment response keys and Seller_Api permission proof before order normalization/polling. WhatsApp requires a controlled recipient/template and public HTTPS callback with sender/tenant binding; do not message customers as a test.

## 33. Required Staging Tests

Prove migrations and rollback policy, web and every worker, real queue/DLQ, provider feed recovery, concurrent cross-channel same-SKU orders, reservation/dispatch/cancel/return accounting, provider timeout-after-success, readback mismatch, Meta callback recovery, tenant attacks, kill/restart at commit boundaries, DB outage, backlog/throttle, external alerts and operator diagnosis. Use isolated staging identities and non-production stock. Capture sanitized IDs/timestamps. Staging is not production proof.

## 34. Required Launch Gates

1. Approve ADR ownership/provider scope D01–D12.
2. Establish legitimate stock, location and SKU/pack mappings.
3. Each enabled provider passes real auth/feed/write/readback/recovery.
4. Order-to-warehouse-to-dispatch and cancellation/return pass concurrent/failure tests.
5. Unsupported providers cannot run automated stock-changing work.
6. Complete role, tenant, callback and legacy-route security review.
7. WhatsApp live lifecycle and uncertain-send recovery pass controlled test.
8. Hosted migrations, all workers, restart, DLQ and rollback are proven.
9. Measure SLO/RPO/RTO, capacity, monitoring, alert delivery and backup restore.
10. Operators can distinguish stale, blocked, failed, unknown, queued and reconciling.
11. Independent reviewer accepts sanitized production-like evidence.

## 35. Dependency Order for Fixes

1. Approve system ownership and provider scope, especially D01–D12.
2. Establish real location, identity mappings and audited opening/count events.
3. Complete provider feed/recovery before enabling automated reservations.
4. Complete WMS custody and package identity before physical dispatch deductions.
5. Define cancellation, return/QC/refund policies against immutable original identity.
6. Complete publication/readback/reconciliation and unknown-outcome behavior.
7. Finish role/tenant/security and operator control plane.
8. Deploy workers/queues/monitoring with measured SLO and DR.
9. Run isolated adversarial, real-provider, staging E2E and independent launch review.

Current Phase B evidence says D11 and latency/fault evidence remain pending and Phase C must not start yet.

## 36. Things That Must NOT Be Changed

- Do not weaken TLS/fail-closed behavior or add memory/fake-provider fallback.
- Do not fabricate locations, mappings, opening quantities, provider events or business records.
- Do not bypass Central Inventory ledger for physical mutations.
- Do not treat provider observations, reports, programme stock, refund or metadata status as physical proof.
- Do not infer account, SKU, location, pack size, permission or status.
- Do not blindly retry uncertain provider mutations; read back or reconcile.
- Do not claim event catalog schemas are runtime contracts for native paths that do not consume them.
- Do not promote implementation, fixture pass, configured auth, provider acknowledgement or readback into production readiness.
- Do not automatically rewrite historical reservations, returns or line identities.
- Do not use the previously flagged unsafe Mongo harness without satisfying the current isolation contract.
- Do not alter existing uncommitted Phase B work as part of analysis.

## 37. Final Production Readiness Decision

**NOT PRODUCTION READY.**

| Question | Answer from current evidence |
|---|---|
| Real marketplace order reaches Agon automatically? | Selected source paths; no complete deployed real-feed proof. Flipkart: no. Shopify poll observational; Woo recovery absent; Amazon queue deployment unknown. |
| Reserve correct physical stock? | Selected adapters tested locally; real mapping/location/stock basis not established. |
| Concurrent channels avoid overselling? | Selected generated DB races pass; configured/hosted cross-provider case unverified. |
| Fulfillment consumes exact reservation? | Selected provider snapshot tests; complete WMS custody/handover missing. |
| Cancellation safely releases stock? | Selected local paths tested; live provider lifecycle unverified. |
| Physical return restores correctly? | Modern receipt path locally tested; physical parcel/QC/provider lifecycle absent. |
| Publish correct central quantity? | Source and local tests; configured write/readback absent. |
| Read marketplace quantity back? | Some code paths exist; no complete provider cycle established. |
| Detect/recover mismatch? | Partial code/operations; real mismatch recovery unverified. |
| WhatsApp sends operational alert? | Send pipeline implemented; Meta acceptance/delivery/read unverified. |
| Survive duplicates? | Selected paths tested, not every provider path. |
| Survive worker restart? | Lease/supervisor local evidence; hosted restart unverified. |
| Survive timeout after remote success? | Policy recognizes unknown state; provider reconciliation proof missing. |
| Preserve tenant isolation? | Modern worker/alert generated DB tests; all routes/roles/callbacks/deployment unverified. |
| Operators see true health? | Partial controls; feed, mapping, readback and return states fragmented. |
| Deployed environment does all of this? | No evidence supports this. |
| Exact work before launch? | Close Section 34 gates, beginning with ownership, real stock/mappings, provider feeds and warehouse custody. |

IMPLEMENTED means source exists. TESTED means a specific assertion passed. REAL ENVIRONMENT VERIFIED applies only to dated configured observations. PROVIDER VERIFIED applies only to the exact provider operation exercised. PRODUCTION READY requires the complete hosted lifecycle and launch gates above. These states are not interchangeable.

## 38. 2026-10-08 Inventory Publication Recheck

The local publication worker now snapshots the source ledger event (when present), provider/account and SKU/location mapping identity, pack size, expected quantity and Agon request fingerprint on the durable outbox command before a remote stock mutation. It separately records a sanitized provider response reference and acknowledgement timestamp, then the independent readback quantity/time and match or mismatch result. A response timeout remains `UNKNOWN_REMOTE_STATE`; received acknowledgement without readback becomes `READBACK_PENDING`; a differing readback remains held as `MISMATCH`. The operator publication view exposes these fields.

On 2026-10-08, `npm run test:stock-publication-isolated` passed in fresh owned loopback PostgreSQL `_test` databases using simulated Shopify, WooCommerce and Amazon responses. It covered dropped mutation responses, matching and mismatching readbacks, lease expiry, no blind resend, acknowledgement followed by readback outage, later readback-only recovery, publication ordering and mapping lock. Typecheck and diff/syntax checks passed. These are disposable source-path results, not real provider evidence. No production/configured database was accessed for this recheck.

This closes a local publication-audit trace gap but does not complete Section 8 or the launch gate. Provider response references are nullable when the provider response offers no safe stable reference. Live API contract/permission, account mapping, provider consistency, hosted worker recovery, persistent mismatch operator resolution, capacity, staging and production remain unverified. See [INVENTORY_PUBLICATION_ACCEPTANCE.md](INVENTORY_PUBLICATION_ACCEPTANCE.md).
