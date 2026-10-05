# Unused-file and launch-package inventory

Static inspection and removal check on 24 September 2026. Six unreachable frontend/starter files were deleted after a second reference check. "Unused" for the remaining lists means absent from standard runtime commands; manual commands and future connector work still require human review.

## Removed after second reference check (6)

- `src/App.css`
- `src/assets/react.svg`
- `src/components/Layout.tsx`
- `src/eretail/charts.tsx`
- `src/pages/Returns.tsx`
- `public/vite.svg`

All six lacked references from the current app entry point or server. After removal, the frontend import graph has zero unreachable source files; `npm run typecheck` and `npm run build` pass. The active favicon remains `public/favicon.svg`.

## Unwired connector retained (1)

- `inventory/connectors/zoho-pos.js` — not yet imported by a worker, but retained for the documented Zoho POS integration.

## Standalone scripts with no package command or discovered reference (92)

These are inspection or manual verification tools. They are not part of the web or worker launch package. The list is archival candidates, not proof that their reference evidence is obsolete.

- `scripts/analyze-thread-sutra-listing.mjs`
- `scripts/capture-external-apps-local.mjs`
- `scripts/capture-live-shell-parity.mjs`
- `scripts/capture-live-transporter-catalogs.mjs`
- `scripts/cdp-external-apps-audit.mjs`
- `scripts/cdp-external-apps-editor-audit.mjs`
- `scripts/cdp-external-apps-matrix-audit.mjs`
- `scripts/cdp-po-revision-audit.mjs`
- `scripts/compare-live-local-navigation-geometry.mjs`
- `scripts/compare-live-local-navigation.mjs`
- `scripts/explore-authenticated-reference.mjs`
- `scripts/inspect-live-account-actions.mjs`
- `scripts/inspect-live-account-subworkflows.mjs`
- `scripts/inspect-live-admin-parity.mjs`
- `scripts/inspect-live-ars-execution-log.mjs`
- `scripts/inspect-live-asn-contract.mjs`
- `scripts/inspect-live-auth-session-contract.mjs`
- `scripts/inspect-live-client-editor.mjs`
- `scripts/inspect-live-client-search-contract.mjs`
- `scripts/inspect-live-coupon-editor.mjs`
- `scripts/inspect-live-customer-audit-reset.mjs`
- `scripts/inspect-live-customer-editor.mjs`
- `scripts/inspect-live-customer-group-editor.mjs`
- `scripts/inspect-live-customer-other-settings.mjs`
- `scripts/inspect-live-customer-parent-picker.mjs`
- `scripts/inspect-live-customer-search-contract.mjs`
- `scripts/inspect-live-customer-subworkflows.mjs`
- `scripts/inspect-live-customer-tcs-control.mjs`
- `scripts/inspect-live-customer-validation-handlers.mjs`
- `scripts/inspect-live-eretail-dashboard.mjs`
- `scripts/inspect-live-footer-tabs.mjs`
- `scripts/inspect-live-global-controls-keyboard.mjs`
- `scripts/inspect-live-global-dialog-controls.mjs`
- `scripts/inspect-live-global-feedback.mjs`
- `scripts/inspect-live-global-grid-loading.mjs`
- `scripts/inspect-live-global-menu.mjs`
- `scripts/inspect-live-global-session-requests.mjs`
- `scripts/inspect-live-global-shell.mjs`
- `scripts/inspect-live-header-controls.mjs`
- `scripts/inspect-live-header-dialogs.mjs`
- `scripts/inspect-live-header-search-contract.mjs`
- `scripts/inspect-live-login-contract.mjs`
- `scripts/inspect-live-login-secondary-actions.mjs`
- `scripts/inspect-live-navigation-geometry.mjs`
- `scripts/inspect-live-navigation-inventory.mjs`
- `scripts/inspect-live-navigation.mjs`
- `scripts/inspect-live-profile-screen.mjs`
- `scripts/inspect-live-purchase-charge.mjs`
- `scripts/inspect-live-seller-panel-dashboard.mjs`
- `scripts/inspect-live-seller-panel-modes.mjs`
- `scripts/inspect-live-shell-responsive.mjs`
- `scripts/inspect-live-sidebar-overflow.mjs`
- `scripts/inspect-live-trading-partner-enquiry.mjs`
- `scripts/inspect-live-transporter-conditional.mjs`
- `scripts/inspect-live-transporter-dynamic-tabs.mjs`
- `scripts/inspect-live-transporter-editor-compact.mjs`
- `scripts/inspect-live-transporter-editor.mjs`
- `scripts/inspect-live-transporter-search-contract.mjs`
- `scripts/inspect-live-vendor-editor-tabs-direct.mjs`
- `scripts/inspect-live-vendor-editor-tabs.mjs`
- `scripts/inspect-live-vendor-editor.mjs`
- `scripts/inspect-live-vendor-invoice.mjs`
- `scripts/inspect-live-vendor-master.mjs`
- `scripts/inspect-live-vendor-promotion-editor.mjs`
- `scripts/inspect-live-vendor-promotions.mjs`
- `scripts/inspect-live-vendor-subworkflows.mjs`
- `scripts/inspect-local-header-controls.mjs`
- `scripts/inspect-local-shell-responsive.mjs`
- `scripts/verify-admin-live-parity.mjs`
- `scripts/verify-bulk-upload.mjs`
- `scripts/verify-customer-return-editor.mjs`
- `scripts/verify-customer-return-enquiry.mjs`
- `scripts/verify-discrepancy-enquiry.mjs`
- `scripts/verify-dispatch-checkpoint.mjs`
- `scripts/verify-dmills-routes.mjs`
- `scripts/verify-exports.mjs`
- `scripts/verify-force-order-pull.mjs`
- `scripts/verify-global-returns-search.mjs`
- `scripts/verify-lpn-enquiry.mjs`
- `scripts/verify-order-import.mjs`
- `scripts/verify-putaway-enquiry.mjs`
- `scripts/verify-qc-params-mapping.mjs`
- `scripts/verify-return-otc.mjs`
- `scripts/verify-role-editor.mjs`
- `scripts/verify-rtv-enquiry.mjs`
- `scripts/verify-settings.mjs`
- `scripts/verify-sto-editor.mjs`
- `scripts/verify-sto-enquiry.mjs`
- `scripts/verify-user-editor.mjs`
- `scripts/verify-user-enquiry.mjs`
- `scripts/verify-vendor-return-editor.mjs`

