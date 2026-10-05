# SKU Moderation replication evidence

Audit date: 30 September 2026. This file records the local signed-in evidence for `/app/sku-moderation`. Generated `codexqa_*` databases were used and removed by the test harness. The configured MongoDB database was not written.

## Verified workflow

`npm run test:sku-moderation` runs `scripts/verify-sku-moderation.mjs` through the isolated browser harness. The focused run passed using the generated administrator and local PostgreSQL/MongoDB services.

- The authenticated screen exposed the recorded channel/SKU references, linked and unlinked enquiries, page sizes, and filter fields.
- The verifier created two channels and two SKUs through authenticated APIs, then added unmapped seller listings as isolated seller-feed fixtures.
- It searched an unmapped seller listing, found a candidate eRetail SKU, linked it from the screen, and read back `sku_code`, `eretail_sku`, `updated_by`, `updated_date`, and `linked_at` from MongoDB.
- It opened the linked enquiry, found the saved mapping, downloaded `SKU_Moderation.xlsx`, and checked that exported values contained the linked seller and master SKU.
- It downloaded and inspected the XLSX import template and checked its four supported columns.
- A quoted CSV import mapped a seller listing where seller product ID contained a comma. It recorded row outcomes for a successful map, unknown master SKU, missing seller listing, wrong channel and duplicate mapping. The import batch and row results remained in MongoDB after resetting the screen draft.
- Empty and 5,001-row imports, missing candidate, invalid action code, missing master SKU, and stale listing ID were rejected. The signed-in actor was recorded on the saved batch.
- Listing maps changed no Central Inventory event keys. A mapping alone is metadata and does not publish stock.

## Changes supporting the workflow

- `api/sku-moderation.js` validates linked SKUs and action codes, scopes import matches to the selected channel and optional product ID, rejects ambiguous seller listings, persists generated batch outcomes with an authenticated actor, and atomically claims only unmapped listings.
- `api/mongo.js` exposes the atomic unmapped-listing compare-and-set used by this workflow and SKU Channel Listing.
- `src/eretail/sales/SkuModeration.tsx` parses quoted CSV correctly and prevents repeated import/reset actions while a request is in progress.
- `scripts/verify-sku-moderation.mjs` performs the signed-in API, browser, XLSX, CSV, MongoDB readback and stock-event checks.

## Remaining evidence gaps

- The reference browser was unavailable, so LIVE layout, request contracts, role access, error export behavior and operator workflow parity have not been established.
- The configured MongoDB URI failed a read-only ping with `MongoServerSelectionError`; only generated disposable MongoDB databases were verified.
- No real seller account/feed was accessed. Channel mapping does not establish provider authorization, listing status at the provider, inventory publication, or stock readback.
- The saved import batch is durable, but this screen has no batch-history search/reopen view. Production role permissions, concurrent operator behavior, and tenant persistence need separate verification.

This module is therefore classified **Partially functional**, not production-ready or fully verified.
