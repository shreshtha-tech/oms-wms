# Render health hardening — 2026-10-05

Scope: small repo-only edits on top of existing uncommitted work. No real .env or Render settings changed, no database connections or mutations, no deployment attempted. Tests inject offline clients/pools; export/restore safety tests use temporary files and injected clients, never a live restore.

## Behavior and evidence

| Task | Before this change | After |
| --- | --- | --- |
| Deploy gate | Blueprint used `/health/ready`, blocking on an empty dataset | `/api/health/live`; unchanged handler returns HTTP 200 and `alive` or `stopping`, with no Mongo/PostgreSQL calls |
| Public readiness | Included configuration, selected database, masked host and dataset counts | Only `ready`, `status`, and dependency classifications; required empty/outage/auth failure still HTTP 503. Details remain behind authentication at `/api/health/databases` |
| Proxy trust | Server trusts one proxy only if `TRUST_PROXY=true`; current Blueprint already specified this | Existing Blueprint setting retained and asserted by tests; `.env.example` adds local default false and the exactly-one-trusted-proxy requirement |
| Dataset header | Every mapped Mongo handler awaited dataset inspection | Handler immediately runs with the last observed header; background observation shares one in-flight inspection, stops waiting after 750 ms, and uses a 15-second refresh cooldown |

`issueSession(res, username, req.secure)` appends `Secure` only when Express considers the request secure. Without proxy trust, TLS terminated at Render leaves the backend HTTP request insecure, so the cookie lacks Secure. `loginLimit` hashes both `req.ip` and `req.ip:username`; without trust these use the proxy address, sharing limits between users. Offline tests exercise the actual session implementation with a fake pool and Express forwarded-protocol/IP getters. No cookies or credentials are printed.

The unchanged UI banner fetches authenticated `/api/health/databases`; it does not depend on public readiness fields. Public readiness also classifies missing administrator configuration and PostgreSQL/schema failure. Webhook raw-body mount order, authentication order, liveness and graceful shutdown are unchanged.

Original inspection timing: successful results are cached 15 seconds; concurrent callers share `datasetPending`. Connection options allow 8-second server selection/connect, a 15-second socket timeout and 5-second pool wait. Inspection checks a 10-second deadline before each count, while collection listing and each count allow `maxTimeMS=5000`. Thus the inspection phase can nominally run about 15 seconds because the final operation can cross its deadline; connection/ping and driver waits add time. There was no single overall wall-clock bound, and a hung fake inspection never settled. The new header path adds no awaited inspection delay. Its 750 ms observation timeout does not cancel driver work; an underlying in-flight check remains shared until it settles, avoiding accumulating retries on a hung check. Last-known headers can be stale and a cold request may omit the empty header. The authenticated banner and strict readiness still expose empty-dataset evidence. Business handlers retain their own database checks and fail closed.

## Every file touched for this task

- `render.yaml`: switch web deploy health gate to liveness; retain existing proxy setting.
- `server.js`: minimal public readiness and non-blocking mapped-route header observer.
- `api/mongo-health.js`: shared public readiness classification and single-flight background header observer.
- `.env.example`: document proxy trust and local false default.
- `db/DATABASE_SETUP.md`: explain liveness/readiness, authenticated details, proxy trust and inspection costs.
- `scripts/verify-render-health-offline.mjs`: offline tests of actual health/mapped route callbacks, public privacy, empty header, hung inspection, Express proxy/cookie/IP behavior and mount ordering.
- `scripts/verify-mongo-safety.mjs`: include the new offline health test in the existing safety gate.
- `docs/reliability/RENDER_HEALTH_HARDENING_2026-10-05.diff`: complete task-only before/after diff, excluding pre-existing work.
- `docs/reliability/RENDER_HEALTH_HARDENING_2026-10-05.md`: this report.

Build regenerated ignored `dist/` output; it is not a source change.

## Checks

- PASS `npm run typecheck`.
- PASS `npm run build` under default Node 20.14.0, with unsupported-Node warning; repeated successfully under installed Node 24.21.0. The supported build reports a large-chunk warning.
- PASS `npm run test:mongo-safety`, including new health tests; repeated after final helper change.
- PASS `node scripts/verify-mongo-reliability.mjs`.
- PASS `node scripts/verify-render-health-offline.mjs` separately.
- PASS syntax checks of server, helper and new test; task-file whitespace checks.
- NOT RUN existing `verify-reliability-http.mjs`, `verify-mongo-startup-recovery.mjs`, `verify-mongo-reliability-api.mjs`, live browser/tenant/provider checks or disposable database wrappers. Integration suites require database access and may create databases, migrate or write fixtures, which the objective forbids.

## Owner actions and unverified boundaries

1. In Render's web-service dashboard, set/confirm `TRUST_PROXY` = `true`, only behind exactly one trusted proxy. Confirm deploy health path `/api/health/live` after applying the Blueprint.
2. Privately confirm `MONGODB_DB` is the intended database (Blueprint currently selects `d_mills_global`; do not assume this contains your data), and `MONGODB_URI` is the correct private Atlas connection string. No credential value is supplied or inferred here.
3. Check the Render service's outbound IPs are allowed in Atlas Network Access; preserve TLS verification.
4. Monitor/manual-check `/api/health/ready`; HTTP 503 can remain correct after a liveness-gated deploy, including for an empty dataset. Sign in to view detailed database health.

Render dashboard state, actual proxy topology, Atlas access, selected data, deployment and production readiness remain unverified. No data was restored. The existing `preDeployCommand: npm run inventory:migrate` was retained; it was not executed in this task. This change does not certify that other deployment steps succeed.