## Generated/reference artifacts (66 files)

None are loaded by the production web or inventory worker. Live-parity captures support audit documentation; central-inventory exports/screenshots are test output. They may be moved to an external evidence archive after handover.

- `artifacts/central-inventory/1024-Record-physical-stock.png`
- `artifacts/central-inventory/1024-Stock-overview.png`
- `artifacts/central-inventory/1024-wms-menu.png`
- `artifacts/central-inventory/1440-Record-physical-stock.png`
- `artifacts/central-inventory/1440-Stock-overview.png`
- `artifacts/central-inventory/1440-wms-menu.png`
- `artifacts/central-inventory/390-Record-physical-stock.png`
- `artifacts/central-inventory/390-Stock-overview.png`
- `artifacts/central-inventory/390-wms-menu.png`
- `artifacts/central-inventory/768-Record-physical-stock.png`
- `artifacts/central-inventory/768-Stock-overview.png`
- `artifacts/central-inventory/768-wms-menu.png`
- `artifacts/central-inventory/pdf-preview.png`
- `artifacts/central-inventory/shopify-verified-sample.json`
- `artifacts/central-inventory/ui-download.pdf`
- `artifacts/central-inventory/ui-download.xlsx`
- `artifacts/central-inventory/ui-failure.png`
- `artifacts/central-inventory/verified-export.pdf`
- `artifacts/central-inventory/verified-export.xlsx`
- `artifacts/live-parity/admin/accounting-log-details.json`
- `artifacts/live-parity/admin/accounting-log.json`
- `artifacts/live-parity/admin/accounting-log.png`
- `artifacts/live-parity/admin/api-dashboard-details.json`
- `artifacts/live-parity/admin/api-dashboard.json`
- `artifacts/live-parity/admin/api-dashboard.png`
- `artifacts/live-parity/admin/device-tracking-log-details.json`
- `artifacts/live-parity/admin/device-tracking-log.json`
- `artifacts/live-parity/admin/device-tracking-log.png`
- `artifacts/live-parity/admin/exports.json`
- `artifacts/live-parity/admin/exports.png`
- `artifacts/live-parity/admin/external-apps-logs-details.json`
- `artifacts/live-parity/admin/external-apps-logs.json`
- `artifacts/live-parity/admin/external-apps-logs.png`
- `artifacts/live-parity/admin/force-order-pull.json`
- `artifacts/live-parity/admin/force-order-pull.png`
- `artifacts/live-parity/admin/language-setting-details.json`
- `artifacts/live-parity/admin/language-setting.json`
- `artifacts/live-parity/admin/language-setting.png`
- `artifacts/live-parity/admin/manage-api-add-edit.json`
- `artifacts/live-parity/admin/manage-api-add-edit.png`
- `artifacts/live-parity/admin/manage-api-details.json`
- `artifacts/live-parity/admin/manage-api.json`
- `artifacts/live-parity/admin/navigation.json`
- `artifacts/live-parity/admin/pos-integration-log-details.json`
- `artifacts/live-parity/admin/pos-integration-log.json`
- `artifacts/live-parity/admin/pos-integration-log.png`
- `artifacts/live-parity/admin/register-webhook.json`
- `artifacts/live-parity/admin/register-webhook.png`
- `artifacts/live-parity/admin/repush-log-details.json`
- `artifacts/live-parity/admin/repush-log-emailtransit.json`
- `artifacts/live-parity/admin/repush-log-emailtransit.png`
- `artifacts/live-parity/admin/repush-log-manifeststatus.json`
- `artifacts/live-parity/admin/repush-log-manifeststatus.png`
- `artifacts/live-parity/admin/repush-log-transmitdetail.json`
- `artifacts/live-parity/admin/repush-log-transmitdetail.png`
- `artifacts/live-parity/admin/repush-log.json`
- `artifacts/live-parity/admin/repush-log.png`
- `artifacts/live-parity/admin/settings-source.json`
- `artifacts/live-parity/admin/tax-integration-log-details.json`
- `artifacts/live-parity/admin/tax-integration-log.json`
- `artifacts/live-parity/admin/tax-integration-log.png`
- `artifacts/live-parity/admin/user-audit-logs-details.json`
- `artifacts/live-parity/admin/user-audit-logs.json`
- `artifacts/live-parity/admin/user-audit-logs.png`
- `artifacts/live-parity/live-shell.png`
- `artifacts/live-parity/shell-observations.json`

## Rebuildable or local-only directories

- `dist/` — Vite build output, regenerated by `npm run build`.
- `node_modules/` — installed dependencies, regenerated by `npm ci`.
- `browser-profile/` — ignored local browser session/cache; may contain active sessions. Never put it in the launch package.

## Keep

- `db/migrations/`, `inventory/`, `api/`, `.env.example`, `render.yaml`, `package-lock.json`, `README.md`, and current implementation/architecture docs remain relevant.
- `scripts/fixtures/start-admin-parity-server.mjs` is invoked by `scripts/verify-admin-live-parity.mjs` even though it is not a package script.
- Existing `git status` shows extensive pre-existing uncommitted work; this inventory does not authorize deleting it.
