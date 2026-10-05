# AJIO process workflow evidence

Audit updated 29 September 2026. The AJIO Process Workflow guide documents seven warehouse stages: inventory/order pendency, PO release, picking, packing, labels/invoice, shipment manifest, and handover. The document describes intended behavior; it does not establish that this checkout is connected to AJIO or Central Inventory.

The current route `/app/fulfillment/ajio` retains configuration and local SKU-mapping surfaces. Connector-dependent workflows are disabled in `api/ajio.js` and return HTTP 503. Configuration GET is side-effect free, saved settings report “Connection Not Tested,” and SKU mappings report “Not Connected.” The UI displays a warning, does not claim a provider document was generated, and labels old entity rows as unverified provider data.

## Current test evidence

- `npm run test:ajio-integrity` passes in isolated memory; it confirms no provider orders, reservations, delivery, invoice, manifest, or fake inventory feed is created.
- `npm run typecheck` and `npm run build` pass on Node 20.19.0.
- No live AJIO seller account, signed-in tenant, configured MongoDB persistence, or Central Inventory event was tested. There is no proven full lifecycle or stock-propagation result.
- Older AJIO API/browser tests asserted a simulated local lifecycle and are retired. They must not be cited as current integration success.

## Intended workflow and dependencies

The guide's intended sequence is AJIO PO/order intake → mapped SKU validation → Central Inventory reservation → picklist and box/LPN scanning → packing and provider invoice/label → complete-shipment manifest → 3PL handover and provider readback. A future implementation must make each transition idempotent, preserve audit links, and verify on-hand/reserved quantities against Central Inventory.

Missing contracts include AJIO authentication and API schemas, seller order/return events, reservation/dispatch lifecycle, label/invoice payloads, manifest/3PL acknowledgement, retries/timeouts, and production permissions. No local fake implementation should stand in for these contracts.
