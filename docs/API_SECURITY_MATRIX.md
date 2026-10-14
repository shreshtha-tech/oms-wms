# API security matrix

Date: 2026-10-08 (Asia/Kolkata). Part 1 inventory; **INCOMPLETE / production security BLOCKED**.

This matrix records current route-to-source traces. It does not establish successful authentication, role authorization, BOLA resistance, tenant isolation or bounded execution for every endpoint. No HTTP attack campaign or configured data access occurred for this artifact.

## Endpoint evidence

- [Legacy route matrix](hardening/legacy-api-matrix.csv): every literal entry in the current `server.js` legacy route table, with source handler, observed method branches, collection candidates, permission literals and unresolved security verdicts.
- [Legacy evidence](hardening/legacy-api-evidence.json): line-level direct-handler storage/import references. Shared helpers, delegated routes and dynamic collection names need further tracing.
- [Modern route evidence](hardening/modern-api-evidence.json): current literal Express routes with manually traced mount prefixes. Array/regex registrations, including health aliases and middleware path arrays, remain separate coverage gaps.
- [Full source inventory](hardening/source-surface.json): additional query, parser, execution, HTML and storage inspection locations.

Reproduce with `node scripts/audit-production-surface.mjs` followed by `node scripts/audit-api-security-matrix.mjs`. Neither utility imports the application, loads environment settings or accesses a database. Counts represent source candidates, not runtime endpoint count or security passes.

## Shared server boundaries reviewed

| Surface | Source evidence | Current verdict | Remaining proof |
|---|---|---|---|
| Literal legacy mounts | `server.js` authenticates sessions before mounting the route table with `app.all` | Shared authentication implemented in source | Anonymous/expired/revoked session HTTP tests against each mounted handler |
| Private inventory mounts | `inventory/http.js` rejects foreign or malformed supplied body/query tenants and resolves configured tenant | Tenant-context boundary implemented in source | Foreign object/account/location/mapping IDs and database predicates for every operation |
| Central stock/master-data mutations | `inventory/central-api.js` calls `requirePermission` for selected mutation routes | Selected operation permissions implemented in source | Wrong-role HTTP tests and full authorized role/location/account scope |
| Controlled opening stock | `inventory/files-api.js` separates stage/read/request/approve/post permissions | Permission checks implemented in source | Separation of duties, approval races and foreign-batch HTTP acceptance |
| Workbook commit | Files API checks batch mode then count/catalog permission | Mode-specific permission implemented in source | Ownership, replay, schema/type, resource and account-scope campaign |
| Provider administration | `inventory/connections.js` uses tenant/account lookup and origin checks | Granular role coverage unresolved | Credential/setup/pause/activate/discovery/publish authority operation permissions |
| Alert administration | `inventory/unified-orders.js` mounts alert-admin and applies existing alert-admin guard to team/WhatsApp paths | Existing guard must be reviewed on its own contract | Explicit role matrix and per-order/alert/sender object isolation |
| Shopify/Woo/WhatsApp webhook | Raw-body parsers and signature-specific handlers precede private authentication | Separate signed ingress implemented in source | Every identity, replay/conflict/schema/oversize/flood case and deployed subscription |
| OAuth and Tally agent | Public inventory connection router | Route-specific authentication required | State/token consumption, expiry, foreign account, SSRF and rate control |
| Monitoring | `/api/health/metrics`, `/operations`, `/databases` are after shared authentication | Internal diagnostics authenticated in source | Authorized operations role and response minimization |
| Health live/ready aliases | Literal arrays in `server.js`; public classification-only readiness serializer | Public endpoints intentionally separate | Every output field, schema/dependency failure and hosted readiness gating |

The legacy `api/mongo.js` CORS helper only sets headers and handles OPTIONS. It does not perform authentication, authorization or tenant resolution. These controls must come from the server mount and operation-specific code. `Access-Control-Allow-Origin: *` alone does not establish a credentialed browser bypass; actual browser/session behavior requires testing.

## Storage findings confirmed in source

The initial audit found that `api/mongo.js` findImpl used unbounded toArray and findOneImpl delegated to that full read. The subsequently authorized [Mongo repair](hardening/MONGODB_FIXES_2026-10-08.md) adds complete-or-error row/byte/deadline bounds and an actual driver findOne. Neither helper adds tenant predicates. `api/skus.js` uses empty queries for list/search; `api/purchase-orders.js` looks up numeric IDs and lists by optional status without tenant identity in the inspected predicates. A single-tenant deployment may isolate by database, but that contract has not been established for every store and route. Multi-tenant isolation cannot be inferred from the modern inventory middleware.

`api/admin.js` accepts user/role/API-key record operations under the shared session and performs optimistic version checks for updates/deletes. Those version checks protect concurrency, not operation authorization. Data writes and subsequent audit insertion are separate calls; an audit insertion failure can follow a committed mutation. `api/admin-parity.js` similarly builds and persists export content on the request path from unbounded query results. These paths require role, transaction/audit and resource controls before their broad safety requirements can pass.

## Required role × operation review

