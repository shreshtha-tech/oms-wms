# Reliability change inventory

This lists the reliability work, not every preexisting uncommitted change. Generated evidence is in `tmp/mongo-reliability` and `docs/reliability`. Existing business workflows and unrelated modifications were preserved.

- `.node-version`
- `.nvmrc`
- `api/admin-parity.js`
- `api/admin.js`
- `api/ajio.js`
- `api/allocation-strategies.js`
- `api/amazon-mfn.js`
- `api/ars.js`
- `api/asn-enquiry.js`
- `api/attribute-sets.js`
- `api/back-orders.js`
- `api/bin-audit.js`
- `api/bin-editor.js`
- `api/bin-enquiry.js`
- `api/bulk-order-update.js`
- `api/bulk-upload.js`
- `api/category-buyers.js`
- `api/channels.js`
- `api/clients.js`
- `api/cod-reconciliation.js`
- `api/consolidate-ewb.js`
- `api/coupons.js`
- `api/customer-groups.js`
- `api/customer-return-editor.js`
- `api/customer-return-enquiry.js`
- `api/customers.js`
- `api/cycle-count-waves.js`
- `api/cycle-count.js`
- `api/dashboard.js`
- `api/delivery-shipping.js`
- `api/delivery-split.js`
- `api/discrepancy-enquiry.js`
- `api/dispatch-checkpoint.js`
- `api/downloads.js`
- `api/exports.js`
- `api/external-app-connections.js`
- `api/external-app-definitions.js`
- `api/external-apps.js`
- `api/fulfillment.js`
- `api/generic.js`
- `api/global-header-search.js`
- `api/global-order-search.js`
- `api/global-returns-search.js`
- `api/grn.js`
- `api/inbound-create-edit.js`
- `api/inbound-enquiry.js`
- `api/inbound-gate-pass.js`
- `api/inbound-qc.js`
- `api/inbound-realtime.js`
- `api/inventory-move-history.js`
- `api/inventory-move-scan.js`
- `api/inventory-move.js`
- `api/inventory-ops.js`
- `api/inventory.js`
- `api/kitting-orders.js`
- `api/locations.js`
- `api/lottable-validations.js`
- `api/lpn-enquiry.js`
- `api/manage-asn.js`
- `api/manage-attributes.js`
- `api/manage-awb.js`
- `api/manage-manifests.js`
- `api/manage-picking.js`
- `api/manage-picklists.js`
- `api/master-orders.js`
- `api/merch-hierarchy.js`
- `api/mongo-connection.js`
- `api/mongo.js`
- `api/mp-inventory-log.js`
- `api/oms-rules.js`
- `api/order-acknowledgement.js`
- `api/order-allocation.js`
- `api/order-enquiry.js`
- `api/order-maintenance.js`
- `api/order-refunds.js`
- `api/org-hierarchy.js`
- `api/partners.js`
- `api/picker-zone-preferences.js`
- `api/picklists.js`
- `api/platforms.js`
- `api/po-revision.js`
- `api/price-zones.js`
- `api/pricing-events.js`
- `api/procurement.js`
- `api/purchase-charge-masters.js`
- `api/purchase-order-asn.js`
- `api/purchase-order-comments.js`
- `api/purchase-order-inbound.js`
- `api/purchase-order-tags.js`
- `api/purchase-orders.js`
- `api/putaway-enquiry.js`
- `api/putaway-rules.js`
- `api/qc-params-mapping.js`
- `api/receipt-validations.js`
- `api/reports.js`
- `api/return-otc.js`
- `api/return-without-order.js`
- `api/returns.js`
- `api/role-editor.js`
- `api/rtv-enquiry.js`
- `api/sale-orders.js`
- `api/service-pin-codes.js`
- `api/settings.js`
- `api/shipment-handover.js`
- `api/shipments.js`
- `api/sku-channel-links.js`
- `api/sku-company-links.js`
- `api/sku-grading.js`
- `api/sku-groups.js`
- `api/sku-imports.js`
- `api/sku-moderation.js`
- `api/skubarcode.js`
- `api/skus.js`
- `api/sto-editor.js`
- `api/sto-enquiry.js`
- `api/store-groups.js`
- `api/tally-config.js`
- `api/tax-categories.js`
- `api/tax-groups.js`
- `api/tax-zones.js`
- `api/taxapp.js`
- `api/taxcodes.js`
- `api/transfers.js`
- `api/transhipment-old.js`
- `api/transhipment.js`
- `api/transporter-preferences.js`
- `api/transporters.js`
- `api/user-editor.js`
- `api/user-enquiry.js`
- `api/vendor-promotions.js`
- `api/vendor-return-editor.js`
- `api/vendor-sku-catalog.js`
- `api/vendor-sku-loc-catalog.js`
- `api/vendors.js`
- `api/vin-lister.js`
- `api/wms-zones.js`
- `db/migrations/019_reliability_login.sql`
- `inventory/connection-security.js`
- `inventory/connectors/amazon.js`
- `inventory/connectors/shopify.js`
- `inventory/connectors/zoho-pos.js`
- `inventory/db.js`
- `inventory/rate-limit.js`
- `inventory/whatsapp.js`
- `package-lock.json`
- `package.json`
- `reliability/http.js`
- `reliability/login-limiter.js`
- `reliability/operations.js`
- `reliability/postgres-connection.js`
- `reliability/provider-call.js`
- `reliability/telemetry.js`
- `render.yaml`
- `scripts/apply-reliability-migration.mjs`
- `scripts/audit-reliability-dependencies.py`
- `scripts/probe-mongo-reliability.mjs`
- `scripts/run-isolated-mongo-reliability.mjs`
- `scripts/run-reliability-unit-gates.mjs`
- `scripts/verify-mongo-integrity-gates.mjs`
- `scripts/verify-mongo-reliability-api.mjs`
- `scripts/verify-mongo-reliability.mjs`
- `scripts/verify-postgres-reliability.mjs`
- `scripts/verify-provider-reliability.mjs`
- `scripts/verify-reliability-http.mjs`
- `scripts/verify-whatsapp-reliability.mjs`
- `server.js`
- `src/components/RequestErrorState.tsx`
- `src/context/AuthContext.tsx`
- `src/eretail/EnquiryScreen.tsx`
- `src/eretail/Shell.tsx`
- `src/eretail/masters/SkuGroup.tsx`
- `src/lib/api.ts`
- `src/lib/requestFailures.ts`
- `src/pages/GRN.tsx`

