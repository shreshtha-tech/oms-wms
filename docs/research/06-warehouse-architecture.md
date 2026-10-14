# Warehouse architecture

Status: research synthesis completed within the scope in completion-audit.md. Current evidence: LOC-001/004/005/007/012; UP-001/002/007/008. Do not equate UI modules with authoritative execution.

The verified local transfer is an instantaneous, two-leg Central Inventory location move in one PostgreSQL transaction (LOC-004). A source shortage rejects the operation; destination failure must roll back both legs; exact request keys must replay both legs without another net movement. This model does not represent goods leaving a warehouse and arriving later. Do not extend it to asynchronous interwarehouse transport without explicit shipped/in-transit/received/lost quantities and custody evidence.

| Physical concern | Comparative evidence | Local classification / next proof |
|---|---|---|
| Location allocation | Saleor eligible channel/country warehouses; Vendure allocation strategy and ordered stock locks (UP-001/004) | Explicit physical mapping exists; allocation policy and complete multiwarehouse selection not yet certified |
| Lot and expiry | OpenBoxes lot identity shared across facilities, expiration date; Odoo quant lot/location/package/owner (UP-008/002) | Missing in inspected core balance dimensions; inspect all ancillary authoritative tables before final Missing verdict |
| Reservation and batch protection | ERPNext tests prevent consumption of reserved stock and cancellation restores reservation (UP-007) | Local exact line reservation present; batch/serial reservation not established |
| Picking/packing/shipping | No full upstream physical custody trace completed | Local staff shortcut rejected; authoritative scan/pack/handover proof still absent |
| Return receiving | Local order/dispatch-bounded receipt, ledger and timeline (LOC-005) | Condition/QC evidence, actor and approver authority incomplete |
| Cycle count | Local adjustment path uses ledger and request identity (LOC-001/004) | Count-session lifecycle, movement cutoff, recount/approval and freeze policy require separate trace |

Proposed boundary: a physical WMS command validates warehouse scope, object state, scan/request identity and quantities; it commits authoritative movement/reservation evidence through the existing PostgreSQL ledger. Legacy Mongo screens may remain operational projections, with explicit durable bridge events and no independent stock writer (LOC-001/003/004).

For picking, require an approved domain contract for order-line allocation → pick confirmation → pack contents → shipment/handover, including partial lines, substitutions, damage and cancellation races. This is a design question, not permission to invent missing production workflow. For FEFO, expiry and lot availability must be validated in the same transaction that allocates the selected stock dimension (UP-002/007/008); no local FEFO claim is made.

Further source research: OpenBoxes actual transaction-entry writer and tests; Odoo stock_move completion/return flow and quants; ERPNext Pick List and serial/batch bundle services. These remain unresolved before final architecture recommendation.

## Further inspected warehouse evidence

Odoo UP-002 quant tests explicitly cover serial continuity through receipt → packaged return → receipt, asserting one quant with the original serial. Its relocation test allocates eight units across two deliveries as five/three, moves the quant and asserts both allocations and new location. These are read assertions, NOT RUN. They supply useful physical reservation identity cases, not proof that every Odoo path is race-free.

Tryton UP-015 now has a matched return scenario: receiving marks incoming moves done while input-to-storage moves remain draft; completion marks storage moves done. That distinction supports explicit receiving/stow custody rather than making received and shelved synonymous. Its framework authorization/crash boundary is still unverified.

Local LOC-020: api/bin-audit.js validates configured bins and creates Mongo generic_records tasks; it does not capture counted quantities. Completion returns 501. db/migrations/001_central_inventory.sql keys balance by tenant/master SKU/location and reservation by that balance plus external line identity. No lot/serial/package dimension exists in those authoritative keys. The location_type enum includes in_transit, but that alone does not implement shipping/receiving custody. R-06 must decide required dimensions and movement protocol before any schema expansion. Do not copy fractional UOM or negative stock behavior into this integer nonnegative ledger without a reviewed policy.

ERPNext UP-007 adds useful adversarial examples: PostgreSQL stock write increases held advisory locks, and a cancellation injected during repost must remain cancelled. The latter is an injected same-process interleaving, not executed two-session proof. Preserve that distinction when specifying local cancellation/late-event tests.
