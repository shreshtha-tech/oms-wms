# Load test report

Campaign checkpoint, 2026-10-08. **LOAD/CAPACITY: BLOCKED.** Representative production or staging load tests are NOT RUN. No maximum orders/minute, SKU/account/location cardinality, concurrency, latency target, error budget or backlog recovery target is approved.

## Instrumentation readiness evidence

verify-http-latency-integration.mjs PASS under Node 24.21.0: an owned loopback Express listener mounted production requestTelemetry and accepted 12 instrumentation-only GET requests from three fixed concurrent workers, each with a 2-second client deadline. All completed with 204; histogram and request count both equal 12; request IDs propagate; labels use /instrumentation/:id and exclude object IDs and query values. Listener/connections cleaned. This is HTTP instrumentation verification, not a business workflow, authentication test, sustained-load test, real-provider simulation or capacity benchmark. No database or external provider was accessed.

Deterministic histogram tests separately verify fixed cumulative buckets, cardinality cap and visible series drops. Process-local cumulative metrics require collection windows/persistence to support a reliable campaign. Exact latency percentiles must come from timestamped request measurements or justified bucket approximations, with dropped/aborted requests included in outcomes.

## Required workload campaign

Run against isolated migrated stores with authoritative fixtures, then authorized staging/provider environments. Workload must include concurrent order intake/reservation/release, same-SKU contention, many-location distribution, multi-account publication, duplicate/out-of-order/missing ingress, search/report/workbook traffic and worker drain. Preserve ledger quantities, event identity, order state, tenant/account boundaries and honest uncertainty under every stage.

Stages: baseline steady state, increasing arrival rate, bounded concurrency, burst, sustained saturation, backlog accumulation/drain and recovery after dependency disruption. Record host/runtime/DB/pool configuration, cardinality/skew, data provenance, request mixture, warmup/duration, p50/p95/p99/max, errors/timeouts/rejections, CPU/RSS/event-loop lag, connection/query/lock waits, retries, task age, backlog counts and authoritative correctness checks. Add one-provider blackout/20x latency/long 429 alongside healthy provider and local business traffic. Stop conditions must include invariant violations, runaway resources and unexplained reconciliation gaps; a low error rate alone is insufficient.

Disk preflight currently blocks fresh Mongo restore work on this host, and host disk pressure must be recorded as a fixture limitation. No existing files/evidence were deleted. Fresh PostgreSQL fault checks and Mongo process-loss tests are failure-control evidence only. The system cannot be approved for enterprise capacity from the present results.

## Disposable ledger contention measurement

2026-10-08: run-phase-b-isolated.mjs scripts/measure-owned-ledger-contention.mjs PASS under Node 24.21.0 with fresh migrated stores. Four fixed workers reserve 100 synthetic orders against one SKU/location, release them, then replay every reservation. All 300 calls completed; exact correctness: 201 ledger events including opening stock, 100 released reservations, on-hand 100 and reserved_order zero. Raw per-operation timestamps/latencies, nearest-rank percentiles, sampled RSS, process CPU and event-loop delay are recorded in hardening/ledger-contention-evidence.json. The harness removes only owned services/data; providers/accounts/HTTP order intake are absent.

Measured run duration was about 245 ms; reserve p95/p99 about 8.26/14.40 ms, release 3.98/6.03 ms, duplicate replay 1.42/1.57 ms. These are host-specific application-ledger operation latencies in a tiny closed-loop fixture, not launch SLOs, API percentiles or sustained orders/minute. No rate/capacity extrapolation is valid. CPU includes setup and RSS samples can miss spikes. HTTP/full order flows, account/location skew, arrival-rate stages, sustained saturation, failure under load and approved workload targets remain unverified. Evidence status is set RUNNING before future executions and FAIL on failure so an older PASS is not left current.

Final rerun after evidence-status handling PASS: duration approximately 246 ms; reserve p95/p99 8.12/13.99 ms, release 4.15/6.40 ms, replay 1.55/1.91 ms. Exact invariants remained unchanged. Current JSON contains this final run; preceding paragraph records the first run. This repetition verifies the harness change, not statistical capacity confidence.