These rows are required acceptance subjects, not newly granted privileges. Existing account configuration exposes selected permission strings; names such as Viewer or Finance do not currently establish a complete runtime role model.

| Role | Read scoped data | Physical stock mutation | Provider credentials/publication | Returns receipt | Export | Admin accounts/roles | Worker claims |
|---|---|---|---|---|---|---|---|
| Viewer | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Must deny; NOT VERIFIED |
| Operator | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Must deny; NOT VERIFIED |
| Warehouse | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Must deny; NOT VERIFIED |
| Inventory Manager | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Must deny; NOT VERIFIED |
| Marketplace Manager | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Must deny; NOT VERIFIED |
| Finance | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Must deny; NOT VERIFIED |
| Admin | NOT VERIFIED | Selected permission source only | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | Must deny browser claim; NOT VERIFIED |
| System Worker | No browser role implied | Workflow-scoped; NOT VERIFIED exhaustively | Account-scoped; NOT VERIFIED exhaustively | Workflow-scoped; NOT VERIFIED exhaustively | No browser role implied | No browser role implied | Tenant lease source; NOT VERIFIED exhaustively |

For every concrete operation, record authentication, permission, tenant, location, provider/account, object ownership, audit requirement, method, schema/type/extra-field handling, content type, body size, timeout, rate/cost limit, response filtering and sanitized error behavior. Exercise anonymous, expired, wrong-role, wrong-tenant/account/object, malformed/oversized, exact replay, changed replay and burst requests. Source absence or presence is not a PASS verdict.

## Verification status

Offline matrix generation and syntax validation: **PASS**. Endpoint-by-endpoint runtime authorization/tenant campaign: **NOT RUN**. Role policy acceptance: **BLOCKED** pending explicit operation policy and implementation evidence. No secret values or customer payloads are included in the matrix.

Admin export continuation: api/admin-parity.js export-logs and audit-export now use a bounded CSV serializer with formula-leading cell/header protection and explicit 413 on more than 1,000 rows, 64 columns or 1 MiB. Handler-level explicit-memory regression PASS; see PRODUCTION_SECURITY_HARDENING_REPORT.md. Role and object authorization on /api/admin and /api/admin-parity remains unresolved. An operation-permission decision was requested from the user; no role grant was inferred from menu visibility.

Admin identity continuation: /api/admin POST now strips the UI's id:0 create sentinel and rejects caller-chosen real IDs, preserving the Mongo server-owned identity rule. The Manage API status action supplies its record version; a stale version still conflicts. Explicit-memory handler regression, typecheck and Node 24 build PASS. These results do not grant Admin permissions or prove tenant/object isolation.

API-key projection continuation: /api/admin?type=api-key and /api/admin-parity?action=api-catalog now use a shared allowlisted response view. Synthetic unknown top-level and nested permission secrets do not appear; prior key masking and create/update regressions PASS. This is response filtering for two handlers, not a role, account or tenant authorization verdict.

## Current route mount cross-check — 2026-10-09

On the current dirty worktree, `server.js` still contains 159 literal legacy route-table mounts; all 159 match the previously generated legacy route inventory, and every route-table handler identifier resolves to a local import. `mongoRoutes` contains 152 mount names, but `server.js` uses that set only to attach the dataset-header observer. It is not a source-of-truth storage map. The seven unregistered mounts were inspected directly: six currently return static metadata or explicit unavailable responses without applying business mutations; `/api/testSMSConnection` validates a subdomain and sends the supplied client credentials to that Salesforce Marketing Cloud subdomain's token endpoint. That handler sets redirect rejection and a 15-second deadline and does not persist the credentials, but it reads provider JSON without an explicit response-byte cap.

Current mount order: health live/ready aliases, `/api/auth/session`, login/logout, and `/api/inventory-sync` public handlers precede the shared `/api` origin guard and session middleware. The public inventory routes therefore rely on their own webhook signature, OAuth state/browser binding, or paired-token checks. Shared session auth precedes all legacy route-table mounts and the private inventory router. Private inventory routes then enforce the configured tenant context; this is a single configured tenant boundary, not a general per-user multi-tenant entitlement model. Health metrics/operations/database diagnostics are mounted after shared auth. These are source-order observations, not HTTP security results.

The source inventory was generated on 2026-10-07 and was not rerun because its JSON/CSV outputs are untracked user work. The route table equality check was performed read-only from current `server.js` and the existing generated evidence. The new [API-boundary source hashes](industry/api-boundary-snapshot.json) cover the source files inspected for this continuation.

Bounded follow-up: add an explicit response-byte limit and safe parse failure for the Salesforce token-check response. Evidence is `api/external-app-connections.js` using `response.json()` without a local cap; applicability is the authenticated `/api/testSMSConnection` route. Effort small; risk low/medium because oversized or malformed provider responses may change from a provider message to a generic bounded error; affected files are that handler and its verifier. Acceptance is that a valid token response still reports success, malformed/oversized bodies terminate within the request deadline without returning provider payload fragments, and no credentials are persisted. Validate with injected fetch responses at boundary, malformed JSON, timeout and redirect cases; do not contact a real provider.