Additional continuation changes:

- `reliability/api-errors.js`
- `inventory/central-api.js`
- `inventory/files-api.js`
- `inventory/http.js`
- `inventory/unified-orders.js`
- `scripts/run-reliability-extended-gates.mjs`
- `scripts/verify-postgres-failure-injection.mjs`
- `scripts/verify-mongo-startup-recovery.mjs`
- `scripts/verify-mongo-timeout-fixture.mjs`
- `scripts/verify-purchase-order-reliability.mjs`
- `scripts/report-reliability-test-status.py`

Configured-boundary and stock-ordering continuation changes:

- `inventory/workers.js`
- `inventory/ingress.js`
- `inventory/stock-observations.js`
- `scripts/verify-inventory-publish-order.mjs`
- `scripts/run-isolated-reliability-postgres.mjs`
- `scripts/verify-stock-lock-reliability.mjs`
- `scripts/verify-stock-observation-ordering.mjs`
- `scripts/probe-configured-mongo-boundary.mjs`
- `scripts/probe-configured-mongo-tls-implementation.mjs`
- `scripts/probe-configured-inventory-basis.mjs`
- `scripts/probe-configured-shopify-readonly.mjs`
- `scripts/build-provider-evidence-matrix.mjs`

Connection readiness evidence repair:

- `inventory/connection-readiness.js`
- `scripts/verify-connection-readiness.mjs` (positive publication fixture now includes the required successful-task timestamp)
- `scripts/verify-connection-runtime-evidence.mjs`
- `scripts/run-reliability-unit-gates.mjs`

Order webhook evidence continuation:

