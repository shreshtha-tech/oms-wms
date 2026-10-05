# Phase 1 results - 3 October 2026

Scope: WhatsApp reliability and runtime tenant scoping. 26 catalog entries (20 accounts, 6 programmes); no later-phase work.

## Final executed checks

- node scripts/verify-whatsapp-current-behaviour.mjs - PASS against the archived pre-change source. Preparation/config errors originally retry pending until attempt 8; after fetch entry the catch takes the uncertain branch. Already accepted rows are protected by the old status guard.
- node scripts/verify-whatsapp-preparation-boundary.mjs - PASS, imported sender with fake Meta/database and localhost-only signed callback requests.
- node scripts/verify-whatsapp-transport.mjs - PASS, fake DNS/Node HTTPS dispatch signals; no provider network calls.
- node scripts/verify-whatsapp-callback-tenant-boundary.mjs - PASS.
- node scripts/verify-whatsapp-order-alerts.mjs - PASS.
- node scripts/run-isolated-whatsapp-phase1.mjs - PASS, generated and removed a disposable PostgreSQL database.
- npm run test:unified-orders-isolated - PASS, including final rerun after limiter/masking changes; generated database removed.
- node scripts/run-isolated-central-inventory.mjs - PASS, executes the test:central-inventory verifier in a generated database; database removed.
- node scripts/run-isolated-whatsapp-phase1.mjs scripts/verify-central-inventory-api.mjs - PASS, executes the test:central-inventory-api verifier in a generated database; database removed.
- npm run typecheck - PASS.
- npm run build - PASS. Warnings: host Node 20.14.0 is below Vite's supported minimum; bundle over 500 kB.

Initial sandbox attempts denied PostgreSQL/local-listener access. Approved escalated retries passed. Two fake-harness defects (matching WHERE status instead of SET, and shared fixture references unlike PostgreSQL row snapshots) were corrected; final assertions were not weakened.

## Files

Existing production files: inventory/whatsapp.js (prepare-before-send, explicit transport dispatch, Meta diagnostics/retry/jitter, PostgreSQL tenant limiter, safe text, callback scoping/order); inventory/recipient-otp.js (shared limiter, tenant-scoped upsert, safe operational errors; cooldown/cap/expiry/lockout unchanged).
Existing verifiers: preparation boundary now runs imported implementation; callback tenant boundary asserts scoped updates and absent signatures; unified-orders fake transport signals dispatch and accepts required jitter bounds.
New verifiers: baseline behavior, reliability, transport, PostgreSQL reliability; new isolated runner for PostgreSQL reliability/API checks.
No migrations or UI/legacy changes. render.yaml and .env.example unchanged: worker send paths do not use INVENTORY_PUBLIC_ORIGIN; only web setup constructs the callback URL.

## Evidence limits

No real Meta send/token/template/recipient/provider-delivery validation, configured-tenant acceptance or browser UI tests performed.
Current Meta error-code documentation could not be fetched (HTTP 429); classification is fixture-tested, not live-provider revalidated.
Historical migrations 015/016 retain deliberate global one-time cutovers; the runtime audit does not claim they are tenant-scoped.
As before, a stranded sending row after a process crash is conservatively uncertain: a dead process cannot prove whether dispatch occurred. Caught failures distinguish pre-dispatch failed from post-dispatch unknown; successful Meta acceptance remains accepted even if local audit persistence fails.
The full destination exists only in private Meta payloads; diagnostic/error paths mask it. UI phone masking remains Phase 3.

Stopped for review; Phase 2 requires next. Its existing ci_program_order join and Amazon FBA packing guard are deferred.
