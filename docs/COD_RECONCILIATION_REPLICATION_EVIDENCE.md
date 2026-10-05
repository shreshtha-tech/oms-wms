# COD Reconciliation evidence

Audit date: 30 September 2026. This records the signed-in local check for `/app/cod-reconciliation`. The verifier used generated `codexqa_*` databases, inserted isolated `sale_orders` source fixtures, and let the harness remove the databases after the run. No configured database was written.

## Verified read workflow

`npm run test:cod-reconciliation` passed through the isolated browser harness.

- Metadata exposed the current transporter catalog, reconciliation values and page sizes.
- Signed-in API and browser search found generated legacy COD rows by transporter, Web Order No, tracking number, ship-date range, delivery number, and reconciled state.
- The screen showed the stored Web Order No, AWB, dates, transporter, collectable amount, tender amounts, received amount, status and source.
- Empty queue selection/import validation, page shape, invalid transporter and calendar-date filters were checked.
- Generated order fixtures remained unchanged after all blocked mutation attempts. Central Inventory event keys also stayed unchanged.

## Fail-closed settlement and report behavior

- Reconcile and Force Reconcile return HTTP 501 for a selected record and the UI disables both controls.
- Settlement import returns HTTP 501 for a valid nonempty batch; empty and over-500-line requests retain explicit validation errors. The UI disables the import control.
- Export returns HTTP 501 when rows are available, creates no `pending-report` row, and the UI disables Download because no report worker exists.
- A no-selection reconciliation attempt still returns the existing `Please Select Record For Process.` validation.

The legacy behavior was unsafe for production: caller-supplied tender totals changed `sale_orders` and could set `payment_reconciled`, while Force Reconcile bypassed the collectable amount. It had no settlement-source validation, durable attempt history, authenticated audit fields, replay protection or provider readback. The former export returned a pending ID without a worker to generate or deliver the file.

## Implementation and limits

- `api/cod-reconciliation.js` now keeps queue reads and filtering available, validates transporter/date/reconciliation filters, and blocks settlement/import/export writes.
- `src/eretail/sales/CodReconciliation.tsx` shows the missing settlement/report prerequisites and disables unsupported controls.
- `scripts/verify-cod-reconciliation.mjs` covers the signed browser, generated MongoDB readback, blocked mutations/export, and no-stock-event boundary.
- The queue still reads the legacy MongoDB `sale_orders` collection. It is not connected to the PostgreSQL live seller-order service. No courier remittance or payment provider was accessed; configured MongoDB reachability, finance roles, production behavior and LIVE screen parity remain unverified.

The module is classified **Partially functional**. Do not treat the displayed payment state as a verified settlement source.
