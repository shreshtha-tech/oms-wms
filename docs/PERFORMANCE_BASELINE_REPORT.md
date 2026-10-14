# Performance baseline report

Campaign checkpoint, 2026-10-08. **PERFORMANCE: BLOCKED.** Approved orders/minute, concurrent users, SKU/location/account cardinality, latency p95/p99, error budget and RPO/RTO remain unresolved. Disposable measurements are not launch acceptance.

## Measurement capability added

IMPLEMENTED: reliability/telemetry.js records process-local HTTP latency histograms by method and matched Express route pattern. Fixed cumulative bounds in milliseconds: 1,5,10,25,50,100,250,500,1000,2500,5000,10000,30000,60000, plus overflow. Each series includes count, sum and maximum. At most 512 histogram series are retained; excess new series increment latency_series_dropped_total while existing series remain updateable. Snapshot copies prevent callers mutating live buckets. Invalid negative/nonfinite samples are ignored. Authenticated internal metrics adds latencyHistograms alongside existing scalar metrics; no raw URL, query, provider credential or request payload is added as a histogram label.

TESTED: verify-latency-histograms.mjs PASS for inclusive cumulative boundaries, sample count/sum/max, overflow, invalid samples, snapshot isolation, cardinality cap and observable drops. These are deterministic instrumentation tests, not workload percentiles. Histograms can support approximate bucket-range percentile analysis once traffic is measured; they do not provide exact p95/p99 from these tests. Metrics reset on process restart and do not yet have durable aggregation, time windows or dashboards. Completed responses are observed; aborted requests and business order/publication end-to-end latency still need instrumentation.

## Current measurements

Vite build: 1,949 modules in 6.29 seconds; this is build duration, not user latency. Owned Mongo ID lookup fixture: 10,001 documents examined without ID index, one document/one key with a disposable unique ID index. Owned PostgreSQL failure harness: bounded test deadlines and rollback/recovery PASS. See DATABASE_PERFORMANCE_REPORT.md for scopes; no sustained API, order, publication or mixed-workload p50/p95/p99/max measurements exist yet.

## Required baseline campaign

Declare host/runtime/store configuration, workload distribution, cardinality, concurrency, provider-account skew, payload/workbook sizes, warmup and duration. Measure API/login/search/export/order/receipt/publication/queue latency, event-loop lag, CPU/RSS, connection wait, query plans/locks/deadlocks, provider duration, backlog age and resource ceilings. Verify business invariants and inspect rejected/uncertain work alongside performance. Store timestamped measurements and compare against explicit targets before passing any gate. No configured environment was load tested or production SLO invented.

HTTP integration evidence now PASS: scripts/verify-http-latency-integration.mjs sends 12 instrumentation-only requests through production middleware using three fixed workers on an owned loopback listener; completed sample/request counts match and dynamic object/query values are absent from labels. This verifies collection behavior, not sustained throughput or business latency. See LOAD_TEST_REPORT.md.

Receipt polling bound: both Inbound Create/Edit and Inbound RealTime now schedule status reads three seconds after the previous read settles. A slow 30-second read no longer accumulates ten overlapping reads per mounted effect. Existing active/request-identity guards remain. Cleanup prevents rescheduling but does not cancel a read already dispatched; its result remains ignored after unmount. This controls polling concurrency per effect, not fleet capacity or measured SLOs.

TESTED: verify-receipt-poll-boundary.mjs PASS with actual transpiled scheduler and controlled timers for slow reads, completion, cleanup during reads, and transient failure. Source integration checks cover both screens. Hosted receipt timing and cross-store recovery remain separately unverified.