- `inventory/webhook-evidence.js`
- `inventory/ingress.js`
- `inventory/http.js`
- `inventory/connections.js`
- `inventory/unified-orders.js`
- `inventory/connection-readiness.js`
- `scripts/verify-order-webhook-evidence.mjs`
- `scripts/run-isolated-reliability-postgres.mjs`
- `scripts/verify-connection-readiness.mjs` (confirmed WooCommerce fixture includes a delivery timestamp)
- `scripts/verify-connection-runtime-evidence.mjs`

Public tenant isolation continuation:

- `inventory/public-tenant-boundary.js`
- `inventory/http.js`
- `inventory/connections.js`
- `inventory/tally-bridge.js`
- `scripts/verify-order-webhook-evidence.mjs`
- `docs/reliability/PUBLIC_INTEGRATION_BOUNDARIES.md`

Private tenant input continuation:

- `inventory/http.js`
- `scripts/verify-private-tenant-inputs.mjs`
- `scripts/run-reliability-unit-gates.mjs`

Snapshot upload boundary continuation:

- `inventory/snapshot-upload.js`
- `inventory/partner-file.js`
- `inventory/http.js`
- `scripts/verify-snapshot-upload-boundary.mjs`
- `scripts/verify-private-tenant-inputs.mjs`
- `scripts/run-reliability-unit-gates.mjs`

Unapproved snapshot ordering gate:

- `inventory/partner-file.js`
- `inventory/http.js`
- `scripts/verify-snapshot-upload-boundary.mjs`
- `scripts/verify-private-tenant-inputs.mjs`

Dependency gate evidence continuation:

- `scripts/build-production-dependency-gates.mjs`
- `scripts/build-provider-evidence-matrix.mjs`
- `docs/reliability/production-dependency-gates.json`

Secret exposure audit continuation:

- `scripts/audit-secret-exposure.mjs`
- `docs/reliability/SECRET_EXPOSURE_AUDIT.md`
- `docs/reliability/secret-exposure-evidence.json`
- `docs/reliability/generated-secret-exposure-evidence.json`

External claim evidence correction:

- `inventory/connection-readiness.js`
- `scripts/verify-connection-readiness.mjs`
- `scripts/verify-connection-runtime-evidence.mjs`

Tally XML boundary continuation:

- `inventory/tally-bridge.js`
- `scripts/verify-tally-xml-boundary.mjs`
- `scripts/run-reliability-unit-gates.mjs`

Credential inventory and crypto audit continuation:

- `scripts/build-credential-inventory.mjs`
- `scripts/verify-credential-crypto-boundary.mjs`
- `docs/reliability/credential-inventory.json`
- `docs/reliability/credential-crypto-evidence.json`
- `docs/reliability/CREDENTIAL_SECURITY_AUDIT.md`

Browser credential submission continuation:

- `src/lib/credentialRequest.ts`
- `src/pages/SellerConnections.tsx`
- `scripts/verify-credential-request-boundary.mjs`

Dynamic browser credential evidence:

- `scripts/verify-browser-credential-boundary.mjs`
- `scripts/run-isolated-reliability-postgres.mjs`

Credential ciphertext format continuation:

- `inventory/credentials.js`
- `scripts/verify-credential-crypto-boundary.mjs`

Credential pattern discovery and private config permissions:

- `scripts/audit-credential-patterns.py`
- `.env` (permissions only: 0600; values unchanged, untracked)
- `docs/reliability/CREDENTIAL_PATTERN_AUDIT.md`
- `docs/reliability/credential-pattern-evidence.json`
- `docs/reliability/credential-pattern-initial-evidence.json`
- `docs/reliability/credential-pattern-review.json`

Archive credential-content evidence:

- `scripts/audit-archive-credential-content.py`
- `docs/reliability/archive-credential-evidence.json`
- `docs/reliability/ARCHIVE_CREDENTIAL_AUDIT.md`

Delimited export boundary continuation:

- `src/lib/exporters.ts`
- `scripts/verify-delimited-export-boundary.mjs`

Saved-secret response continuation: inventory/connections.js removes credential suffix disclosure; scripts/verify-connection-secret-view.mjs adds catalog-wide controlled response cases; scripts/verify-seller-connections.mjs strengthens masking acceptance. Security/report/completion evidence updated.

