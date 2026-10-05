# Mongo reliability phase report — 2026-10-05

User authorization: “continue all” authorized the remaining repository phases. No configured database command, restore, seed, migration, collection/index creation, app restart, environment change or Render value change was performed. All database stand-ins below are injected offline test fixtures. Earlier live Atlas evidence is historical evidence and was not refreshed here.

## Changes and diff summary

- `api/mongo-config.js`: safe configuration resolution, production/required-persistence guard, masked hostname and insecure-TLS option rejection.
- `api/mongo.js`: startup selection/warnings, safe configuration and dataset accessors.
- `api/mongo-connection.js`: sanitized authentication/unreachable classification, actionable TLS-alert-80 guidance, bounded cached/single-flight dataset inspection; existing retry, shared pool and fail-closed behavior retained. A synchronous constructor-failure promise-assignment race was repaired and regression-tested.
- `api/mongo-collections.js`: derived collection map for 133 modules, 61 expected collections, registry-only names, dynamic/disabled/dependency-handler flags and Mongo API route set. Static coverage does not establish module capability.
- `api/mongo-dataset.js`: bounded metadata and estimated-count inspection; counters excluded from application dataset evidence.
- `api/mongo-health.js`: shared readiness decision, credential-free payload and explicit empty-dataset header.
- `server.js`: structured Mongo readiness/database-health payload and empty-dataset header for mapped legacy routes.
- `src/components/MongoStatusBanner.tsx`, `src/eretail/Shell.tsx`: authenticated bounded polling, cancellation and visible real dataset status.
- `scripts/mongo-tooling.mjs`: explicit-target guards, outside-repository output validation and restricted-identity inventory handling.
- `scripts/mongo-inventory.mjs`: database/collection listing and estimated counts only.
- `scripts/mongo-backup.mjs`: opt-in selected-database canonical EJSON export, private external files, completion/integrity manifest, count-only output.
- `scripts/mongo-restore.mjs`: proposal, default offline dry-run, integrity/count checks, explicit new test target and extra non-test acknowledgement, no deletion/overwrite/index restore.
- `scripts/mongo-ensure-indexes.mjs`: additive operator proposal matching six existing code-derived identities; explicit selected database and acknowledgement required.
- `scripts/verify-mongo-safety.mjs`: offline guards, failure/recovery/auth, empty/populated, payload/header, restricted inventory and export/restore format/refusal integration checks.
- `package.json`: named tooling and test commands.
- `db/DATABASE_SETUP.md`: precedence, dataset states, complete operator proposals, export limitations, role and network/backup owner instructions.
- `.env.example`, `render.yaml`: matching database-selection comments added in Phase 1; existing values preserved.
- `docs/reliability/ATLAS_BOUNDARY_2026-10-05.md`: appended spelling/evidence correction without rewriting the earlier snapshot.
- This report: execution dispositions and remaining gates.

Core behavioral diff:

```diff
- readiness proves connection readiness only
+ readiness includes Mongo dataset state and requires populated evidence when Mongo is required
- successful empty legacy reads have no dataset signal
+ mapped reads carry X-Mongo-Dataset-Empty: true when inspection proves empty
- connection diagnostics use driver-provided classifications
+ connection diagnostics use sanitized UNREACHABLE / AUTHENTICATION_FAILED categories
```

`POPULATED` means at least one expected collection has records, not complete tenant/module correctness. Unknown metadata access remains unknown; it is never converted into empty evidence. Empty-dataset readiness is HTTP 503 while liveness remains independent. Existing mutation handlers may establish indexes/counters; reviewed startup only connects/pings and does not auto-create business structures.

## Checks run

Passed: `npm run test:mongo-safety`; `node scripts/verify-mongo-reliability.mjs`; `npm run typecheck`; `npm run build`; targeted `git diff --check`; Phase 1 syntax/configuration assertions. Export/restore integration wrote and removed private temporary fixture files outside the repository with an injected fake client. It checked BSON ObjectId/Long/Date preservation, manifest integrity, dry-run zero client creation, missing backup acknowledgement/wrong database refusal, non-test and populated restore target refusal. No real database was used.

