# Executive recommendations — provisional research checkpoint

Status: IN PROGRESS. This is not a final completed-research presentation or roadmap approval request.

The inspected application is an existing React/Vite/Express platform with PostgreSQL Central Inventory authority, legacy Mongo operational modules, provider observations, an inbox/outbox worker, physical-location movement and guarded publication uncertainty. Preserve this investment (LOC-001/002/003/004/007). No evidence currently justifies a database replacement, microservice split or new message broker.

The strongest source comparisons are Saleor for ordered stock allocation (UP-001), ERPNext for reservation/cancellation and database-specific gates (UP-007), Vendure for batch locks and carefully scoped concurrent tests (UP-004), Medusa for provider locks and compensation (UP-003), and pg-boss for retry tests (UP-005). Odoo and OpenBoxes inform physical dimensions; Camel, Graphile, Debezium and Shopify/Woo sources illustrate bounded integration/recovery mechanisms. They do not yet all have complete API-to-effect traces.

Most urgent current risks: return approval lacks an explicit inspected operation guard and actor/QC provenance is incomplete (LOC-005/006); different receipt/order lock sort keys may deadlock and need deterministic proof (LOC-016, INFERRED); quota handling and missed-event/full-history reconciliation remain incomplete (LOC-008/014/015). Existing publication uncertainty must be preserved (LOC-007). Operational summary omits held tasks (LOC-017), and Mongo logical backup explicitly is not a consistent snapshot (LOC-018).

Earlier user-authorized fixes removed hidden SKU writes before import failure and added migration checksum history and CI/dependency configuration; exact isolated PASS scopes are in confirmed-defect-validation.json. Actual SKU ingestion is still unavailable. The latest user brief requires roadmap approval before any further application code change.

Recommended phases and evidence are in 14-implementation-roadmap.md: R-01 return approval authority/provenance; R-02/R-03 deterministic shared-writer and recovery proof; R-04 provider contracts/completeness; R-05 server-owned intake; approved physical custody workflow; operations and recovery/supply-chain evidence. First proposed slice is R-01, preserving current stock semantics and granting no permissions automatically.

Outstanding uncertainties: full competing returns/authorization traces, stronger source/test/history evidence across all retained candidates, remaining ERP/WMS seed repositories, official endpoint contracts, standards mapping, license/advisory/provenance verification and complete requirement audit. Numeric discovery targets and document existence do not establish completion. No configured provider, production, load, restore or hosted rollout certification is claimed.
