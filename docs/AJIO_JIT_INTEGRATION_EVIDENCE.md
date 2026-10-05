# AJIO JIT integration evidence

Audit updated 29 September 2026. The supplied Vinculum AJIO JIT product guide and process guide define the intended fields and warehouse stages. They do not provide the AJIO API schema, authentication contract, provider test account, or a signed-in live workflow trace. UI similarity to those guides is not evidence of a working marketplace integration.

## Current implementation state

| Surface | Current local behavior | Integration evidence |
|---|---|---|
| Channel Maintenance | Configuration can be saved locally after field/location validation. The response says “Connection Not Tested.” Newly submitted secret values are not persisted, and responses redact credential fields. | No AJIO account connection or provider authentication test. Legacy credential values, if present in an existing database, may still remain on disk and must be migrated/rotated before go-live. |
| SKU mapping | AJIO article values can be mapped to a local SKU. Mapping status is local; inventory status is always “Not Connected,” and published quantity / last-sync are not represented as current values. | No provider SKU readback or Central Inventory publication. |
| Backorder pull, order creation, reservation, picking, pack, labels, invoice/AWB, manifest, handover and reconciliation | API actions return HTTP 503. Historical local simulator branches have been removed. | No order or stock-changing actions are enabled. |
| Packing slip, shipping label and manifest downloads | UI reports the document action unavailable. | No provider/generated document is claimed. |
| Existing AJIO entity rows | Readable from their configured collections for inspection. The UI warns that rows have not been verified as provider data. | Their provenance is not established by the current handler. |

`GET /api/ajio?entity=config` returns an empty default without inserting a document. Configuration and SKU mapping writes remain local metadata. All connector-dependent `POST /api/ajio` actions return HTTP 503. `api/ajio.js` contains no local reservation, order, picking, packing, invoice, manifest, or shipped-state simulator.

## Reference requirements retained for future integration

The guides describe: AJIO JIT Channel Maintenance; Seller ID and password configuration; B2B invoice series; `SKU Sync = Pull` and `SKU Create = Moderate`; mapping `ChannelSKUCode` and `ProductId~VariantId`; order/backorder intake; Central Inventory reservation; picklist and LPN/box scanning; packing and provider invoice/label responses; full-shipment manifests and handover. These remain **requirements to implement and verify**, not current capabilities.

The guides also say E-Invoicing defaults to No and may require client/AJIO Account Manager approval. No machine-readable approval or application role contract was supplied. No new permission rule was invented. Exact API response structures, retry semantics, webhooks, document layouts, reconciliation behavior, and provider timing remain unknown.

## Verification performed

- `npm run test:ajio-integrity` passes in an isolated in-memory store. It checks side-effect-free config reads, no persistence of a newly supplied password, response redaction, local-only SKU mapping, masked feed values, HTTP 503 for provider actions, and absence of generated order/delivery/invoice/manifest rows. It does not inspect or migrate an existing user database.
- `npm run typecheck` passes.
- `npm run build` passes with Node 20.19.0. ExcelJS remains a 937 KB minified chunk (271 KB gzip) and Vite reports the existing chunk-size advisory.
- The old 21/25-assertion AJIO lifecycle tests and browser scripts asserted local simulated fulfillment success. They are superseded and must not be used as live-integration evidence. The two browser scripts now stop with a retirement message; `scripts/verify-ajio-jit-api.mjs` delegates to the current fail-closed verifier.
- No signed-in browser workflow, configured MongoDB tenant, AJIO account, or Central Inventory transaction/readback was run. No synchronization timing result is available.

## Remaining integration work

Provide an authorized AJIO test account and separate credentials using the approved secret manager; define seller order and return API contracts; configure verified channel/SKU/location mappings; implement idempotent Central Inventory reserve/release/dispatch and return paths; implement provider label/invoice/manifest handling; then run duplicate, concurrent, timeout, retry, failed-job, and provider-readback tests with source/ledger/provider timestamps.
