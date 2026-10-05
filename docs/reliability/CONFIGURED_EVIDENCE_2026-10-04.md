# Configured data-plane and provider evidence — 2026-10-04

**PRODUCTION READY = NO. COMPLETION = UNPROVEN.** This report distinguishes genuine configured observations from disposable fixtures. No configured business data, stock, locations, account activation, subscriptions or token persistence was changed.

## MongoDB

DNS SRV/TXT and all three hostname resolutions succeed. TCP succeeds to every endpoint. Correct-SNI, certificate-verified Node TLS negotiation fails with alert 80 under default, TLS 1.2 and TLS 1.3 settings. An independent LibreSSL handshake also fails before ServerHello/peer certificate. A public HTTPS control validates successfully. Authentication and configured-database access remain unverified. See ATLAS_BOUNDARY_2026-10-04.md for the exact trace, limitations and required owner-side checks.

## PostgreSQL operational basis

A fresh `BEGIN READ ONLY` transaction confirms the configured tenant exists in configuration and owns these counts:

| Entity | Configured-tenant count |
|---|---:|
| Master SKUs | 3,243 |
| Channel mappings | 636 |
| Channel accounts | 2 |
| Locations | 0 |
| Inventory balances | 0 |
| Inventory events | 0 |
| Reservations | 0 |
| Outbox jobs | 0 |

These are catalog/configuration records. There is no recorded location/opening-balance/event/reservation basis for physical operations. Missing stock was not generated to satisfy a release gate. The business owner must establish the correct warehouse/location, authorized SKU mappings and legitimate opening/count evidence through the authoritative workflow. If no physical stock is legitimate, that must be treated as the actual business state rather than replaced by generated stock.

## Genuine Shopify authentication/identity reads

Both stored accounts are inactive. One stored state was `not_connected` with no verification date; the other retained `verified` dated 2026-09-24. Those stored labels did not prove current access.

The existing encrypted vault decrypts with the configured private key. Both accounts store client ID/client secret rather than an access token. A bounded client-credentials exchange obtained a token **only in memory**, followed by the read-only GraphQL query for shop ID/domain and current installation scopes. Both accounts returned successful reads, and both returned shop identities matched their exact configured domains. Secret values, provider account domains/IDs, tokens and certificate material were not printed or persisted.

| Stage | Fresh evidence |
|---|---|
| Configured credential mechanism | Both vault records contain client ID and client secret |
| Authenticated | Real token exchange and authenticated read succeeded for both |
| Correct account identity | Real returned shop domain matched each stored account identity |
| Tenant mapping | Both account rows belong to the configured tenant; this is local ownership evidence, not provider tenant semantics |
| Scope readable | Real installation scope handles read for both; `read_inventory`, `write_inventory`, `read_orders`, `read_products` present |
| Location permission | Real bounded location ID/name query rejected for both accounts despite HTTP 200; `read_locations` absent from both granted scope lists |
| Correct channel/location mapping | Not established; configured tenant has no internal locations |
| Inventory readable | Granted read scope observed; no mapped quantity readback was attempted in this probe |
| Inventory writable | Granted write scope observed; no inventory write was attempted or proven |
| Webhook registered/receiving | Not queried or proven in this probe |
| Provider mutation acknowledged | Not attempted or proven |
| Provider quantity readback | Not attempted or proven |
| Reconciled | Not proven |

The repository's declared scope list additionally includes `read_locations`, which was not returned in these granted-scope reads. The bounded location ID/name read now demonstrates an operation-specific permission failure for both accounts. The owner must grant the required location access through the appropriate private app authorization workflow and repeat the read before mappings can be approved. No permission was silently expanded or assumed.

Evidence: `tmp/mongo-reliability/configured-inventory-basis-2026-10-04.json`, `configured-shopify-readonly-2026-10-04.json` and corresponding sanitized log. The probe left the saved verification labels and encrypted credential records unchanged. Fresh read authentication does not imply activation or safe publication.

## Controlled regression evidence

The provider publication, seller connection, sales-program, stock-lock and stock-observation ordering tests use disposable PostgreSQL and explicit provider fixtures. They establish local behavior only. The corrected stock-observation test verifies signed timestamp retention, reordered/concurrent Shopify/Amazon observations, same-timestamp conflict rejection, invalid/future observations, cross-tenant mapping rejection and a slow reconciliation read racing a newer observation. Observations never post physical stock events.

## Remaining gates

1. Resolve Atlas TLS at the verified boundary; then prove authenticated configured Mongo/database/tenant reads and persistence independently.
2. Establish a legitimate physical stock/location basis; do not synthesize missing operational balances.
3. Validate actual provider operation permissions, exact SKU/location mappings, subscriptions, delivery, write acknowledgement and readback/reconciliation before activation.
4. Continue the complete tenant, authorization, public-route, event-ordering and crash audits. These successful read checks do not establish overall production readiness.
