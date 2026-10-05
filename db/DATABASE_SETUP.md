# MongoDB configuration and access boundary

Legacy application collections use MongoDB. PostgreSQL separately owns authentication and Central Inventory; configuring MongoDB does not establish those dependencies or authorize stock changes.

Configure `MONGODB_URI` and `MONGODB_DB` privately in the local environment or deployment secret manager. Do not paste credentials into chat, reports, shell command arguments or source files. Generate a unique password privately; this guide supplies no reusable password. Keep `.env` untracked, owned by the application operator and mode 0600. Do not overwrite an existing private configuration by copying an example over it.

Database selection is explicit: `env.js` loads the repository-root `.env` without overriding existing process environment values, so inherited environment values take precedence. The shared Mongo manager selects `MONGODB_DB`, defaulting to `d_mills_global` only in optional development mode; it passes that name to `client.db(...)`, overriding any database path in `MONGODB_URI`. Startup warns when the default is used or a URI database path differs, and logs only the selected database name and a masked host; readiness includes the same safe configuration details. With `NODE_ENV=production` or `DMILLS_REQUIRE_PERSISTENCE=true`, an unset or blank `MONGODB_DB` stops startup. Choose local and Render database names deliberately: the example/template default is not evidence that either environment contains your business data. Do not change the URI or database name without confirming ownership and the intended dataset.

Create a dedicated application database identity with only the permissions required for the selected application database. Use a separate operator identity for administrative work and collection initialization. Avoid global database read/write or administrative access for the runtime identity. Provider and authentication credentials have separate ownership and access requirements.

Restrict network access to approved application egress and operator addresses. Do not open all source addresses to resolve a connectivity failure. Keep TLS and certificate validation enabled. URI configuration alone does not prove DNS, TCP, TLS, authentication or authorized database operations.

Start the local server with `npm run dev:server`. Inspect `/health/live` and `/health/ready` separately: a live process does not prove database readiness. Configured MongoDB failure rejects legacy data operations; it does not silently switch them to memory. If persistence is required, missing MongoDB configuration is an error. Optional unconfigured development memory mode is nonpersistent and does not establish production readiness.

Connection recovery does not insert sample business data. The explicit `npm run seed` command currently creates missing empty collections and preserves existing data; despite its historical name, it does not populate starter records or implement a reset option. Review the target database privately and use controlled deployment authorization before initializing a production database. This document does not authorize that operation.

Database access and application access are separate. The application uses authenticated sessions backed by PostgreSQL; owning a MongoDB URI does not authenticate an application user. A database URI grants the privileges of its database identity, rather than automatically granting full administrative control.

Use approved database tooling with private credential entry. Avoid putting password-bearing connection strings in shell history or process arguments. Administrative reads/exports can contain PII; apply tenant, role, retention and export controls. Do not edit inventory balances or business state directly to bypass application transactions or Central Inventory authority.

For failures, distinguish configuration, name resolution, reachability, TLS, authentication, permissions and schema separately. Do not broaden roles, network ranges or disable security controls to make a probe pass. Current configured evidence and unresolved Atlas TLS diagnostics are retained in `docs/reliability/ATLAS_BOUNDARY_2026-10-04.md`; that historical observation requires refresh before treating it as current.

The earlier guide contained a reusable password-like example and unsafe broad-access advice. Removing those instructions does not erase historical copies or establish that the example was never used. Credential authenticity, reuse and rotation relevance remain unresolved; no real credentials were rotated or revoked and history was not rewritten.

## Outage, authentication and dataset status

Public readiness reports only ready, status and dependency state words. Selected database, masked host and dataset counts are available only through authenticated `/api/health/databases`. `UNREACHABLE` and `AUTHENTICATION_FAILED` retain fail-closed 503 responses. `EMPTY_UNINITIALISED` means none of the expected business collections contain records; `_counters` does not count as business data. Collection presence and populated-collection counts are also reported. A reachable empty database is not ready to serve populated workflows, so readiness returns 503; legacy reads can still return successful empty results with `X-Mongo-Dataset-Empty: true`. The shell banner uses the authenticated database-health endpoint. Inspection permission failure is `ACCESS_DENIED`; missing inspection evidence never proves an empty dataset. Successful dataset inspections are cached for 15 seconds and concurrent inspections share one in-flight promise. Mapped-route headers use a separate single-flight background observer with a 750 ms wait limit and a 15-second refresh interval; they never delay the handler. The last observed empty state remains best-effort in the header; a cold request may omit it. Handler database operations still fail closed. `POPULATED` means some expected collections contain records, not that every module, tenant or workflow is correct.

`api/mongo-collections.js` is the shared source of truth for collection names, module/entity mappings, dynamic selections, dependency-error handling and branches containing explicit disabled responses. These are static source facts, not live capability claims. `products` is an intentional read alias for `skus`; `sale_orders` is the actual order collection spelling. Registry-only collections are separate from expected runtime collections. `locations` is an ambiguous legacy reference: some code reads a collection by that name while the Location module stores records in `generic_records`. Do not rename or move those records without confirming the intended contract.

## Operator tooling — proposals, not executed against a database

All database runs require an operator-approved named target. The following commands are proposals only; replace placeholders privately with the confirmed names and approved folders. Inventory and backup require `--db` to exactly match the configured selected database. Do not paste a URI into command arguments.

