# OMS Rules replication evidence

## Live recursive discovery

- Launcher route: `displayOMSBS`.
- Branches: Order Validation Rules, Order Routing/Split Rules, Return Routing Rules, Seller Panel Order Rules, Shipping Rules, Allocation Rules.
- Every branch has Show Active Only, Add New Rules, prioritized On/Off rows, and First/Previous/Next/Last paging.
- Validation editor: Self/Third Party, multi-location selection, Create/Allocate events, All Condition, Any Condition, Action. Save: `jsonSaveOrderValidationRule`.
- Routing editor: channel/location selection, order splitting, inventory availability, location-filter criterion, location type/tags, three rule builders. Save: `jsonSaveOrderRoutingRule`.
- Return editor: channel selection and three rule builders. Save: `jsonSaveReturnRoutingRule`.
- Seller Panel editor: inventory availability, vendor/splitting actions, three rule builders. Save: `jsonSaveSellerPanelOrderRule`.
- Shipping editor: Forward/Reverse filtering, applicable locations, client, document type, status and three builders. Save: `jsonSaveShippingRule`.
- Allocation editor: warehouse, client, allocation-strategy action, status and three builders. Save: `jsonSaveAllocRule`.
- Exact validation messages were extracted from each live save handler; Validation includes `Rule Name is mandatory`, Routing includes `Location Filter Criterion is Mandatory.`, Shipping includes `Rule Type is Mandatory.`, and Allocation includes `No Action defined (Allocation strategy)`.

## Local replacement

- UI: `src/eretail/sales/OmsRules.tsx`.
- API: `api/oms-rules.js`.
- Persistence moved out of `generic_records` into the dedicated `oms_rules` collection.
- Each branch now has its observed fields and condition/action builders, persistent create/update, active toggle, priority update and paging.
- Create/update records authenticated `created_by`, `created_date`, `updated_by`, and `updated_date`. The API rejects unknown statuses, nonpositive/noninteger priorities, malformed lists, invalid PATCH types, and stale updates.
- Repository search found no other source file consuming the `oms_rules` collection. Saved Active rules are configuration metadata and do not execute validation, routing, returns, seller-panel, shipping, or allocation behavior.

## Verification

- `npm run typecheck`: passed.
- `npm run build`: passed; existing Node/Vite version and large-bundle warnings remain.
- `npm run test:oms-rules`: passed through the isolated harness using a signed-in generated administrator and generated `codexqa_*` MongoDB/PostgreSQL databases; both were removed after the run.
- The browser suite saved all six branch types against Location/Channel/Client reference rows and verified validation, status toggle, priority update, edit, paging, active-only filtering, actor/date persistence, MongoDB readback, invalid/stale guards, and unchanged Central Inventory events.
- `npm run typecheck`, JavaScript syntax checks, and the full integrated signed-in browser/inventory suite passed with OMS Rules included.
- The older second authenticated live/local comparison passed across the launcher, all branch matrices, status controls, builders, and direct controls `applicableLocations`, `ruleType`, and `warehouseName`. It does not verify that configured rules are executed by order workflows.

## Remaining release gaps

- No order validation/routing/allocation handler consumes these saved rows. Active configuration does not change order outcomes.
- Configured production MongoDB reachability, other-role permissions, multi-operator concurrency and current LIVE parity remain unverified.
- The historical authenticated live/local comparison above does not establish production execution or provider behavior.