2026-10-05 candidate provenance: scripts/build-credential-candidate-review.py and credential-pattern-review.json resolve bounded exact source identities and retain unknown review fields for all 96 candidates; audit/report evidence updated.

Candidate consumer review: credential-pattern-review.json records six source-traced TEST_ONLY classifications; build-credential-candidate-review.py retains reviews only against unchanged source identities; crypto evidence refreshed and audit/report notes updated.

Database setup security: db/DATABASE_SETUP.md corrected; database-guide-security-finding.json records attack/impact/source repair and unresolved historical credential authenticity; candidate source resolution and security/report notes refreshed.

Historical guide audit: audit-historical-guide-credentials.mjs, historical-guide-credential-evidence.json, exact-source candidate review/classification and resolver summary updated; audit/report evidence appended.

Historical metadata review: credential-pattern-review.json adds seven exact-blob consumer classifications with historical storage/browser limitations; security/report audit notes updated.

External-app candidate continuation: credential-pattern-review.json records four source-traced TEST_ONLY classifications; existing secret-handling regression rerun and audit/report evidence refreshed.

Seller review/isolation: verify-seller-connections.mjs tightens target guard, verify-seller-test-database-guard.mjs adds negative subprocess regression, candidate classifications and audit/report evidence updated.

Browser status continuation: verify-browser-credential-boundary.mjs expands to 16 authenticated failure cases; candidate classification/security/report evidence refreshed.

Stock candidate continuation: publication verifier target guard tightened; negative guard regression covers both seller and publication; two candidate consumer classifications and security/report evidence updated.

Authentication/setup candidate review: two source-traced test classifications; returns-fixture-isolation-finding.json records unexecuted PostgreSQL isolation gap; audit/report evidence updated.

Returns fixture repair: verify-return-without-order.mjs, disposable harness whitelist, negative target guard regression, finding/candidate evidence and audit/report notes updated.

Session continuation: verify-session-recovery.mjs explicitly binds child to synthetic bridge tenant; candidate review and fresh disposable auth/token rollback evidence recorded in audit/report notes.

WhatsApp consumer review: two exact-source TEST_ONLY classifications with mock transport/error evidence; candidate/security/report audit notes refreshed.

Preserved fixture review: credential-pattern-review.json records two source-traced historical-copy TEST_ONLY classifications with no execution claim; audit/report evidence updated.

Discovery provenance continuation: discovery-candidate-provenance.json records seven exact copied-source links; candidate classifications and security/report audit evidence refreshed.

Diff provenance review: diff-candidate-provenance.json links two exact added lines to reviewed consumers; candidate and security/report audit notes updated.

Admin key response repair: api/admin.js, verify-admin-key-response-boundary.mjs, admin-key-response-finding.json and security/report evidence updated.

Parity key response repair: api/admin-parity.js, scripts/verify-admin-parity-key-boundary.mjs, admin-parity-key-response-finding.json and security/completion/report evidence updated.

Admin unexpected error repair: api/admin.js, api/admin-parity.js, scripts/verify-admin-error-boundary.mjs, admin-error-response-finding.json, incremental security-boundary-matrix.json and security/completion/report notes.

Admin race repair: api/mongo.js shared atomic admin update, api/admin.js and api/admin-parity.js callers; verify-admin-version-race.mjs; finding/matrix and audit/report notes.

Real Mongo admin race verification: verify-admin-version-race.mjs guarded persistent mode and guaranteed client close; finding/matrix and security/completion/report evidence refreshed.

Required admin versions: generic/parity validation and legacy response normalization; race negative tests and parity success fixture; finding/matrix/security/completion/report evidence.

Generic admin stale deletion: api/admin.js version validation, api/mongo.js atomic removal, expanded race regression, finding/matrix and audit/report evidence.

Website outage continuation: current sanitized configured Atlas TLS probe and WMS Zone/database readiness impact added to ATLAS_BOUNDARY_2026-10-05.md, COMPLETION_AUDIT.md and report.

Post-fix outage revalidation: sanitized configured Mongo TLS/authenticated ping, no-restart app readiness recovery, read-only authenticated WMS check through disposable PostgreSQL and collection-absence evidence; dependency gates refreshed without changing configured data.
