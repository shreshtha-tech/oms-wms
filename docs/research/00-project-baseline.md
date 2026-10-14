# Project baseline — 2026-10-15

Status: IN PROGRESS. Research only; no application implementation authorized.

Repository: `/Users/shreshthagupta/AI-Workspaces/oms-wms`. The supplied Downloads cwd is absent. Branch: `fix/flipkart-order-intake-20261009`. HEAD: `332743b0d0bdf21fc46bcda4eb327e8c2dda03fe`.

Extensive staged user changes exist. See baseline-snapshot.json for the initial porcelain status and hashes of directly inspected files. HEAD alone cannot reproduce this checkout. No staging, reset, commit, database operation, deployment, or provider call performed.

Stack: React/TypeScript/Vite frontend, ESM Node/Express backend, legacy Mongo operational routes, PostgreSQL Central Inventory. package.json declares Node ^22.12.0 || ^24.0.0 || ^26.0.0; available default node is v20.14.0 (outside declared range). Git is 2.15.0; use symbolic-ref for branch identification. No environment files or credentials were read.

Source observations:
- inventory/ledger.js: master SKU lock, balance lock, event hash replay check, integer/nonnegative/available-stock checks, reservation transition validation, event/balance/outbox in caller transaction. VERIFIED IN SOURCE; database race outcomes NOT RUN.
- inventory/db.js: 29 SQL files under session advisory migration lock, receipt index validity checks, no applied-version/checksum ledger in this runner. VERIFIED IN SOURCE; migration recovery NOT RUN.
- inventory/tenant-boundary.js: configured single allowed tenant, denies mismatched query/body tenant, binds request tenant. VERIFIED IN SOURCE; complete parent auth/warehouse authorization review pending. This is not proof of general multi-tenancy.
- src/eretail/masters/SkuImport.tsx and api/sku-imports.js: browser sequential row writes precede a metadata endpoint returning 501. VERIFIED IN SOURCE; partial commit reproduction NOT RUN.
- .github contains dependabot.yml, configured for devcontainers only. No workflow file found. Remote GitHub settings UNVERIFIED.

Existing docs/industry research is historical input, not refreshed upstream evidence. Application source inspected here takes precedence over earlier reports. Full API, service, schema, test and deployment mapping remains pending.

Runtime tests: NOT RUN. External code execution: NOT RUN. Build: NOT RUN.

## Authorized follow-up

User subsequently authorized fixing confirmed defects. See confirmed-defect-fixes.md and confirmed-defect-validation.json for scoped source changes and current verification. The observations above describe the original baseline, not the corrected source.

## Current static inventory refresh

current-project-inventory.json records 159 literal legacy routes and import resolution, 29 SQL migration files with table declarations/hashes, 238 npm scripts and 330 verify scripts. The registry is static discovery, not evidence every route/test is correct. Worker supervisor, tenant advisory lease, startup schema/index checks, single-flight observation/reconciliation/receipt scheduling and shutdown source were read. See local-receipt-workflow-trace.md for an API-to-projection chain.
