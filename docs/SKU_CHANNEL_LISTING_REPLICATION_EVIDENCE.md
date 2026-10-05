# SKU Channel Listing replication evidence

## Live discovery and contracts

- Route: `displaySkuChannelLinkBS`.
- Tabs: SKU/Link Search Channel, SKU/Channel Link Import, Unmapped SKU.
- Search actions: Add new, Search, Advance Search, Reset, Export.
- Search endpoint observed in `skuChannelLinkSearchOnClick`: `skuChannelLinkGridSearchJSONData` with SKU, description, channel SKU, channel, product ID, client, channel type, and `doFetchCount=false`.
- Save endpoint observed in `saveSkuCompanyLocData`: `jsonSaveUpdateSkuCompanyLoc`.
- Exact validations: `Channel is Mandatory.`, `ERetail Sku is Mandatory.`, `channelSkuCode is Mandatory.`, `Status is Mandatory.`
- Exact success: `Record Saved Successfully`.
- Editor fields: Channel, eRetail SKU, SKU Description, Channel SKU, Channel Product Id, Back Order Qty, Channel Price, Status, Picking Instructions, Maximum SKU Qty.
- Status values: Active and InActive; reset restores Active and client 0.
- Main visible grid: Client, Channel Image, Channel, Eretail SKU, SKU Description, Channel SKU, Channel Product Id, Channel Price, Picking Instructions, Status, Back Order Inventory, Upd Date, Upd Button.

## Local implementation and verification

- Dedicated implementation: `src/eretail/SkuChannelListing.tsx`.
- Persistent APIs: `api/sku-channel-links.js` and the existing `api/sku-moderation.js` for Unmapped SKU.
- `npm run test:sku-channel-listing` now runs the full isolated signed-in app harness. The harness creates generated PostgreSQL and MongoDB `codexqa_` databases and removes them after the run.
- Playwright verified Channel/SKU/Client catalogs, required-field behavior, create/edit, actor/date ownership, rejected invalid references/status/numbers, duplicate/stale guards, filtered search, export chooser, quoted CSV values, truthful partial-failure summary and row statuses, MongoDB readback, unmapped linking, and a concurrent mapping race with one success and one HTTP 409.
- The workflow added no Central Inventory events. It proves mapping metadata persistence only; it does not prove seller feed authorization, external account mapping, inventory publication, or order ingestion.
- `npm run test:sku-channel-listing`: passed against generated loopback databases.
- Full `scripts/verify-isolated-browser-workflow.mjs`: passed with this workflow integrated among existing signed-in module checks; both generated databases were removed.
- `npm run typecheck`, `npm run build`, JavaScript syntax checks, and `git diff --check`: passed. Build emits the existing Node 20.14.0 versus Vite 20.19+ requirement and large ExcelJS chunk warnings.
- Exact post-change LIVE role/action parity, production MongoDB availability, provider feed readback, durable import batch history, and create/edit duplicate races remain unverified. An earlier local/reference comparison predates these changes and should not be treated as current parity evidence.
