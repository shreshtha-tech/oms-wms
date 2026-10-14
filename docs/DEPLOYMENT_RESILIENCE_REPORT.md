# Deployment resilience report

Campaign checkpoint, 2026-10-08. **DEPLOYMENT: BLOCKED.** Source and local configuration evidence only; no Render service was changed or deployed.

## Receipt worker Mongo configuration repair

Problem/root cause: scripts/inventory-worker.mjs schedules runReceiptBridgeBatch; inventory/receipt-bridge.js imports mongoDomainTransaction from api/mongo.js. The Render worker service lacked MONGODB_URI, MONGODB_DB and DMILLS_REQUIRE_PERSISTENCE while the web service declared all three. The configured worker therefore could not connect to the Mongo receipt-command/result store. Persistent domain transactions reject instead of committing in memory, but this configuration omission prevents propagation/recovery.

IMPLEMENTED: render.yaml now declares private MONGODB_URI (sync:false), explicit d_mills_global database selection, and required persistence for the worker, matching the web declaration. No secret value is committed. Existing deployments must configure the private URI for both services deliberately; a blueprint declaration does not establish that live values exist or point to the same intended store.

TESTED: scripts/verify-render-worker-storage.mjs parses the blueprint and checks both services require persistence, declare private URI without a value, select the same database and runtime, and use the worker supervisor. PASS on Node 24.21.0. This regression establishes configuration contract, not runtime connectivity or receipt propagation. No schema, business records or provider credentials changed.

## Shutdown/readiness source observations

Web liveness returns 200 even during stopping, with stopping status. Readiness uses shutdown state, authentication configuration, Mongo probe/dataset and PostgreSQL schema/dependency checks; source alone does not verify the hosting router's deployment behavior. The blueprint uses liveness for its hosting health check. Routing/readiness during dependency outage must be tested against the chosen availability policy before changing that setting.

Web shutdown stops accepting connections, closes idle connections and gives active HTTP connections 30 seconds before force-close. Pool closure happens after server close; the deadline does not independently cancel arbitrary application promises or guarantee process exit if pool cleanup hangs. The worker drains scheduled jobs while holding ownership; its supervisor escalates to SIGKILL after 30 seconds. Restart backoff caps at 30 seconds. Neither policy proves all work reaches a durable checkpoint before termination.

## Missing release evidence

Hosted environment validation (without exposing values), service readiness during rollout, migration ordering/rollback, rolling-version compatibility, restart at provider acceptance/local commit/receipt projection, durable lease recovery, queue drain and RTO measurements remain NOT RUN. Multi-service Mongo/PostgreSQL restore alignment remains unresolved. Local process-loss tests are documented in CHAOS_RECOVERY_REPORT.md and cannot substitute for a hosted deployment campaign.

## Bounded web termination repair

IMPLEMENTED: reliability/http-shutdown.js now owns the server drain deadline. Server shutdown sets readiness to stopping, stops accepting connections, closes idle connections, and attempts pool closure after active HTTP connections drain. At 30 seconds, a stuck request or pool cleanup forces connection closure and process exit with code 1. Successful cleanup clears the deadline; failed cleanup retains it. Previously only process.exitCode was set, allowing remaining handles to keep the process alive indefinitely. env.js remains the first server import.

TESTED: scripts/verify-http-shutdown.mjs PASS with injected server/pool states for complete drain, hung request, hung pool and failed cleanup. Each failure reaches exactly one termination callback; completed cleanup never force-closes. A real owned Node child with a live interval and hung drain exits with code 1 under the test's 20 ms deadline, before a 2-second test watchdog. No HTTP listener, configured database or provider is accessed. Syntax and whitespace checks PASS.

Risk: deadline expiry intentionally terminates unfinished work; durable receipts, leases and uncertainty reconciliation must recover it. These tests prove the termination mechanism, not all domain recovery paths or the hosting platform's rollout behavior. The production 30-second drain window is unchanged, but now enforced across cleanup. Hosted deployment gate remains BLOCKED. Changed server.js, new reliability helper and new regression script.

Local login repair activation — 2026-10-08: verified port 3002 belonged to the API process previously started in this workspace, then sent SIGTERM and confirmed its listener closed. Restarted the same server.js under Node 24.21.0 with its existing private configuration. Current source server entry point does not launch provider workers. Frontend proxy on port 5173 returned configured authentication/session HTTP 200; an array username with synthetic password returned VALIDATION_ERROR HTTP 400 before rate-limit/credential database work. The local API remains running for the user. No real credential sign-in, hosted deploy, provider call or business mutation was performed by this check.

This activates the recent server source repairs locally and supersedes their pending-local-restart notes. It does not constitute hosted rollout/rollback, graceful drain under business load, schema migration or production readiness evidence. The reported login failure's exact message/host remains unresolved.
