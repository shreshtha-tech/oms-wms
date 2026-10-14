# Excel stock initialization contract

Status: **source workbook inspection blocked; no opening stock authorized**. This document records the required contract before any real quantity is posted. It does not approve a mapping or constitute import evidence.

## Source and structural inspection

The workbook named in the Central Inventory screenshot is `all_inventory_027ca827a97544e6_LOCf90dda35cb304aa9a028a0985ff4fce3_NON_FBF (2).xlsx`. A file with that name exists in the local Downloads directory and was 1,009,606 bytes when checked on 2026-10-08. Reading it returned `EPERM` in this workspace. Its digest, sheets, hidden sheets, headers, formulas, merged cells, blank/duplicate rows, SKU/location/quantity/UOM/status/date columns and source provenance are **unverified**. The original must remain untouched and outside the repository.

Before mapping or import, inspect an accessible copy read-only and record: exact file digest and size; source date/owner; every visible and hidden sheet; header positions and duplicates; formulas and cached results; merged cells; blank and duplicate rows; column types and sample values with unnecessary personal data redacted. Record whether quantities are physically counted on-hand units or provider/listing availability. A file name or worksheet label is not evidence of that meaning.

The read-only command `node scripts/inspect-inventory-workbook.mjs /absolute/path/to/source.xlsx` now reports file digest, sheet visibility, first-row labels, candidate columns, duplicate headers/rows, formulas, merges, blank rows and column types without printing data-row values. Its candidate columns are structural hints only; a person must still verify semantics and approve the mapping. This command does not connect to a database or write inventory.

`inventory/opening-stock-validation.js` provides a separate read-only dry-run classifier for an explicitly versioned sheet/header/column mapping and tenant-scoped SKU/location snapshots. It reports row-level status, reason, source column and hashed value reference. A passing dry run is only eligible **for approval**; the opening-stock route additionally requires explicit staging/approval/post permissions and distinct creator, approver and poster usernames. Migration 023 stores nullable eligibility fields, so the opening-stock adapter rejects `NULL` as unverified and does not infer active status from existence.

The Central Inventory upload screen exposes two separate paths. **Map a source workbook to exact SKU counts** inspects an arbitrary visible sheet and lets the operator select the exact header row and SKU/quantity/location columns for an ordinary count of an existing SKU/location balance. It preserves the exact SKU text, rejects formula/duplicate/invalid rows, records a mapping digest and still requires `central_inventory.stock_count.write` to commit. **Opening-stock dry run** checks the owner-approved SKU/location/UOM eligibility required to initialize a zero-basis location; it remains a separate staged and dual-control workflow. Neither path was run against the named production workbook because reading the local source returned `EPERM`.

Location mapping supports an exact workbook column, an explicit source-code-to-Agon-code table, or a fixed Agon location with an evidence reference when the workbook has no location column. A declared translation never falls back to the raw code. Duplicate mapped headers require explicit review. None of these options authorizes an opening quantity by itself.

The CLI form is `node scripts/dry-run-opening-stock.mjs source.xlsx approved-mapping.json tenant-registry-snapshot.json`. It prints the summary and at most 100 rejected rows, with hashed source values. The JSON registry is caller-supplied and must be independently checked against the configured tenant before any approval; this CLI cannot authorize or post stock.

## Explicit mapping required

| Workbook column | Agon target | Transformation | Validation | Evidence/approval |
|---|---|---|---|---|
| **Unverified SKU column** | `ci_master_sku.sku` to resolve `master_sku_id` | Preserve exact business identifier; no case folding or prefix removal without owner-approved rule | Unique tenant-scoped active SKU; unresolved or multiple matches block posting | Source header/sample and approved SKU identity contract pending |
| **Unverified facility/location column** | `ci_location.code` to resolve `location_id` | Only an explicit source-to-Agon location map; do not infer from `WH`, file name or seller facility text | Tenant-scoped active physical warehouse/store, one unambiguous destination | Source header, location ownership and mapping approval pending |
| **Unverified quantity column** | Opening on-hand quantity for exact SKU/location | Only a documented unit conversion, if any | Nonnegative safe whole units, no formula, overflow, conflicting duplicate or unapproved zero interpretation | Physical count/source attestation and UOM/pack approval pending |
| **Unverified pack/UOM column** | SKU/UOM validation; never silent quantity multiplication | Owner-approved pack conversion only | Preserve original SKU mapping revision and distinguish pack listings from physical units | Source and pack contract pending |
| **Unverified status/date/identifier columns** | Import provenance or rejection evidence as approved | No stock effect by default | Inactive/foreign records rejected; source date and row identity retained | Source and business owner approval pending |

No workbook field is mapped merely because its header resembles a target field. The final mapping must name the exact source sheet, header, column index, transformation, example, validation, owner and version.

## Current implementation compared with opening-stock requirement

`inventory/workbook.js` supports the downloadable template and an explicit source-column map. With a map, an operator selects one visible sheet, header row, SKU and quantity columns, optional location column, and integer format. The server resolves exact tenant SKU/location identities, requires an existing balance, snapshots its version, and blocks duplicates, unknown SKUs/locations, unsafe quantities and stale commits. The commit writes a `physical_count` event per resolved row through the Central Inventory ledger and records the mapping digest with the event. No SKU is created and no balance is initialized by this route. `central_inventory.stock_count.write` is required at commit time. Migration 023 separately adds nullable opening-stock eligibility fields and dedicated batch/line/audit tables; existing identities remain unverified (`NULL`) until explicitly approved.

The opening path must be separate from ordinary count replacement: preserve the original file digest and row coordinates; require an approved mapping identity, authenticated approval actor and distinct posting actor; resolve tenant/SKU/location/UOM/pack before approval; reject duplicates and ambiguous quantities; post one `controlled_opening_import` ledger event per approved SKU/location with stable event identity; verify each resulting balance from events; and write a reconciled result. Exact replay must return the prior result and changed content under the same import identity must conflict. No posting is permitted while the source or mapping is unverified.

`inventory/opening-stock-service.js` stages the controlled opening batch after re-reading tenant-scoped SKU/location eligibility from PostgreSQL and revalidating workbook bytes. It stores metadata and resolved row facts, then supports request, separate approval, atomic posting, readback and same-batch replay. HTTP routes enforce explicit per-account permissions configured through `DMILLS_ADMIN_PERMISSIONS_JSON` and `DMILLS_OPERATOR_ACCOUNTS_JSON`; absent permissions grant no stock writes. The source workbook, owner-approved mapping, configured database, configured account roles and hosted behavior remain unverified.

The opening implementation records `POSTING`, `POSTED` and `RECONCILED` inside one PostgreSQL transaction. A database failure before commit rolls back to `APPROVED`; a lost HTTP response after commit is resolved by replaying the batch ID and reading the committed result. Durable `FAILED_RETRYABLE` and `REQUIRES_RECONCILIATION` states remain unimplemented. No remote provider call occurs in this opening-stock transaction.

## Operational gate

Existing-balance count updates can use the exact mapped-count path, but a report/listing quantity does not by itself prove a physical count. Keep real opening stock unposted until the source is accessible, the structural report and mapping are approved, SKU/location eligibility and physical units are attested, distinct accounts are configured, and the controlled opening flow passes isolated and configured-environment verification. Provider observations and catalog-listed quantities remain separate from physical stock.
