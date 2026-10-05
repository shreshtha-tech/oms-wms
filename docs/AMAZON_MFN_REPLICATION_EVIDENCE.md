# Amazon MFN workflow and connector status

Audit date: 29 September 2026. The supplied Amazon MFN guide is a reference for the intended screens and field contracts. It is not evidence of a live Amazon connection.

## Current implementation

The protected route `/app/fulfillment/amazon-mfn` exposes configuration, SKU mappings, orders, packing, shipments/returns, and inventory-log tabs. `GET /api/amazon-mfn` reads MongoDB records; a missing configuration is returned as a blank `Not Configured` view without inserting a database record. Configuration Save stores non-secret settings only and always reports `Configuration Recorded - Connector Not Configured`. Secret inputs are disabled and API responses redact any legacy secret fields. If old plaintext credentials are found, the API exposes a presence flag and the owner must rotate and remove them through approved secret management; this code does not silently delete or migrate them. SKU mapping Save updates the local mapping only.

The current config form and credential labels are a legacy MWS-shaped screen scaffold and cannot be used to connect Amazon. A production connector must be implemented against the current Selling Partner API (SP-API), with Login with Amazon OAuth 2.0 authorization and the SP-API endpoint for each marketplace region. The form's region endpoint values have been updated to SP-API hosts, but its disabled MWS credential fields are not accepted or used.

The server returns HTTP 503 for every provider-dependent action: OTP verification, inventory feed submission/processing/reconciliation, order pull/confirmation, label/pack processing, shipment/cancellation, and return pull. No action changes Amazon data or reports a provider acknowledgment. Unavailable operations no longer have local simulation code that can mark a feed, invoice, shipment, or return successful.

The UI displays that the connector is not live. Inventory controls do not infer a published quantity; feed processing is disabled. Credential values are not accepted or stored by this module. A local configuration record or a legacy credential-presence flag is not proof of authorization, connectivity, or synchronization.

## Central Inventory boundary

There is no Amazon inventory publishing path from Central Inventory in this checkout. The former local feed prototype did not provide verified provider publication, but wrote local statuses such as `Success`; those simulation branches were removed. Do not treat the `amazon_mfn_inventory_logs` collection or the separate WMS MP Inventory Log screen as a Central Inventory sync log. An integration must read mapped SKU/location quantities from Central Inventory, submit through a provider connector, persist the request and response, and reconcile with provider readback before exposing success.

Amazon MFN order reservation, shipping, and return receipt are also unavailable. The checkout does not verify Amazon order intake, atomic Central Inventory reservations, invoice/label creation, carrier handoff, or return receipt. None of these should be enabled for live fulfillment based on this screen.

## Verification

- `npm run test:amazon-mfn-integrity` passes in isolated in-memory storage. It checks that legacy secret values are redacted and flagged, newly submitted secrets are not persisted, connector status remains unconfigured, provider actions return HTTP 503, and no order/feed/return/shipment records are fabricated.
- `npm run typecheck` and `npm run build` are code checks only; they do not establish browser behavior, Mongo persistence, credentials, provider connectivity, or stock propagation.
- A previous local simulator verifier expected successful fake OTP, feed, order, label and shipment flows. Those expectations are obsolete and its former success output is not live integration evidence. The current verifier replaces those assertions with fail-closed checks.
- No authenticated browser session, Amazon account, provider API request, Central Inventory tenant transaction, webhook, or readback was verified in this audit.

## Remaining implementation requirements

Before this module can go live, register the appropriate private or public SP-API application in Amazon's Solution Provider Portal and authorize the seller (self-authorization for a private app or OAuth 2.0 for public apps); store LWA client credentials and seller refresh tokens in an approved secret manager; verify marketplace-region endpoints and required roles; build verified listing-to-master-SKU/location mappings; implement order intake/idempotency, Central Inventory reserve/consume/release events, real invoice/label/carrier services, return intake, retry/dead-letter monitoring, and provider readback. The official references are [Amazon SP-API onboarding](https://developer-docs.amazon.com/sp-api/docs/onboarding-overview), [SP-API connection and LWA authorization](https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api), and [SP-API regional endpoints](https://developer-docs.amazon.com/sp-api/docs/sp-api-endpoints). Keep credentials out of source files, logs, and chat. Measure commit-to-publish and provider-readback latency with retries and concurrent events before stating a synchronization target.