```sh
npm run mongo:inventory -- --db <confirmed-database>
npm run mongo:backup -- --db <confirmed-database> --yes --out /absolute/path/outside/repository/new-backup-folder
npm run mongo:restore -- --target <new-database_test> --from /absolute/path/to/reviewed-backup
```

Inventory uses only database/collection listing and estimated document counts. It reports the selected database even if listing is denied; accessible databases are not proof of the complete cluster inventory. Counts may be unknown when permission or deadline checks fail.

Backup performs read-only canonical Extended JSON exports, retaining BSON value types and a collection/index metadata manifest. The output folder must be new and outside the repository, with an existing parent directory; files are private. It refuses views. It is a document export, not a native `mongodump` archive or a transactionally consistent snapshot: concurrent business changes can produce an inconsistent cross-collection backup. Schedule it during an approved quiescent period, or use an approved Atlas snapshot/native tool strategy. It marks the manifest complete only after export succeeds; failed exports must not be restored.

Restore is an additive proposal and defaults to an offline count-validation dry run. It does not connect or write unless explicitly passed `--yes`. A target must be explicitly named and end in `_test`; `--i-understand-production` is separately required for other names. Even with that flag, execution refuses any target already containing collections. No drop, deletion, overwrite, collection options or index restoration is performed. Partial execution failure leaves data for review and cannot safely be blindly rerun. Review metadata and restore into a NEW test database first, then authorize index setup and validate tenant ownership and business workflows. The application stays pointed at its original configured database until the owner deliberately changes it.

## Additive index proposal

`scripts/mongo-ensure-indexes.mjs` contains six definitions derived from existing write boundaries: case-insensitive unique `skus.sku_code`; unique `vendors.vendor_code`; partial unique `purchase_orders.po_no`; partial unique `grn.central_request_id`; partial case-insensitive unique `generic_records(module, code)` for SKU groups; and partial case-insensitive unique `generic_records(module, company_location, sku_code)` for SKU/company links. Existing `_id` indexes are Mongo-managed. No guessed tenant index is added: Mongo tenant contracts require separate confirmation. Conflicting index definitions or duplicate records cause failure, never deletion or index replacement. Identical definitions are idempotent; a failure can leave earlier additive indexes in place.

```sh
npm run mongo:ensure-indexes -- --db <confirmed-database> --yes
```

This is an operator proposal only. Reviewed startup code connects and pings; it does not create business collections or indexes. Existing authorized mutation handlers can create identity indexes and `_counters` entries when invoked. The explicit historical seed command creates collections and must not be run as a connectivity repair.

## Atlas and Render owner actions

The local Atlas access-list entry is reported by the owner to be this machine's IP; its actual value, expiry and deployed policy were not inspected. It may change with the network. Prefer a temporary operator entry and approved runtime egress ranges. In Render, open the actual backend service, choose **Connect → Outbound**, and copy every listed CIDR range into the Atlas project's **Network Access** allowlist. These are outbound ranges, not the public website's DNS addresses. No exact Render ranges can be inferred from `render.yaml`. [Render outbound IP documentation](https://render.com/docs/outbound-ip-addresses).

Avoid `0.0.0.0/0`; any deliberately approved broad entry requires both a strong unique password and a least-privilege database identity, and remains broader exposure than specific egress entries. Keep TLS verification enabled. TLS alert 80 is not proof of a single cause: the manager now points to Atlas allowlist and cluster-state checks while retaining sanitized classification.

The runtime normally needs database-scoped `readWrite` on the deliberately selected database for existing business writes, counters and identity indexes; it does not need Atlas admin or global administrative roles. A separate inventory/export identity should have database-scoped read privileges, including the required metadata reads; cross-database listing may remain restricted. Confirm actual roles privately with the owner rather than granting broad rights to make inventory pass.

Atlas backups are unavailable on Free clusters; use reviewed scheduled exports or native database tools, or select a supported backup tier. For eligible dedicated clusters, review the Atlas Backup configuration and retention policy; Flex has its own automatic snapshot policy. Backups being OFF is owner-reported, not verified management evidence. Schedule private exports outside the repository with retention, protected storage and a periodic test restore. No scheduler or backup setting was changed. [Atlas backup documentation](https://www.mongodb.com/docs/atlas/backup-restore-cluster/).


Render deploy gating uses `/api/health/live`: HTTP 200 means the process is running, with `alive` normally and `stopping` while draining shutdown. It queries neither MongoDB nor PostgreSQL. Use `/api/health/ready` (or `/health/ready`) for monitoring and manual checks: HTTP 200 means the configured readiness requirements pass; HTTP 503 means shutdown, missing authentication configuration, unavailable PostgreSQL/schema, or required MongoDB outage, authentication failure, empty dataset or unavailable inspection. Liveness passing does not establish usable data or workflow readiness.

The web Blueprint sets `TRUST_PROXY="true"`. Enable this only behind exactly one trusted proxy; local `.env.example` defaults to false. It makes Express use forwarded HTTPS for the session cookie Secure flag and the forwarded client IP for login limits. In the Render dashboard confirm `TRUST_PROXY=true`, privately confirm `MONGODB_DB` selects the intended database and `MONGODB_URI` is correct, and allow the service's Render outbound IPs in Atlas Network Access. Never weaken TLS to resolve connectivity.
