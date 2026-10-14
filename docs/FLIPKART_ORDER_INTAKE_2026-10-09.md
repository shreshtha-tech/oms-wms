# Flipkart historical order retrieval

User-authorized implementation: “fix it all”, with history preference “All available history”. Branch: fix/flipkart-order-intake-20261009. Existing dirty work preserved. No dependency, migration, deployment or central-ledger change.

## Use

From the relocated OMS/WMS checkout, using Node 22.12+ or 24:

```sh
npm run flipkart:fetch-orders
```

Select a saved account if more than one exists:

```sh
npm run flipkart:fetch-orders -- ACCOUNT_UUID
```

Resume the same saved historical checkpoint after an interrupted or failed run:

```sh
npm run flipkart:fetch-orders -- --resume
```

Use `--from 2020-01-01` to specify an exact starting date. Default is the Unix epoch (1970-01-01), an exhaustive scan lower bound rather than an assertion that Flipkart retains data from that date. API retention and supported historical dates remain provider constraints. The CLI advances backwards through yearly windows; empty windows are still checked. It can take substantial time. Success prints completedAt only after the configured range has been scanned. Failures exit nonzero, preserve historical progress and emit safe codes. A concurrent worker holds the account lease; use the worker UI path instead of competing CLI runs.

Alternatively restart the local API/frontend and worker, then use Seller Connections → Flipkart → Manage Connection → Retrieve all available Flipkart orders. The API returns HTTP 202 for queued work; a running inventory worker is required. Do not interpret 202 as imported/completed. Restart the worker after loading the code; it refreshes recent observations and scans one historical window per scheduled cycle. View persisted records in Unified Orders.

## Implemented scope

- Maximum documented page size (20), all pages via nextPageUrl/hasMore; HTTPS Flipkart-only cursor guards and cycle/budget failure.
- Pre-dispatch including held/unheld; post-dispatch separately SELF/NORMAL; all three cancellation origins. Category failures prevent that date axis's historical checkpoint advancement. Both `orderDate` and `cancellationDate` histories are scanned independently, with separate restart-safe cursors; recent order and cancellation windows are refreshed each cycle.
- Date-range bisection when a search reaches the 5,000-result cap; an unsplittable capped range is an explicit failure.
- Stable order/item IDs, every returned line, split-shipment grouping, changed-revision handling and partial-cancellation protection.
- Provider `CANCELLED` status is normalized case-insensitively so cancellation observations also clear pending internal alerts.
- Existing transaction-backed unified-order upserts plus per-line provider status/shipment/location timeline. Account-scoped advisory lease, fenced progress updates and retry cooldown.
- Historical/observation import sends no packing notifications and does not enqueue stock reservations or publication. Provider status is separate from internal fulfillment status.

Official contract: https://seller.flipkart.com/api-docs/order-api-docs/v3/PostShipmentSearch.html . This endpoint excludes Flipkart Advantage orders. All-history means the seller-fulfilled records returned for the requested range, not undocumented programme coverage or guaranteed indefinite retention. Cancellation casing and additional categories are documented but not yet tested against the configured account; provider rejection is surfaced rather than silently dropping a category.

## Files and verification

New retrieval/normalization: inventory/flipkart-orders.js. Persistence/checkpoint orchestration: inventory/flipkart-order-observation.js. CLI: scripts/flipkart-fetch-orders.mjs. Regression fixtures: scripts/verify-flipkart-orders.mjs. Integration edits: inventory/connections.js, inventory/connection-readiness.js, scripts/inventory-worker.mjs, src/pages/SellerConnections.tsx and package.json. Existing one-page probe remains diagnostic.

PASS: retrieval/normalization regression fixtures, including cancellation-date filter, both independent history checkpoints and uppercase cancellation; injected observation service success/failure/checkpoint fixtures; connection-readiness verifier; TypeScript check; targeted ESLint; Vite build with Node 24.21.0 using `--configLoader runner --outDir /private/tmp/oms-wms-flipkart-build`. Existing bundle-size warnings remain. Plain Vite config bundling cannot write `node_modules/.vite-temp` in this checkout. Initial Node 20.14 build warned below Vite support; the supported-runtime build is the relevant result.

NOT RUN: configured full-history retrieval, actual PostgreSQL ingestion/restart/concurrency, hosted UI/browser, live cancelled/post-dispatch categories and seller-count reconciliation. User-supplied prior token/search HTTP 200 proves only the original bounded pre-dispatch probe. Fixture success is not provider or store-durability proof.

## All-history and freshness cross-check

The default 1970 start is a scan lower-bound only. The official shipment-search contract caps retrieval at 5,000 records, excludes Flipkart Advantage, and documents both `orderDate` and `cancellationDate`; it does not promise that records are retained to the epoch. Current source scans both date axes in 365-day windows and bisects capped windows. The regression fixture verifies independent completion for both axes over a short window; it does not exercise a complete multi-decade progression. At the 15-minute worker cadence, the approximate 56 historical windows per axis from 1970 to 2026 would require at least about 28 hours if every window completes in one cycle; this is arithmetic from the configured window and schedule, not a measured runtime or service target. The CLI loops windows immediately but repeats recent scans in each poll invocation.

The recurring refresh queries seven recent days using both `orderDate` and `cancellationDate`. The cancellation-date axis also backfills all available seller-fulfilled cancellation history, addressing late cancellations whose original order date is old. The fixture verifies the exact cancellation filter and independent checkpoint completion; configured-account behavior and provider retention remain unverified. Other non-cancellation status changes on old orders can still remain stale because the documented search endpoint has no generic updated-time filter; maintain completeness claims within the date/category coverage and reconcile with Seller Hub.

Remaining acceptance: run the new command against the intended privately configured account, inspect safe result/codes, reconcile date/category/location counts against Seller Hub, repeat --resume and verify no duplicate lines. Any category/date contract rejection must be fixed using its sanitized provider error code rather than guessing fields or claiming complete coverage.