Build generated ignored `dist` artifacts and TypeScript build metadata. No source/credential export was generated. Not run: configured Atlas inventory/backup/restore/index tools, hosted probes, actual API/browser acceptance, populated workflows, actual role checks or the full historical application test suite.

## Proposals and remaining owner work

Use the exact proposed commands in `db/DATABASE_SETUP.md` only after naming and approving the target. Inventory and backup must match the deliberately selected database. Restore into a NEW `_test` database first; it does not redirect the application. Backups are canonical EJSON documents plus metadata, not native mongodump archives or consistent snapshots under concurrent writes. Views/collection options/index restoration require a separate reviewed plan.

The authoritative business-data location, local/Render database ownership and tenant correctness remain unverified. Local and template names differ; no name change was applied. `sale_orders` is the real collection spelling, `products` is an intentional read alias to `skus`, and `locations` remains an ambiguous collection-versus-generic-module reference requiring an owner decision. Historical snapshots are preserved and explicitly corrected rather than represented as newly measured.

Owner actions: choose MONGODB_DB deliberately; identify the real dataset/export/cluster; authorize a named read-only inventory; establish eligible Atlas backups or reviewed scheduled exports; add actual Render Connect → Outbound ranges to Atlas Network Access; review expiry of the machine-IP entry and database-scoped runtime/read-only roles. Actual access-list entries, backups, Render outbound IPs and deployed behavior were not inspected or changed. TLS alert 80 guidance is diagnostic advice, not proof that every occurrence has the same cause.

No data was restored or populated. Production readiness is not established.

## Deployment review of the follow-up advice

Current source review confirms `render.yaml` uses `healthCheckPath: /health/ready` (not `/api/health/ready`; both routes share the same handler). `server.js` requires Mongo when persistence is required **or** `MONGODB_URI` is configured. Consequently, disabling `DMILLS_REQUIRE_PERSISTENCE` alone does not bypass empty-dataset readiness. `NODE_ENV=production` also independently requires persistence. Offline assertions passed for both persistence-flag cases with configured Mongo and an empty dataset; no database was contacted.

Render requires HTTP health checks to return 2xx/3xx within five seconds. A release that cannot pass health checks within 15 minutes is cancelled while existing instances retain traffic. The current empty-dataset 503 therefore prevents such a deployment. Dataset inspection can also exceed the five-second platform deadline on a cold/slow connection. These deployment implications were missing from the earlier report. [Render health-check documentation](https://render.com/docs/health-checks).

Owner-applied proposal, **not applied**:

```diff
-    healthCheckPath: /health/ready
+    healthCheckPath: /health/live
```

This proposal allows deployment of a responsive process even while business dependencies or data are unavailable. It requires separate readiness monitoring; liveness success must not be described as operational readiness. Retaining `/health/ready` is appropriate if blocking traffic and deployment until dependencies and populated data are available is intentional. No Render value or flag was changed during this review.

The supplied inventory command also needs its explicit target argument: `npm run mongo:inventory -- --db eretail` only if the owner confirms and approves that selected database. Bare `npm run mongo:inventory` is refused by the guard. This review did not execute it.

Git review found branch `main`, zero staged files, 344 changed tracked files and 284 untracked status entries (some are directories). The actual `.env` is not tracked. The statement that only the files listed in this report changed is therefore false for the entire worktree: it contains broader pre-existing work. A scoped commit needs its changes and dependencies isolated and reviewed; nothing was staged, committed or switched during this review.

This follow-up changed only this report. Checks were source reads, Git status/diff metadata and offline readiness assertions. Live Render configuration, live-site data, current Atlas roles, backups and allowlist entries remain unverified. A machine-IP change makes an existing allowlist entry stop matching; it does not itself expire or remove the stored entry.
