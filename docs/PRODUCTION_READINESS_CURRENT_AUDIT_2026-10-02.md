# Current forensic audit — 2 October 2026

Decision: **NOT READY**. This pass is ongoing; it is not the final release audit.

The 30 September DOCX dossier is the historical baseline. The 30 September current-audit Markdown also contains 1 October follow-ups; those remain earlier evidence, not fresh verification. Existing checkout changes were preserved. No configured business data was written.

## Fresh evidence

| Check | Actual result | Limit |
| --- | --- | --- |
| Dossier extraction | Read executive architecture, workflow boundaries, integration register, R01–R16 and G0–G8; extracted 1,124 OOXML paragraphs for further review. | Detailed per-module review remains ongoing; text extraction is not document render QA. |
| Matrix integrity | CSV has 170 consecutive unique IDs. Historical counts: 89 partial, 38 nonfunctional, 43 unverified. Current counts: 3 PARTIAL, 167 UNVERIFIED. | Structural validation does not establish workflow correctness. No module was promoted in this pass. |
| Configured PostgreSQL | `node scripts/audit-inventory-readonly.mjs` succeeded outside the filesystem/network sandbox using `BEGIN READ ONLY`: 36 central tables; 3,243 SKUs; 636 mappings; 2 accounts; zero locations, balances, events and reservations. | Catalog state only. Physical stock, mapping approval and tenant operational workflows are unproven. Sandbox attempt returned EPERM before the successful outside-sandbox check. |
| Configured MongoDB | `node scripts/audit-mongo-readonly.mjs` failed outside the sandbox with `MongoServerSelectionError`. | This pass did not determine the network/TLS root cause. The sandbox ECONNREFUSED result is not used as outage proof. |
| Order regression | `node scripts/run-isolated-unified-orders.mjs` passed before the new assertion; the added assertion failed on the original logger; the expanded suite passed after repair. Every generated PostgreSQL database was removed by the runner, including the failing run. | Generated local database, fixture providers, simulated lease expiry and fixture credentials. No real provider write, readback, deployment restart or configured-tenant transaction. |
| Readiness regression | `node scripts/verify-connection-readiness.mjs` passed. | Pure fixture classification; no live provider authentication. |

## New reproduced defect: task success falsely verifies provider credentials

Symptom: processing an internal Shopify ingress task changed the account from `not_connected` to `verified`, although `verified_at` remained null and no provider credential probe occurred.

Impact: account-level UI can claim verification from a local business transition. Success could also clear `token_expired`; a mapping or stock failure could replace a valid credential state with `error`. These conflate operation outcome with account authentication. Some readiness consumers additionally require `verified_at`, which limits but does not remove the misleading state.

Root cause: `inventory/sync-attempts.js` assigned `connection_state` for all inbound/outbound sync attempts. Existing worker tests asserted stock and outbox outcomes without asserting credential state.

Repair: the logger records operation attempts and successful sync timestamps but leaves credential state to explicit provider probes. Failed operations still write failed audit rows. No schema, ledger calculation, provider request or configured data migration was changed.

Regression in `scripts/verify-unified-orders.mjs` checks:

- Completed internal ingress leaves `not_connected` and null `verified_at` unchanged.
- Successful internal work preserves `token_expired`.
- A failed mapping operation preserves explicit credential verification while retaining a failed operation audit.
- Existing signed/replayed ingress, cancellation/dispatch races, reservation, return, oversell and lease-redelivery checks still pass.

Residual risk: historical account states may already be misleading; they were not changed. Re-probe provider credentials before relying on them. Other explicit verification writers, feed freshness, publication/readback claims, provider error classification and logging-failure recovery still need independent review. This repair does not certify any provider as operational.

## Release gates

### Follow-up: credential failures interrupted queue recovery

The next adversarial regression reproduced a failure in `safeAccountDiagnostic`: decrypting account credentials with an incorrect encryption key threw inside the worker's catch path. The task could not reach its retry/dead-letter update. Lease reclamation could repeat the same failure indefinitely, bypassing the normal eight-attempt dead-letter outcome.

The repair discards all raw diagnostic fields when account credentials cannot be decrypted and returns a fixed `CREDENTIAL_DIAGNOSTIC_UNAVAILABLE` category. It does not bypass provider authentication or decrypt with an alternative key. Database errors still propagate rather than pretending an audit write succeeded.

The expanded `node scripts/run-isolated-unified-orders.mjs` first failed at the credential-decryption boundary, then passed after repair. In generated PostgreSQL it verified a poison task becomes `retry` at attempt 1, becomes `dead` at attempt 8, and clears its lease both times despite the incorrect key. A diagnostic containing a fixture secret in free text and a nested field is discarded without retaining that secret. Existing lifecycle/race/replay assertions remain part of the same passing suite; generated databases were removed.

Remaining limits: no real credential rotation, production worker kill/restart, configured-provider retry or queue outage was exercised. Logging failure after task acknowledgment and database outage during failure handling remain open.

### Follow-up: worker tenant isolation

The tenant-scoped process ownership lock did not scope the queue claimant. A generated-database test inserted an expired `processing` task under a second tenant. The first tenant's worker claimed it (actual count 1; expected 0). Its normal claimant also had no restriction on foreign pending tasks.

The notification batch had the same boundary problem: claim, stale-send cleanup and expired-alert cleanup operated across tenants while sender credentials were process-scoped. A fixture foreign order/recipient produced a notification call through the first tenant's stub sender (actual claimed 1; expected 0). No real message was sent.

Repairs: `runInventoryTaskBatch` requires `INVENTORY_ALLOWED_TENANT_ID` and scopes both selection and update to that tenant. `runWhatsAppBatch` requires the same scope; notification selection, stale-send cleanup and expired-alert cleanup are tenant-filtered. The claim joins require alert, order and recipient tenant identity to agree.

The expanded `node scripts/run-isolated-unified-orders.mjs` passed after both repairs. It checks foreign expired inventory leases and pending inventory tasks are untouched, foreign notification sends make no upstream call, foreign stale/expired alerts remain unchanged, and missing tenant configuration rejects both batch operations. Existing current-tenant delivery, stock lifecycle, cancellation races, lease recovery and credential-failure tests remain in the passing suite. All generated databases were removed. This is isolated evidence, not certification of deployed tenant isolation.

Root cause: the worker startup and advisory lock encoded tenant ownership, but queue SQL did not carry that ownership across the claim boundary. Prior tests used one tenant, so they could not detect cross-tenant execution. No ledger schema/calculations or configured business records were changed. Historical cross-tenant processing, webhook status ownership, all other worker/API tenant joins, malformed foreign-key relationships, simultaneous workers and deployment sender-account ownership still require review.

### Follow-up: Shopify/Amazon pack units under-reserved stock

Contract evidence: `ci_channel_mapping.pack_size` is a positive integer; publication and Shopify reconciliation divide sellable physical units by this value. WooCommerce order intake already multiplied listing quantity by pack size. Shopify and Amazon order workers selected SKU/location but omitted pack size and posted listing quantity directly as physical quantity.

Fresh reproduction: generated mappings with pack size 3 and orders for two listings produced reservations of 2 units for both Shopify and Amazon. The regression expected 6 each and failed with actual `[2,2]` versus `[6,6]`. This understates reserved stock and Amazon physical dispatch consumption, permitting oversell relative to the approved pack mapping.

Repair: select pack size and convert listing quantity to physical quantity before Shopify and Amazon ledger calls. A shared conversion validator also replaces WooCommerce's unchecked multiplication. It requires positive safe integer listing/pack quantities and a safe integer product. Ledger schema, ledger calculations and provider order quantities were not changed.

`node scripts/run-isolated-unified-orders.mjs` passed after repair, then passed with adversarial overflow and mapping-change checks added. Two two-pack orders reserve 12 physical units total; exact replay adds none; Shopify cancellation releases 6 once; Amazon shipment consumes 6 once; final balance is on-hand 14, reserved 0 from opening 20. Overflow is rejected before ledger mutation. Changing pack size from 3 to 4 before cancellation returns reservation mismatch and preserves the 12-unit reservation; restoring the fixture mapping permits the verified original transition. The full suite retains tenant isolation, cancellation races, retry/dead-letter, signature/replay and oversell assertions. Generated databases were removed.

Why missed: previous provider fixtures used the default pack size 1. Residual risks: historical non-unit-pack reservations/events need reviewed reconciliation, not automatic rewriting. Mapping identity changes, listing quantity changes, multi-pack concurrency, WooCommerce non-unit-pack regression, real provider account/pack agreement and provider readback remain open. No configured mapping or historical stock was changed.

### Follow-up: remapping could mutate an unrelated reservation balance

Fresh reproduction: a Shopify order held six physical units at the original warehouse. A second warehouse held another order's six-unit reservation. After changing the listing mapping to that second warehouse, cancellation succeeded: readback showed the original warehouse still reserved 12 units across the two pack orders, while the second warehouse's reserved balance fell from 6 to 0. The canceled reservation belonged to the original location. Equal quantity alone did not establish stock identity.

Root cause: provider workers resolved the latest channel mapping and passed it to the ledger, while their reservation lookups used order/line identity. They did not compare the reservation's persisted SKU/location to the resolved mapping. Existing ledger release validation checked active status and quantity; the adapter had failed to establish the correct stock identity before calling it. Quantity-only and single-location fixtures missed this.

Repair: the Shopify, Amazon and WooCommerce adapters compare the persisted active reservation's master SKU and location with the resolved mapping before release or consumption. Shopify/Amazon now fetch the complete reservation under a row lock for these transitions. A mismatch throws before the stock call and requires reconciliation. No ledger schema or calculation was changed.

The regression first failed on accepted remapped cancellation and captured wrong-location balance readback. After repair, `node scripts/run-isolated-unified-orders.mjs` passed location-remapping rejection for Shopify cancellation, Amazon shipment, and WooCommerce completion/cancellation. A same-quantity WooCommerce SKU remapping is also rejected, preserving another SKU's six-unit reservation. Restoring fixture mappings permits the original transitions. WooCommerce's non-unit-pack path now has explicit regression evidence: two three-unit listings reserve and consume six physical units; completion replay adds no movement. All generated databases were removed.

During test expansion, one assertion selected an arbitrary balance after adding a second warehouse; it reported on-hand 20 instead of the intended warehouse's 14. The assertion was corrected to include the explicit location. Passing evidence comes from the corrected location-scoped readback, not that failed query.

Residual risks: historical wrong-identity events need reviewed reconciliation; there is no automatic repair. Other callers of the internal ledger, concurrent mapping updates, snapshot SKU/quantity changes, provider custody evidence, multi-pack races and real provider/account readback remain unverified. This narrows the earlier mapping-identity and WooCommerce pack gaps; it does not close G2/G3 or certify all stock writers.

### Follow-up: concurrent exact return replay

The return receipt lookup ran before acquiring the return row lock. Two identical requests both observed no prior receipt; the second later hit PostgreSQL unique violation `23505`, although the first had committed. Fresh generated-database reproduction returned one receipt and one database error. The loser rolled back, so this reproduction did not double stock; the idempotent response contract still failed.

Repair: a transaction-scoped advisory lock keyed by tenant and canonical request UUID precedes the replay lookup. Exact replay now returns the persisted receipt and event IDs. Changed content remains 409. The source-order row lock continues to serialize separate return cases against the same dispatched-stock cap.

The expanded isolated unified-orders suite passed: two concurrent exact requests return the same receipt/event identity with one duplicate, one receipt row and one two-unit stock effect; changed quantity is rejected; two separate return cases racing to return three units each against four remaining dispatched units yield one commit and one 409. Total returned is five physical units against six dispatched, with exact balance readback. All generated databases were removed. No actual parcel/QC/provider refund was observed; role-specific approval, historical mappings and crash/restart evidence remain required.

### Stock writer discovery register

`docs/stock_writer_register_2026-10-02.csv` records 12 current source paths covering count/adjustment, transfer, both inbound handlers, workbook counts, provider order adapters, return receipts, the closed generic event endpoint and the internal ledger boundary. Searches of runtime JS found quantity updates to central balance/reservation tables in the ledger; the adjustment route additionally creates zero balance rows before invoking the ledger. This search does not exclude dynamically assembled SQL or alternate scripts. Mongo-only metadata writers, seeds, migrations, administrative scripts and every caller remain part of the ongoing exhaustive writer audit. Source discovery is not configured runtime verification and does not close G2.

### Follow-up: terminal provider snapshots lost original line identity

`recordIncomingOrder` protected line identity only while a reservation was active. A fresh generated-database update changed a canceled Shopify pack line from `PACK-3` quantity 2 to `TEE-M` quantity 9. This overwrote the source order line after its stock transition and weakened return/report provenance.

The guard now protects lines linked to any persisted reservation state or terminal line state. Provider changes retain the original line and add a `line_change_requires_review` timeline record. The isolated suite passes canceled Shopify, consumed WooCommerce and terminal-canceled WooCommerce-without-reservation cases, asserting both preserved SKU/quantity and the review marker. Existing ledger/return/race checks also pass. New line IDs, removed lines, quantity changes before reservation, same-revision conflicts and historical overwritten snapshots still require review.

### Fresh static source binding for the module matrix

`node scripts/audit-navigation-static.mjs` observed 174 menu entries, 20 without targets, 141 registered routes, zero targeted entries without a matched component and no missing statically detected API references. These are source observations only, not browser or business proof.

`scripts/refresh-production-module-sources.py` adds exact frontend source bindings and timestamped static-only evidence from that audit to the 170-row matrix. It rejects conflicting source bindings and validates the consecutive IDs; it preserves historical status/evidence and every current workflow status. Unresolved/dynamic cases remain unknown. Backend contracts, tenant roles, persistence and LIVE parity still require individual verification.

### Follow-up: concurrent notification callbacks downgraded delivery state

The signed WhatsApp status callback read the alert status without a lock, checked progression in JavaScript, then wrote status and timeline in separate database operations. A generated-database regression held the notification row while committing `read`, confirmed a delayed signed `sent` callback was blocked at the actual PostgreSQL lock boundary, then released the row. The callback overwrote `read` with `sent`; the regression failed with actual `sent`, expected `read`.

Repair: each callback transition now locks the alert row inside a transaction, evaluates progression against that locked row, and commits the status and timeline together. Duplicate equal-status callbacks leave the original observed delivery timestamp unchanged. Existing terminal-state policy is preserved; no Meta contract or delivery outcome is fabricated.

`node scripts/run-isolated-unified-orders.mjs` passed the concurrent downgrade check and duplicate timestamp check. A generated PostgreSQL trigger then rejected `whatsapp_read` timeline insertion. The callback returned failure and the alert remained `accepted`, proving status rollback. After removing the trigger, replay returned 200, set `read`, and wrote one timeline event. Generated databases and injected test objects were removed by the test/runner. The full order/reservation/return/tenant suite also passed.

Root cause: a read-check-write race plus separate status/audit commits. Prior tests delivered callbacks sequentially and did not fail audit persistence. Residual gaps: actual Meta delivery, provider timestamp semantics, sender/tenant callback ownership, durable callback inbox/raw-payload trace, callback database-error classification, concurrent sender acknowledgment versus delivery callback, and production crash recovery remain unverified. This is fixture-signed HTTP and real generated-database evidence, not actual notification delivery.

### Follow-up: worker completion preceded its audit commit

Fresh failure injection installed a generated-database trigger rejecting success sync-audit inserts. The worker first committed outbox `done`, then audit failed. Its catch path recorded a failed attempt but could not change the already-done task to retry. The regression observed `done` instead of required `retry`. This conflated committed business effects with complete queue processing and lost recovery of the success audit.

Repair: success acknowledgment, successful attempt audit and last-sync timestamp now share a PostgreSQL transaction. Retry/dead-letter state, failure attempt audit and intake error marker likewise share a transaction. The attempt-number/status predicate fences stale claimants; audit is only written if that claimant's state update succeeds. Diagnostic/audit helpers accept the caller's database transaction while retaining existing standalone callers. The business transaction and provider request remain separate; this does not claim cross-system atomicity.

The expanded isolated suite passed: rejecting success audit leaves the task retryable; after removing the trigger, replay commits `done` and audit with one original reservation event. A second trigger rejected failure audit at attempt 8. The operation threw and retained `processing` with a reclaimable lease, rather than committing an unaudited dead-letter. After removing the trigger and expiring the fixture lease, redelivery committed `dead` and cleared the lease. Generated triggers/functions/databases were removed. Syntax checks also passed.

Root cause: outbox state updates, audit inserts, account timestamps and intake failure markers used separate commits. Prior crash tests covered business commit before acknowledgment, but did not fail audit storage. Residual limits: simulated lease expiry rather than actual deployment restart; real database outage/reconnect, stale simultaneous workers, provider accepted-response loss, success-audit outage beyond the retry budget and queue/audit operational alerting remain open. Committed stock may coexist with a retry/dead task until bookkeeping recovers; operators must reconcile task outcome with ledger evidence rather than equating task failure with stock rollback.

### Current module/API source dependency register

`python3 scripts/audit-module-source-dependencies.py` recorded all 170 matrix modules in `docs/module_source_dependencies_2026-10-02.json`. For each resolved frontend it records source SHA-256, literal API references with line numbers, dynamic-URL flags, exact legacy handler mounts where determinable, and explicit inspection gaps. It bound exact legacy handler dependencies for 119 modules in the matrix; these fields are labeled `STATIC DEPENDENCIES ONLY`.

Structural validation checked 170 aligned IDs and 595 exact-handler reference occurrences pointing to existing files. Source checks confirmed Inventory Move references `/api/inventory-move`, mounted to `api/inventory-move.js`, and Inbound Create/Edit references its corresponding mounted handler. Central Inventory's nested Express-router references remain unresolved by this scanner rather than being assigned a guessed handler. Shared/imported components, computed endpoints and generic action dispatch still need manual tracing.

Current statuses remain 167 UNVERIFIED and 3 PARTIAL; historical counts remain 89 partial, 38 nonfunctional and 43 unverified. Source path resolution neither promotes module status nor proves action support, role/tenant enforcement, persistence, external dependencies, exports or LIVE parity. No runtime or configured business data was changed in this pass.

### Follow-up: production could initialize ephemeral legacy storage

The data layer enforced persistence only when `DMILLS_REQUIRE_PERSISTENCE` equaled `true`. A production process with no Mongo URI and an omitted/false flag could initialize the in-memory store. The Render blueprint sets the flag correctly, but another production host or a mistaken override could bypass it. The fresh isolated process regression failed because `NODE_ENV=production` initialized memory instead of rejecting missing persistent storage.

Repair: `api/storage-policy.js` defines persistence as required when `NODE_ENV=production` or the explicit flag is true. Data initialization, server startup and readiness checks share that policy. Production cannot disable it with a false flag. Unconfigured development/test still permits isolated memory. README setup guidance now states this contract; no actual environment or credential was changed.

`node scripts/verify-production-storage-policy.mjs` passes fresh child-process tests for production with omitted/false flags, development with enforced persistence, and unconfigured development/test. Production rejects readiness, reads and writes without Mongo; actual `server.js` processes exit with the explicit missing-Mongo error before listening in both production flag cases. Syntax checks for server and data layer pass. This proves the missing-configuration boundary, not configured Atlas recovery, deployed health behavior or all production settings. Existing configured Mongo remains unavailable; G0 stays blocked.

### Follow-up: concurrent first-time migrations raced

The first migration pass verified sequential reapplication preserved fixture catalog data and constraint definitions. An injected incompatible observation table made a migration fail; the original pool remained healthy afterward. That suspected pool-poisoning problem was not reproduced and is not claimed as an existing defect.

A separate fresh-database test started four migration calls concurrently. One succeeded and three failed with PostgreSQL `23505` during schema creation. `IF NOT EXISTS` does not serialize simultaneous first startup. This can block concurrent deploy/start commands even though sequential reruns succeed.

Repair: the migration runner holds one PostgreSQL session advisory lock across the complete ordered sequence and runs each SQL file on that same client. Each file retains its own transaction; schema definitions and ledger rules are unchanged. Failure explicitly rolls back the client; failed rollback/unlock discards the connection. Session loss releases the advisory lock. Earlier successfully applied files may remain committed if a later migration fails; this is resumable per-file application, not all-schema atomicity or migration rollback certification.

`node scripts/run-isolated-migrations.mjs` now passes four concurrent first-time runners, repeat application, two concurrent existing-schema runners, unchanged constraint definitions, preserved catalog data, injected incompatible-schema failure, healthy-pool verification and repair/retry. A verifier-owned connection held the migration lock; the test confirmed a waiter at the PostgreSQL lock boundary, terminated only that generated-database connection, and verified the waiting migration completed with constraints intact. The generated database was removed.

Shared-runner regression: `node scripts/run-isolated-unified-orders.mjs` and `node scripts/run-isolated-central-inventory.mjs` passed and removed their disposable databases. No configured schema/data was migrated. Deployed permission differences, migration checksum/history tracking, actual deploy/process crash during DDL, downtime/lock budgets, backup restoration and rollback procedures remain open; G6 is not closed by these tests.

### Follow-up: QC reports accepted impossible or unknown source quantities

Fresh report/filter regressions first passed the existing recorded-data and unsupported-report checks. An additional fixture with invalid received quantity returned HTTP 200 instead of rejecting inconsistent source records. QC calculations used coercion with zero defaults and clamped accepted quantity, allowing NaN results, rejection beyond receipt or missing data to become operational-looking output.

The QC report now requires explicit finite nonnegative received/rejection quantities, an explicit rejection array and a rejection total no greater than received. Accepted quantity is derived only after these validations. Inconsistent/missing provenance returns 422 without report rows; no historical data is changed or invented.

`node scripts/verify-truthful-reports.mjs` passes six new cases: invalid received quantity, excessive rejection, negative rejection, invalid rejected quantity, missing received quantity and missing rejection metadata. Existing valid QC, invoice/unallocation provenance and 501 inventory-report guards pass. `node scripts/verify-report-filters.mjs` passes warehouse/date bounds, undated exclusion, totals and invalid numeric input. These checks use explicitly empty in-memory fixtures, not configured MongoDB, signed-in browser or Central Inventory QC reconciliation.

Module 152 (Inbound QC Report) is now PARTIAL with this exact isolated API evidence and handler/source dependency. All historical evidence remains unchanged. The current matrix has 4 PARTIAL and 166 UNVERIFIED records; no module is fully verified. Unknown QC metadata remains a reconciliation requirement, and provider/warehouse QC disposition is still fail-closed. The report does not prove recorded Mongo rejection quantities agree with authoritative stock.

### Fresh workbook concurrency, rollback and export evidence

The existing file verifier only guarded the database URL with a `test|contract` substring. A generated-local-database runner (`scripts/run-isolated-inventory-files.mjs`) now creates/removes its own database; the verifier requires a local host and its generated database-name prefix before any migration or fixture write. No configured database was used. This strengthens test safety rather than changing workbook runtime behavior.

`node scripts/run-isolated-inventory-files.mjs` passed the existing catalog/count, replay, stale-preview, duplicate/negative/formula, tenant substitution, alert and export tests. Expanded tests also pass two distinct previews racing against one balance version (one 200, one 409), two simultaneous commits of one batch (one normal result, one duplicate; one event per input row), and a later-row stale conflict after an earlier new-SKU/count row. The last case preserves event count, rolls back the new SKU, and leaves the batch in preview state.

Exports were independently loaded as XLSX, checked for recorded quantities and parsed back through the count parser; the PDF check verifies its `%PDF-` signature. Export requests leave ledger event count unchanged. These are generated-database HTTP checks and structural file checks. PDF visual layout, signed-in browser, configured data, large-file/ZIP decompression abuse, import memory bounds, physical-count approval and actual provider propagation remain unverified. No workbook runtime defect was reproduced in these cases; no business logic was changed. The generated database was removed after both baseline and expanded runs.

| Gate | This pass |
| --- | --- |
| G0 data plane | BLOCKED: configured Mongo unavailable; configured CRUD unverified. |
| G1 provenance | UNVERIFIED: no approval of catalog, mappings or physical locations. |
| G2 stock authority | UNVERIFIED: selected generated-environment regressions pass; complete writer inventory and configured balances absent. |
| G3 orders/fulfillment | UNVERIFIED: generated lifecycle checks only; real custody/provider readback missing. |
| G4 integrations | UNVERIFIED: no fresh real account/scope/webhook/readback evidence. |
| G5 modules | UNVERIFIED: 170-row structure checked; full contracts not re-proven. |
| G6 security/reliability | UNVERIFIED: selected state/race/retry checks; full roles, restore, deployment and incident controls unproven. |
| G7 reference fidelity | UNVERIFIED: no fresh authenticated LIVE comparison. |
| G8 launch | BLOCKED: prerequisite gates remain open. |

Next: finish dossier module review, inventory all consequential writers, investigate configured Mongo connectivity without exposing credentials, and review provider-status/readback and worker failure boundaries. No external business mutation is authorized solely by a regression fixture.

### Session configuration and recovery verification

Reproduced: `authConfigured()` returned true for a fixture administrator with `DMILLS_ADMIN_PASSWORD_HASH=malformed`. `/api/auth/session` and production authentication configuration checks therefore accepted an unusable credential configuration. `api/auth-session.js` now shares a strict two-part salt/hash parser between configuration and credential verification; empty salt, missing hash, malformed digest and extra colon fields fail closed. Existing generated scrypt credentials remain accepted. This does not establish password strength or role authorization.

Fresh isolated evidence: `node scripts/run-isolated-sessions.mjs` passed after sandbox escalation for local PostgreSQL access. The runner creates and removes a generated `codexqa_test_sessions_*` database; verifier refuses other database names/hosts. Tests cover malformed configuration, correct/wrong username and password, Secure/HttpOnly/SameSite cookie attributes, hashed bearer-token persistence, session recovery after module reload, password-hash rotation, username change, expiration, expired-row cleanup, logout revocation and invalid token rejection. Fixture passwords/tokens are generated within the verifier and withheld from output. Database removed successfully. No configured application sessions or credentials were changed.

Limits: module reload is not a deployed process-restart/browser test. Restoring an old credential hash would make its unexpired sessions eligible again under the existing fingerprint design; rotation invalidation is conditional on current configuration, not irreversible bulk revocation. Reverse-proxy Secure-cookie handling, HTTP endpoint coverage, role segregation, CSRF boundaries, real deployment and browser login/logout remain unverified. G6 remains UNVERIFIED and launch remains NOT READY. This pass does not upgrade module classifications.

### Actual HTTP authentication boundary — isolated server evidence

Expanded `scripts/verify-session-recovery.mjs` to launch the actual `server.js` with a fixture port, generated PostgreSQL database, test-mode in-memory legacy store and generated administrator credentials. No configured Mongo access or configured sessions were used. Fresh rerun of `node scripts/run-isolated-sessions.mjs` passed; child server stopped and generated database removed.

The actual mount order denied GET/POST/PUT/DELETE without a session for five paths (`/api/inventory`, `/api/skus`, `/api/reports`, `/api/inventory-sync/accounts`, and a missing fixture API route): 20 HTTP 401 observations. Correct fixture login returned 200, session lookup returned the fixture user, authenticated missing-route access returned 404 after passing authentication, logout returned 200, and reuse of the cookie against inventory returned 401. Wrong-password login returned 401. No additional runtime defect was reproduced in these selected cases.

Scope limits: this pass exercises the real server routing/authentication middleware in isolated test storage, not production persistence or LIVE/browser parity. It does not prove all routes, all public webhook/OAuth exceptions, role separation, CSRF/Origin handling, reverse-proxy trust, rate limiting or deployed session recovery. Generated secrets remained inside the test process/child environment and were not printed or embedded in command arguments. G6 remains UNVERIFIED; module classifications and launch decision unchanged. Next security work is the public integration route exemptions and deployment proxy boundary, alongside the outstanding comprehensive dossier/module/stock-writer review.

### Public OAuth callback precondition integrity

Fresh source trace: `inventoryPublic` is mounted before session authentication and intentionally exposes connection OAuth callbacks/agent endpoints, WhatsApp callbacks, WooCommerce and Shopify webhooks. Public does not imply authorized: each requires its own provider/agent/browser proof. This pass tested the Amazon OAuth rejection boundary through the actual server, not all public routes.

Reproduced in the generated session database: a callback carrying a correct fixture browser cookie but no authorization code returned 400 **and consumed** its unexpired one-time OAuth state. Source also consumed state before checking Amazon seller identity. Fixed `inventory/connections.js`: provider-decline/code presence and length checks precede state consumption; Amazon seller identity is checked inside the locked transaction before `consumed_at` is written. Shopify signature/shop checks remain before consumption. No token exchange/probe/connection activation logic was replaced.

Expanded `scripts/verify-session-recovery.mjs` inserts an encrypted fixture Amazon OAuth intent. It verifies missing browser proof, missing code, and wrong seller each return 400 with `consumed_at` still null. Baseline failed on state consumption; post-fix `node scripts/run-isolated-sessions.mjs` passed these assertions and all earlier HTTP/session checks. Generated database removed; no provider calls occurred because every fixture callback fails before token exchange. `node scripts/verify-connection-authorization.mjs` also passed setup/callback URL checks (fixture-only). Syntax check passed.

Open: valid signed callbacks, concurrent callback single consumption, provider exchange/probe failures after consumption, cookie expiry/cleanup, Tally agent authentication, webhook poison-message retry behavior and real provider permissions remain unverified. Rejected code preconditions now preserve the local authorization intent; an accepted callback is still consumed before external exchange, so an external failure can require restarting OAuth. G4/G6 remain UNVERIFIED and launch remains NOT READY.

### Tally public bridge stale replay integrity

Fresh source review located public `/api/inventory-sync/connections/agent/pair` and `/export`. Pairing consumes a locked, unexpired one-time pairing code and encrypts the issued agent token; export compares hashed bearer-token bytes with timing-safe comparison before XML parsing and database changes. These source observations are not proof of pairing lifecycle or real Tally connectivity.

Reproduced through actual `server.js` in the generated session database: accept encrypted-token fixture exports FIRST then SECOND, replay FIRST, and the connection verification catalog incorrectly returns to FIRST despite duplicate ingress detection. `inventory/tally-bridge.js` now returns from the business transaction on an already-recorded content digest before overwriting verification or enqueueing held vouchers. Exact replay is still acknowledged; it does not replace the latest catalog.

Fresh expanded `node scripts/run-isolated-sessions.mjs` passed: wrong agent token returns 401 and creates no ingress; two distinct exports return 200; old exact replay returns 200 and preserves the entire newer verification object; exactly two held voucher-review tasks persist; zero Central Inventory events occur. Existing session, HTTP and OAuth rejection tests also pass. Fixture bearer tokens/encryption key remain inside the test processes. Child server stopped and generated database removed. Syntax check passed. No real Tally or configured tenant mutation occurred.

Limits: unique exports have no provider revision timestamp, so this fixes known exact replay rollback, not chronological ordering of distinct snapshots. Concurrent different exports, stale shared verification merge, pairing/token rotation races, XML resource-exhaustion bounds, audit failure after business commit, voucher mapping and actual Tally persistence/readback remain unverified. Replaying identical content after a different valid export is intentionally treated as the same delivery under the existing content-digest contract; changing that identity requires an explicit export revision contract. G4/G6 remain UNVERIFIED, no module upgrade, launch remains NOT READY.

### Tally pairing concurrency and rollback — fresh isolated evidence

Expanded actual-server fixture coverage in `scripts/verify-session-recovery.mjs`. Fresh `node scripts/run-isolated-sessions.mjs` passed: two simultaneous public pairing requests using one unexpired fixture code produce exactly one HTTP 200 and one HTTP 400; the issued winner token matches the encrypted account credential; the previous agent token is rejected with HTTP 401; the winner token accepts a subsequent fixture export.

Injected a verifier-owned PostgreSQL trigger that rejects pairing-code consumption **after** the handler attempts account credential rotation. HTTP returned 400; encrypted credential bytes, IV and authentication tag remained exactly unchanged; the pairing code remained unconsumed. Removing the trigger and retrying produced HTTP 200. This establishes transaction rollback across code consumption and credential rotation for the tested failure point. Trigger/function removed, child server stopped and generated database removed. No runtime change was required for these tested cases. Earlier replay, HTTP session and OAuth rejection checks also passed in the same run.

Scope: generated PostgreSQL/account/token fixtures only, no real Tally agent or configured account. This does not prove two distinct simultaneously valid codes, in-flight export versus rotation fencing, expiry boundaries, unauthorized private code issuance, deployment transport or real bridge persistence. Account ownership is structurally tied by the pairing table's composite tenant/account foreign key; adversarial ownership tests remain outstanding. G4/G6 and module classifications remain UNVERIFIED/unchanged; launch remains NOT READY.

### Full objective requirement register and completion gap audit

Created `docs/goal_requirement_register_2026-10-02.json` preserving all 47 numbered sections of the user brief verbatim with exact source line boundaries, attachment SHA-256 and primary dossier SHA-256. Every section remains `UNPROVEN`; evidence lists are intentionally empty until requirement-specific evidence is linked and reviewed. `python3 scripts/verify-goal-requirement-register.py` passed contiguous coverage, exact source text and hash checks. This is source-fidelity evidence only. Subordinate requirement decomposition and linkage to every dossier finding/next-proof item remain required; the register does not replace those duties.

Fresh 170-module CSV structural check confirms all 26 minimum brief-required fields exist. Content completeness is substantially absent: business owner, actor roles, tenant scope, unsupported actions, Central Inventory dependency, external dependency, idempotency requirement, concurrency requirement and audit requirement are UNKNOWN/empty in all 170 rows. Database/tables and release gate are unknown in 166; state machine in 168; risk in 167; test command in 99; backend handler in 47; frontend component in 19. These counts describe unknown fields, not failed business behavior. Historical/current evidence remains separate. Broad module readiness cannot be claimed from populated route/source bindings or selected passing tests.

Priority follow-through: derive module-specific business contracts from observed handlers/persistence and the dossier; link current evidence per requirement; complete consequential writer and ownership review; investigate configured data-plane blockers; then prove complete operational traces, real provider/readback, authenticated reference parity and release gates. Final report A–K, production pilot and the full completion audit remain outstanding. The goal is active and not achieved; launch remains NOT READY.

### Module 001 current business contract reconstruction

Reviewed current Vendor Master wrapper, shared TradingPartnerReplica endpoint selection, actual server aliases/middleware and api/vendors.js storage/actions/audit behavior. Added docs/module-contracts/001-vendor-master.md and populated source-grounded module 001 matrix fields for handler, database/collection, actor boundary, tenant scope, source state behavior, blocked actions, direct dependencies, concurrency/idempotency/audit gaps, risk and gates. Business owner remains UNKNOWN. Current status remains UNVERIFIED, historical evidence unchanged, and source-review language distinguishes observed implementation from runtime proof. Refreshed requirement-register unknown-field counts after this row update; 170 rows preserved.

Consequential findings requiring reproduction: legacy vendor queries have no tenant predicate; only the global configured-admin session boundary is observed, with no role-specific handler checks; status transitions and remaining field writes are unrestricted; duplicate-code protection is a read-before-write precheck; audit arrays can lose concurrent updates. No rules were invented to repair these based solely on source inspection. Existing vendor test scripts were located, not rerun. Next work: adversarial current API/database tests, downstream PO/GRN reference readback, configured persistence and LIVE parity, then remaining module contracts. This source pass is not a module readiness upgrade or release-gate pass.

### Vendor identity injection and duplicate-create reproduction

Fresh isolated memory test `node scripts/verify-vendor-boundaries.mjs` reproduced client-controlled numeric vendor identity: POST of a second code with the first vendor's id returned 201 and persisted the same id. Shared storage constructs `{id,...doc}`, so passing a caller id overrides allocated identity and later numeric-id updates can target multiple vendors. Fixed api/vendors.js to remove client id/_id from create fields and _id from update fields; storage retains identity ownership. Baseline identity assertion failed; post-fix test passed distinct allocated identity, server-owned audit, immutable vendor code on rename, and blocked deletion. No shared storage identity behavior or other handlers were changed.

The same test freshly reproduced concurrent duplicate-code creation: both requests returned 201 and two RACE records persisted. This remains an OPEN DEFECT in the memory layer; configured Mongo race behavior has not been tested. Read-before-write uniqueness cannot establish an atomic contract. Do not add an unverified unique index over historical configured data or claim the race fixed by serial fixture tests. Next required work is storage-specific uniqueness, historical collision assessment and database-backed concurrency/rollback proof.

Evidence boundaries: explicitly empty MONGODB_URI, test mode, in-memory data only; no configured database mutation, HTTP authorization or LIVE/browser parity claim. Module 001 remains UNVERIFIED. Production remains NOT READY.

### Vendor duplicate-create write boundary repair

Addressed the previous turn's reproduced in-memory duplicate-code race with `insertVendor` in api/mongo.js, called by api/vendors.js. Memory mode performs code check and allocation/write without an intervening await. Mongo mode requires a named unique vendor_code index before insertion; index establishment failure returns an explicit sanitized 503 without inserting. Duplicate insertion returns 409. This preserves existing case-sensitive exact-code semantics. No historical records are merged/deleted or codes rewritten. General insert and other collections remain unchanged.

Fresh `node scripts/verify-vendor-boundaries.mjs` passed: pair race returns one 201/one 409 with one row; 20 concurrent same-code creates return one 201/19 conflicts with one row. Identity injection/audit/code/deletion checks remain green. Node syntax check passed. Evidence is isolated memory only. Mongo unique-index establishment, historical missing/duplicate codes, incompatible indexes, multi-process races and permission failures are not runtime verified; no configured database was accessed or mutated. The Mongo implementation is not a configured-persistence success claim. A vendor create against a configured database will attempt the unique index and fail closed if it cannot be established. Existing generic writers that bypass insertVendor still require review.

Concurrent update/audit retention, tenant/role ownership, status graph, configured PO/GRN readback and LIVE fidelity remain open. Module 001 remains UNVERIFIED, launch NOT READY. The historical duplicate-create reproduction remains retained above.

### Vendor concurrent audit retention repair

Fresh memory reproduction: ten simultaneous successful vendor updates should append ten audit entries but retained only one (history length 3 rather than expected 12). Root cause: handler copied a stale audit array then used generic $set/update. Added vendor-specific updateVendorWithAudit in api/mongo.js and switched api/vendors.js to supply a server-owned single audit entry. Memory field mutation/history append occurs without yielding; Mongo uses one findOneAndUpdate with $set and $push. Caller audit/id/_id fields are removed. Nonarray historical audit data fails closed with 409 rather than silently overwriting history.

Fresh `node scripts/verify-vendor-boundaries.mjs` passed: ten successful saves retain all ten entries; malformed fixture history rejects and preserves both existing name and corrupt history for repair; identity injection, code immutability, deletion guard and duplicate-create races remain green. Syntax check passed. Only isolated memory executed; Mongo atomic-update behavior and historical audit shapes remain runtime unverified. No configured records were modified. Other generic storage users remain unchanged.

Residual risks: concurrent edits still use last-writer-wins fields; status-change classification is derived from a pre-update snapshot, not a validated transition graph. This repair proves audit-event retention in tested memory saves, not complete conflict/authorization/business history semantics. Tenant/role/status constraints, configured persistence, all module actions and LIVE fidelity remain open. Module 001 UNVERIFIED; production NOT READY.

### Vendor omitted-field stale overwrite repair

Fresh isolated memory reproduction: run a vendor rename and city-only PUT concurrently. Both returned 200, city persisted, but the city-only handler restored the pre-read Original vendor name over the newer rename. Root cause: validation used current name as fallback, then unconditionally wrote that stale fallback. api/vendors.js now includes normalized vendor_name in the write only when a non-null name is supplied; omitted/null retains prior no-rename semantics without reapplying a stale snapshot.

Fresh `node scripts/verify-vendor-boundaries.mjs` passed rename+city race with both changes and all three audit entries retained, explicit blank-name 400, null-name preservation, and all previous identity/duplicate/audit/deletion cases. Syntax check passed. No configured storage was accessed. Mongo runtime and actual browser payload conflicts remain unverified. Two writes explicitly changing the same name still use last-writer-wins; this repair addresses omitted-field overwrite, not a versioned-edit contract. Status transition classification and authorization remain open. Module 001 UNVERIFIED; production NOT READY.

### Vendor disposable MongoDB verification

Added scripts/run-isolated-vendor-mongo.mjs and scripts/verify-vendor-mongo.mjs. Runner starts a local mongod bound to loopback on a random port with a newly generated temporary data directory and generated codexqa_vendor_* database, runs the vendor boundary suite, then stops that owned process and removes only its generated directory. Verifier rejects non-loopback/non-generated targets. Initial sandbox startup failed; escalated run passed. No configured Mongo URI/database was used or modified.

Fresh executable Mongo evidence: pair and twenty-request duplicate-create races persist one vendor; identity injection prevented; ten concurrent updates retain ten audit events; malformed audit history rejects without field changes; concurrent rename/city changes both persist; blank/null-name semantics pass. Independent MongoClient readback confirms the vendors_code_unique index is unique. In the disposable database only, removed that index and injected two historical same-code rows: a different new vendor create returned 503, inserted zero rows, and preserved both historical duplicate rows. This verifies fail-closed behavior rather than automatic historical reconciliation. Owned process/data cleanup passed.

Earlier shared-suite console labels incorrectly said memory during this Mongo run; runner/client connection and independent assertions establish actual Mongo mode, and labels were corrected to reflect mode for subsequent runs. No broader claim relies on those old labels. Configured Mongo outage, authenticated browser/LIVE behavior, multi-process races, permission-specific index failures, generic bypass writers, tenant/role/status requirements and complete module workflow remain unverified. Module 001 remains UNVERIFIED; launch NOT READY.

### Vendor downstream history evidence and matrix status

Fresh expanded disposable Mongo rerun passed vendor boundary suite and new historical-document readback. Inserted fixture issued PO/GRN records through the actual store, renamed the linked vendor through api/vendors.js while supplying a forged code, then read all records using a separate MongoClient. Vendor name changed; issued PO/GRN names remained Issued Supplier and their vendor code remained DISJOINT. Owned Mongo process/data removed. This proves no historical-name rewrite by this tested rename path; it does not prove every procurement workflow.

Updated module 001 current status to PARTIAL with exact tested isolated actions, command, evidence layer and outstanding gaps. Historical status/evidence untouched. All 170 matrix rows retained; requirement-register unknown counts refreshed. Contract opening now distinguishes current partial evidence from chronological historical reviews. This is the first fresh Vendor Master status update in this audit, not a broad module or configured-parity claim. G0/G5/G6/G7 remain open and launch NOT READY.

### Customer Master contract and identity boundary

Reviewed api/customers.js and actual server aliases; added docs/module-contracts/002-customer-master.md. Source shows unscoped legacy partners storage, customer-group dependency, contact/GSTIN prechecks, generated code assignment in a second write, snapshot-based updates, server creation/modification actors and blocked deletion. Tenant/role rules and atomic lifecycle are not established.

Fresh scripts/verify-customer-boundaries.mjs baseline failed: POST with another customer's id reused its numeric identity and generated code. Handler now strips create id/_id and update _id. Post-fix isolated memory test passes distinct identities/codes, original record preservation, server actor and deletion guard. General partners storage and other writers unchanged. No configured Mongo/browser/LIVE proof, no full module readiness upgrade. Remaining atomicity/concurrency/group/history/ownership proof recorded in contract; goal active, production NOT READY.

### Customer complete-record creation boundary

Replaced customer handler's insert-then-code-update with insertCustomer: storage allocates numeric id, derives existing CUS padded code format, and inserts id/code/customer_code in one document write. Server fields and prior validation remain intact. General partners insert/update and existing records unchanged. Sequence allocation precedes insertion; failed writes may consume sequence values but cannot persist a customer awaiting code assignment. No contiguity guarantee was introduced.

Added owned disposable Mongo runner/verifier. Baseline with a fixture collection validator requiring string code fields failed the initial customer insertion (500), demonstrating the previous first-write record was incomplete. Post-fix run passed that validator on initial insert; separately injected name validation rejection returned 500 and independent Mongo readback found no extra/partial row. Ten concurrent distinct customer creations returned 201 with distinct matching code/customer_code values. Owned process/directory removed. Memory identity regression and syntax check also passed. Expected fixture validation failure is logged by the handler, not a configured failure. No configured datastore accessed or changed.

Scope limits: fixture Mongo validator is test-only and was not installed in application environments. This establishes complete-record insertion, not contact uniqueness, whole-snapshot update conflict handling, process-crash tests or configured persistence. Generated code format and sequence gaps remain existing semantics. Customer module remains UNVERIFIED pending fuller action/permission/history/browser/LIVE proof; production NOT READY.

### Customer primary-contact duplicate lookup correction

Fresh memory regression reproduced sequential duplicate primary contact accepted (201 rather than 409). api/customers.js clean maps primary_contact into contact, but creation checked phone (the shipping phone) and update duplicate checks also used phone. Corrected both checks to contact, preserving existing exact-match semantics and Phone label. No broader uniqueness/normalization policy invented.

Memory tests pass repeated-primary-contact rejection on POST and PUT with different shipping phones. Fresh disposable Mongo rerun passes the same cases; independent client confirms the primary contact persisted in contact. Complete-record insert, failure-with-no-partial-row and distinct-code concurrency checks remain green. Owned process/data removed. No configured records accessed or repaired. Existing duplicates are not reconciled; read-before-write contact uniqueness still races, and historical records that populated only phone require assessment rather than assumed mapping. Tenant/role ownership and full module workflow remain unverified; launch NOT READY.

### Customer contract matrix and Transporter identity follow-through

Populated module 002 source-grounded matrix contract fields and linked exact fresh memory/disposable Mongo evidence without upgrading full-module status. Historical fields preserved; 170 rows and requirement unknown counts retained/refreshed. Customer owner remains unspecified; runtime ownership/browser/reference gates remain open.

Reviewed api/transporters.js and recorded docs/module-contracts/003-transporter-master.md. Fresh memory test reproduced duplicate numeric id through create body, then passed after transporters handler strips create id/_id and update _id. Original record and blocked deletion verified. No global partners behavior changed. Remaining transporter uniqueness/update/status/history/tenant rules require proof; module remains UNVERIFIED. Generic/shared partner bypasses remain a review target. Production NOT READY.

### Transporter update duplicate-name consistency

Fresh isolated memory test reproduced PUT renaming transporter Second to existing First returning 200, despite create-time duplicate-name rejection. Added the corresponding exact-name, Transporter-type, excluding-current-id precheck to api/transporters.js PUT. Post-fix test returns 409 and preserves Second; identity/deletion regression remains green. This extends an existing rule, not a new uniqueness policy. Read-before-write checks still race; Mongo atomic uniqueness, historical duplicates, ownership and full workflow remain unverified. No configured records changed; production NOT READY.

### Client Master identity and creation-metadata integrity

Reviewed api/clients.js/server aliases and added docs/module-contracts/004-client-master.md. Fresh scripts/verify-client-boundaries.mjs reproduced create accepting another row's numeric id; after fixing identity stripping, separately reproduced PUT overwriting created_by with FORGED. Handler now strips create id/_id and update _id, preserves stored created_by/created_date and retains server-owned modification actor/date. Post-fix memory suite passes identity allocation, creation metadata preservation, modification actor and deletion guard; syntax check passed.

No configured datastore mutation or tenant rule invented. Client master rows remain unscoped partners metadata and are not proven to enforce tenancy elsewhere. Client-id renames, duplicate races, snapshot conflicts, document ownership and browser/reference behavior remain open. Module UNVERIFIED; launch NOT READY.

### Customer Group alternate-writer deletion bypass

Fresh source review of dedicated group API showed deletion always blocked with 409, including referenced groups. Executable memory test reproduced generic API DELETE returning 200 and removing an assigned customer-group record. Root cause: generic protected-module register omitted customer-group. Added fail-closed 501 for group writes and checked extra.module too, preventing conversion into protected modules via nested update payloads. Stored module lookup already prevents disguising an existing protected row with a different requested module.

Fresh scripts/verify-customer-group-bypass.mjs passes dedicated delete rejection, generic delete/update/create rejection, nested module-conversion rejection and preserved group/other record. Syntax check passed. No configured storage changed. Added docs/module-contracts/005-customer-group.md with membership/compensation source observations and remaining cross-writer/crash/ownership proof. No membership algorithm or new business policy invented. Generic handler protection applies to all existing blocked modules when supplied through extra.module; full regression across those modules remains required. G5/G6 open, production NOT READY.

### Generic protected-module regression breadth

Added scripts/verify-generic-protected-modules.mjs and owned disposable Mongo runner scripts/run-isolated-generic-mongo.mjs. Both memory and Mongo runs passed 32 mutation cases across the handler's eight protected module patterns: customer-group, vouchers, other-masters-*, sales-promotion, sku-group, sku-company-link, org-hierarchy and location. Each checks POST direct protected module, PUT/DELETE of existing protected row with disguised requested module, and PUT converting an open row through extra.module. All return 501, preserve protected record name and open record module. Ordinary open-fixture create/edit/delete still returns expected successful responses.

Mongo fixture requires loopback and generated codexqa_generic_* database; owned process and temp data directory removed. No configured storage or external systems accessed. These checks validate guard coverage, not dedicated workflow functionality, actor permissions, every payload representation or cross-endpoint writer coverage. Generic protected reads remain allowed by existing design; read authorization requires separate review. No runtime change needed beyond the prior guard fix. G5/G6 remain open; production NOT READY.

### Shared partners alternate-writer master bypass

Fresh memory regression reproduced /api/partners DELETE removing a Customer record with 200 although dedicated Customer Master blocks deletion. Source establishes the same shared endpoint could mutate Customer/Transporter/Client records without their identity, field/history/group checks. Added fail-closed 501 for shared POST/PUT/DELETE when requested type/partner_type or stored type/partner_type identifies any of those three dedicated masters. Existing protected records cannot be disguised as another type; open records cannot be converted into a protected type. PUT/DELETE require a single positive safe numeric id and normalize it before lookup/mutation; arrays are rejected 400 rather than bypassing a single-record guard while generic storage updates many.

Fresh scripts/verify-partner-master-bypass.mjs passes shared create/edit/delete and type/partner_type conversion rejection for all three master types, preservation of stored names, and array-id rejection. Source /src/pages/Partners.tsx uses this shared API; users editing these protected types there now receive explicit dedicated-API failure. No unsupported master logic was reimplemented in that page. Generic reads and unprotected types remain unchanged; their authorization/identity semantics are not established. No configured persistence or Mongo/browser/LIVE evidence in this pass. Dedicated API regressions must remain separate from this guard proof. G5/G6 open; production NOT READY.

### Shared partner guard MongoDB and compatibility verification

Expanded scripts/verify-partner-master-bypass.mjs with generated-database/loopback Mongo safety guards, legacy partner_type-only Client protection, case/whitespace protected-type rejection, string numeric identity normalization and unprotected fixture CRUD/readback. Added owned runner scripts/run-isolated-partner-mongo.mjs. Fresh memory and disposable Mongo executions both passed protected create/update/delete, type/partner_type conversions, array-id rejection, legacy classification and preservation of records. Ordinary fixture POST/PUT/DELETE remained successful; string ids updated/deleted the intended numeric record.

Disposable Mongo process and data directory removed; no configured URI/database used. No further runtime edit required. Guard proof is handler/database-level, not authenticated browser or complete business workflow proof. Stored-type lookup and mutation are separate operations: other writers changing classifications concurrently still require an atomic ownership/race audit. Reads, unprotected partner types and alternative bulk/import writers remain review targets. G5/G6 open; launch NOT READY.

### Order attachment action could delete unrelated master records

Alternate-writer trace found api/order-maintenance.js attachment-delete blindly removed generic_records by supplied numeric ids. Corrected fixture response mock (initial run lacked setHeader), then replayed the pre-fix handler behavior against the test: Customer Group id returned 200 rather than required ownership rejection. Restored fixed handler and regression passed. This was an actual cross-module deletion path, independent of the generic API protections.

Handler now validates positive safe ids, deduplicates, checks all selected rows belong to module order_attachment and current order before any deletion, returns 403 for unrelated/mixed selections and 400 for malformed ids. Shared remove accepts an optional expected predicate; this action deletes with module/order predicate at storage too, so a changed row cannot be deleted solely by numeric id. Existing remove callers retain default behavior.

Fresh node scripts/verify-order-attachment-ownership.mjs passes unrelated master/other-order/mixed selection preservation, malformed-id rejection and valid own attachment deletion in isolated memory. No configured Mongo/browser or role/tenant proof. Multi-delete is not transactional: crash/failure may partially delete valid owned attachments, and response deletion counts still require review. Broader generic writer inventory remains incomplete. Production NOT READY.

### Order payment action payload could create protected master records

Fresh scripts/verify-order-payment-identity.mjs reproduced payment action creating a customer-group generic record: request module overrode handler order_payment because body spread followed module/order fields. Request order_no also replaced the actual selected order, and _id was accepted. This bypassed generic/dedicated master write guards through an unrelated action.

Order maintenance payment branch now removes request id/_id/module/order_no/action before inserting and writes server-owned module/order after remaining fields. Fresh memory regression confirms module order_payment, selected order identity, allocated id, omitted _id and unchanged ordinary fixture amount; attachment ownership regression also remains green. No financial calculation/posting rule inferred. This action's amounts, payment authorization, settlement/provider proof, audit and posting legitimacy remain unverified and must not be represented as real payment completion. Mongo/configured/browser/role/tenant proof remains open. Production NOT READY.

Alternate-writer discovery artifact: docs/legacy_master_writer_candidates_2026-10-02.json contains 140 literal API call candidates for partners/generic_records/vendors with file/line/operation/hash. This is a review queue, not an exhaustive writer inventory: dynamic collection arguments, dedicated wrapper calls without collection literals, scripts and direct database access are excluded. Candidate status stays unreviewed unless exact evidence is linked in this audit. The two order-action reproductions demonstrate why endpoint-local guards alone cannot establish master integrity.

### Order-action MongoDB ownership follow-through

Added owned disposable Mongo runner/verifier scripts/run-isolated-order-actions-mongo.mjs and scripts/verify-order-actions-mongo.mjs. Shared memory suites now support explicitly guarded Mongo fixtures (loopback and generated codexqa_orderaction_* database). Fresh Mongo run passed unrelated-module/order/mixed attachment preservation, invalid-id rejection, valid own deletion and payment module/order/storage identity tests. A separate MongoClient changed an attachment's order ownership before calling the actual storage remove with its old module/order predicate; readback confirmed the changed row survived. Independent client also confirmed payment module/order identity.

Owned process/temp directory removed. Memory reruns passed; no configured data or real financial action used. Ownership-change test proves the predicate at storage, not a full concurrent HTTP scheduler/failure trace. Multi-delete partial failures, response deletion counts, role/tenant permissions, financial audit/posting and production/browser parity remain open. Launch NOT READY; no module/gate upgrade.

### Attachment deletion acknowledgment truth

Fresh deterministic memory handler test changes attachment ownership after initial record read via a verifier-only request getter scheduling the actual store update. Prior handler returned 200 despite scoped deletion preserving the row. Scoped remove now returns deletedCount from Mongo deleteOne or memory removal; default unscoped callers keep their existing response shape. Handler totals actual removals, returns 409 with deletedCount/requestedCount for an incomplete selection, and includes counts on successful deletion.

Post-fix memory test confirms ownership-change returns 409/zero deletions and row survives. Disposable Mongo rerun confirms actual zero deletedCount after independent-client ownership change, preserved row, and earlier order-action regressions remain green. The deterministic getter scheduling test is memory-only; it is not represented as a Mongo HTTP race. Owned test process/data removed; no configured mutation. Batch deletion remains nontransactional: response now exposes partial completion but does not roll back earlier valid deletions or prove crash recovery. Tenant/role and financial workflow gates remain open; production NOT READY.

### Tax Category referenced-code generic bypass

Reviewed dedicated api/tax-categories.js and added docs/module-contracts/006-tax-category.md. Memory regression established dedicated PUT rejects renaming a category used by a SKU (409), while generic PUT previously accepted the same mutation (200). Generic handler now protects tax-category writes with explicit dedicated-API 501. Regression confirms unchanged HSN and blocked generic delete; 36-case expanded protected-module memory suite passes. This preserves existing reference rules rather than inventing tax behavior.

No configured records changed. Dedicated reference checks remain read-before-write; simultaneous reference creation/rename, other writers, Tax Application cases, tenant/role/audit scope and financial correctness require separate proof. Production NOT READY.

Fresh disposable Mongo expanded generic suite also passed all 36 protected mutation paths, including Tax Category, with ordinary fixture CRUD preserved. Owned process/data removed. This is generic guard Mongo evidence; the dedicated SKU-reference reproduction remains memory-only in this pass.

### Tax Code numeric coercion integrity

Reviewed actual api/taxcodes.js and Tax Group source relationship, added docs/module-contracts/007-tax-code.md. Fresh memory test reproduced false percentage accepted with 201 via Number(false)=0. Validator now requires number/string and nonblank percentage before finite/range checks. Post-fix scripts/verify-tax-code-values.mjs rejects false/true/arrays/object/whitespace and persists explicit zero/string-zero/decimal/100; syntax passed. Shared validator covers both create/update, but this runtime test exercises create only.

This is input-shape correctness, not tax law/rate/rounding/compounding correctness. Tax Group display sums component percentages; applicability/effective-date/financial consumers still require domain proof. Mongo/configured, roles/audit, duplicate races and update payload boundaries remain open. Production NOT READY.

### Tax Code update identity consistency

Fresh memory regression reproduced PUT with string numeric id returning 200 but leaving rate unchanged: handler resolved current via Number(id), then generic update matched the original string id. Fixed update to use resolved current.id, reject array/non-positive/non-safe identities, and remove caller _id before writing. Regression now confirms string identity persists 7.5 rate, _id is not stored, and false percentage update rejects 400. Create numeric-shape tests remain green. No configured persistence or full rate-change business proof. Mongo update/crash/concurrency and issued-document rate effects remain open; production NOT READY.

### Tax Code Mongo evidence and Tax Group alternate-writer guard

Fresh node scripts/run-isolated-tax-mongo.mjs passed malformed percentage rejection, explicit numeric boundaries, string-id rate update, discarded caller _id and false-rate update rejection in owned disposable Mongo. Process/data removed. One create-suite log still said memory; actual asserted Mongo mode and update log identify evidence layer, and label was corrected afterward. Configured tax-rate/financial correctness unverified.

Source Tax Group replacement is multi-document delete/insert with compensation, not a transaction. Fresh memory scripts/verify-tax-group-bypass.mjs reproduced generic metadata delete (200) despite dedicated delete 409, leaving component mapping orphaned. Generic tax-group mutation guard now returns 501; group/component preservation regression passes. Expanded protected generic memory suite passes 40 cases; latest Tax Group addition is not yet rerun in Mongo. Added docs/module-contracts/008-tax-group.md documenting compensation/crash/concurrency/financial proof gaps. No business calculation or mapping rewrite invented; production NOT READY.

### OPEN DEFECT: concurrent Tax Group replacement merges incompatible requests

Fresh adversarial scripts/verify-tax-group-concurrency.mjs creates a one-component group and simultaneously replaces it with [code A] and [code B]. Memory result: both HTTP-style handler responses 200, final mappings [A,B], coherence assertion FAIL. Fresh node scripts/run-isolated-tax-group-concurrency.mjs reproduces in owned disposable Mongo: responses [200,200], mappings [B,A], coherence assertion FAIL. Runner exits nonzero and removes owned process/data. These are deliberate failing regression results, not passing checks. No configured records changed.

Root cause: each replaceMappings reads previous rows, deletes them and independently inserts its requested components; interleaving both insertion sequences yields a mixed tax group. Application compensation cannot make this sequence serializable and may itself overwrite another request. This can produce incorrect displayed/consumed component rates. Generic guard fixes do not repair this dedicated workflow.

Repair remains REQUIRED: enforce atomic metadata+component replacement or a durable revision/ownership protocol across processes, with crash/failure proof and truthful conflicts. A process-only mutex or memory-only fix would not establish the Mongo invariant. Evaluate deployment Mongo transaction capability and authoritative consumers before selecting storage changes. Tax Group remains not safe for concurrent changes, module/gates unverified, launch NOT READY. Failing regression retained for repair; no completion claim.

### Tax Group repair consumer and transaction boundary trace

Fresh source searches identify the dedicated API as tax_group_codes consumer/writer, TaxGroup.tsx as joined components consumer, Tax Application metadata references in api/taxapp.js, and existing workflow tests directly reading mappings. api/mongo.js has no Mongo session/transaction propagation; separate legacy CRUD cannot inherit PostgreSQL ledger transactions. Recorded concrete repair constraints/evidence gates in docs/TAX_GROUP_ATOMIC_REPLACEMENT_DESIGN_2026-10-02.md: preserve existing mapping/response contracts, implement datastore-owned transactional replacement where supported, fail closed before mutation on unsupported deployment, remove compensation from transaction retries, and prove process/failure/race behavior. Configured Mongo transaction capability unknown. This establishes the next repair boundary, not a fixed workflow. Existing failing concurrency regression remains required; production NOT READY.

### Tax Group atomic-save implementation in progress

Implemented datastore-owned saveTaxGroup preserving metadata/mapping schema. Memory validation/write completes without yielding. Mongo capability checks reject standalone with 503 before mutation; supported deployments use one snapshot/majority transaction, shared transaction-owned revision write for cross-process serialization, fresh group/code validation and transactional sequence/mapping/metadata writes. Driver retries re-read state. Dedicated API uses this boundary instead of compensation-based replacement. Initial missing import was corrected before successful verification.

Fresh memory concurrent replacement regression now passes with one coherent final component set. Disposable runner upgraded to an owned single-node replica set for Mongo transaction evidence. Configured Mongo unchanged. Further failure injection, standalone no-write proof, separate-process/crash tests and downstream regressions remain required before declaring repair complete. Earlier failing evidence retained; launch NOT READY.

Replica fixture first startup timed out because the bootstrap client awaited a primary before initiating the replica set; owned cleanup succeeded. Corrected bootstrap to directConnection. Fresh rerun passed Mongo concurrency invariant: both requests 200, final single requested component [B], no merged set. Owned replica process/data removed. This is single-process concurrent API/Mongo evidence, not separate-process/crash/failure coverage. Transactional repair remains under verification; production NOT READY.

### Tax Group transaction failure and unsupported storage verification

Fresh replica fixture injects a mapping collection validator rejecting a chosen new component after metadata write and old mapping deletion inside the transaction. Update returns 500; independent Mongo readback confirms exact old metadata, mapping rows and counters preserved. Failed create leaves no group and counters unchanged. Removing fixture validator permits recovery. Concurrent replacement still coherent. Owned process/data removed.

Fresh standalone verifier initially exposed handler mapping the intended 503 to 500. Corrected handler to preserve known 400/404/409/503 business/storage errors; post-fix standalone rerun returns 503 with zero group/mapping/counter changes. Memory tests confirm missing group 404 and invalid referenced code 400. Expected injected errors remain logged, not concealed.

Commands: node scripts/run-isolated-tax-group-concurrency.mjs; node scripts/run-isolated-tax-group-standalone.mjs; node scripts/verify-tax-group-concurrency.mjs. Configured Mongo unchanged. Separate-process/crash/commit-ambiguity and downstream workflow/authorization checks still outstanding. Transaction repair under verification; launch NOT READY.

### Tax Group cross-process isolation and creation uniqueness

Added guarded fixture child scripts/tax-group-save-fixture-child.mjs; two independent Node processes initialize real storage and call the dedicated handler on a parent start signal. Fresh replica-set runner passes simultaneous replacement with coherent final metadata/name and its matching single component. Separate-process same-code/name creation produces one 201 and one 409, with one group and one mapping independently read back. Earlier in-process race, injected transaction rollback/counter preservation, recovery and business error cases remain passing in the same run. All child processes exited and owned Mongo process/data removed.

This proves transaction serialization beyond a process-local lock for tested fixture saves. It is not process-termination-during-transaction, ambiguous commit, load/throughput, separate reader snapshot, or configured-deployment proof. Shared revision serializes Tax Group writes globally, a correctness choice with contention/performance still unmeasured. Alternate writers and taxonomy/reference ownership remain open. No configured record mutation; launch NOT READY.

### Tax Group joined-read snapshot boundary

Replaced listGroups' three independent reads with datastore-owned readTaxGroupSnapshot. Mongo joins metadata/mappings/code rows within one snapshot transaction; memory captures a synchronous deep-cloned snapshot. Unsupported standalone reads fail explicitly 503 rather than claiming a coherent financial view. No rate/compounding rules changed. Source-defined read race risk repaired; deterministic inter-query race reproduction remains required before claiming complete reader proof. Concurrent/rollback suite rerun verifies compatibility with existing tested save paths; configured storage unchanged. Further process-crash, commit ambiguity, reader race and downstream workflow gates remain open; production NOT READY.

### Deterministic Tax Group reader/write interleaving

Fresh replica test pauses the actual metadata cursor toArray after reading within readTaxGroupSnapshot's session, commits a complete replacement through the dedicated handler, then resumes mapping reads. Snapshot retained the old metadata name and its old component; independent MongoClient saw new metadata/component. Verifier temporarily intercepts Collection.find only for the first matching transaction metadata cursor and restores it in finally; no production hook introduced. This proves the tested inter-query snapshot boundary, not HTTP/browser timing or every reader. Cross-process writes, duplicate creation and rollback/recovery regressions remain passing; owned replica/data removed.

Expanded standalone test also checks actual GET returns 503 for unavailable snapshot capability, alongside POST no-write rejection. This intentionally exposes unsupported storage rather than serving potentially mixed tax metadata. Configured capability remains unverified. Process-crash, ambiguous commit, downstream Tax Application/financial behavior and permissions remain open; production NOT READY.


### Continued adversarial worker recovery: diagnostic authority removed

Evidence class: ISOLATED_REGRESSION / GENERATED_LOCAL only. New user instructions in attachment 43cfe050 require durable failure state before best-effort diagnostics. This entry supersedes the earlier interpretation that failure-audit availability should gate DLQ; historical evidence above is preserved.

Finding/reproduction: safeAccountDiagnostic caught credential-decryption failure only. Its credential lookup and recursive redaction could still throw before the worker failure transaction. An injected query error, throwing diagnostic getter and cyclic diagnostic reproduced escaping exceptions in that implementation. Root cause: the diagnostic boundary was incomplete. Fix in inventory/sync-attempts.js catches lookup/redaction failures and discards unsafe input, returning constant DIAGNOSTIC_UNAVAILABLE evidence. scripts/verify-diagnostic-failure-boundary.mjs passes those cases and preserves ordinary token redaction. No exception details or raw diagnostic are returned on fallback.

Second finding: the existing generated trigger rejecting failed ci_sync_attempt inserts proved failure audit could roll back retry/DLQ. Before: attempt 8 remained processing with a reclaimable lease; reclaim could execute attempt 9. Affected boundary: inventory/workers.js runInventoryTaskBatch failure transaction. Fix: commit fenced outbox state and intake failure marker first, then attempt the diagnostic audit independently. Audit failure cannot reverse that durable state. Operator-visible last_error remains on the outbox. The failure audit can be absent during outage; no independent audit-recovery guarantee is claimed.

Fresh regression: node scripts/run-isolated-unified-orders.mjs passed after correction of an obsolete test-only lease mutation on an already-dead task. It now actually executes every attempt 1 through 8 rather than jumping the stored counter from 1 to 7, verifies attempts 2–8 backoff against min(3600, 2**attempts * 5), verifies retry through 7, dead at 8, cleared leases and no ordinary ninth claim. With the generated failure-audit trigger enabled, attempt 8 still commits dead and retains last_error; removing the trigger does not cause a ninth execution. Existing signed/replayed ingress, reservation/cancel/dispatch races, tenant fencing, provider-state separation, oversell, pack quantities and return replay checks also passed. All generated databases and trigger fixtures were removed.

Rule source: eight attempts is hard-coded in inventory/workers.js, not independently established as an external business contract. Remaining limitations: actual process kills at each crash boundary, failures of the core database transaction, permanent/transient classification, supported operator replay authorization, reclaimed processing tasks at the attempt ceiling, diagnostics that hang rather than throw, and complete repository-wide failure-pattern audit remain unverified. Success acknowledgement still depends on success audit availability; failure-state logging no longer does. Configured Mongo connectivity, configured operational PostgreSQL data and REAL_PROVIDER evidence were not changed or reclassified. Production remains NOT READY.


### Exhausted inventory task lease admitted a ninth business execution

Finding and fresh reproduction: an outbox task with status processing, attempts 8 and an expired lease was claimed again by runInventoryTaskBatch. The expanded isolated regression failed with claimed count 1 instead of 0. Root cause: the claim predicate did not constrain attempts; dead status prevented ordinary retries but not recovery of an unacknowledged final attempt. Affected boundary: inventory/workers.js claim transaction, including pending/retry exhaustion as well as expired processing leases.

Fix: inside the claim transaction, tenant-scoped exhausted due tasks are locked with SKIP LOCKED and terminalized without execution or counter increment. The normal claim explicitly requires attempts < 8. Existing last_error is preserved; otherwise the durable error states that the business outcome requires reconciliation. This does not infer that a crashed business effect rolled back or that an external provider failed. Live processing leases remain untouched. Cleanup is bounded by batch limit and runs again on subsequent polls.

Regression: scripts/verify-unified-orders.mjs tests expired processing and due retry at attempts 8, requiring dead, attempts 8, lease NULL and an explicit reconciliation message; neither is executed. It also proves a live attempt-8 lease remains processing and an expired attempt-7 lease can claim attempt 8. node scripts/run-isolated-unified-orders.mjs passed with the existing lifecycle/inventory suite, and its generated database was removed. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL. No configured data or real provider was changed.

Remaining limitations: final-attempt recovery is an ambiguous outcome requiring operator reconciliation, not proof of no business effect. An actual process kill and late provider acknowledgement/readback remain untested. Cross-process exhausted-task races and operator replay authorization remain open. Eight remains an implementation rule without an independently verified business specification. Next source-backed risk: Shopify order observations and scheduled seller observations still await logSyncAttempt inside their business try/catch, so audit failure can misclassify a successful external observation or abort processing subsequent accounts. That risk is not yet reproduced or repaired. Production remains NOT READY; full goal remains incomplete.


### Observation diagnostic outage aborted multi-account recovery

Finding/reproduction: a generated PostgreSQL trigger rejecting ci_sync_attempt inserts for scheduled_provider_observation caused observeSellerConnections to throw while handling the first missing-credential account. A second account was never processed. Root cause: logSyncAttempt was awaited in the recovery catch without an independent failure boundary. The same pattern existed in pollShopifyOrderObservations; successful observations also awaited logging within their business try, so audit exceptions entered the business failure catch.

Fix: inventory/sync-attempts.js provides tryLogSyncAttempt, explicitly best-effort and intended only after authoritative persistence. inventory/connection-observation.js and inventory/shopify-orders.js use it for observational diagnostics. Core database writes remain awaited and authoritative. A logging failure no longer changes success/failure classification or prevents the next account from being processed. Business audit paths requiring atomicity retain logSyncAttempt.

Regression: the expanded scripts/verify-unified-orders.mjs uses two credential-less seller accounts and two credential-less Shopify accounts in a separate generated tenant. While every observation audit insert is rejected, both seller failures are recorded, both Shopify retry cursors persist with failure_count 1 and future retry_after, and all four account failure states persist. Before repair the suite threw fixture observation audit unavailable; after repair it passes.

Success-path adversary: scripts/verify-observation-success-audit.mjs runs in a child using scripts/fixture-observation-provider-loader.mjs. The loader substitutes only probeConnection and shopifyClient in that child and refuses non-loopback or non-codexqa_test databases; production code has no new mock switch. The fixture uses real encrypted disposable credentials, transactions, account/cursor persistence and a real generated database trigger that rejects diagnostic inserts. Two seller probe doubles and two empty Shopify order-page doubles complete, retain fixture success state and leave Shopify cursors successful without retry/error misclassification. This is GENERATED_LOCAL control-flow evidence, not credential, scope, provider, propagation or readback evidence. The fixture's verified strings are test data only and do not verify any configured integration.

Fresh node scripts/run-isolated-unified-orders.mjs and node scripts/verify-diagnostic-failure-boundary.mjs passed. The wrapper removed its generated database, including all fixture account/cursor/trigger data. Historical findings are preserved above. Evidence classes: ISOLATED_REGRESSION and GENERATED_LOCAL only. Configured environments unchanged; production remains NOT READY.

Remaining limits: diagnostic hangs can still delay iteration; core database failure during cursor/account persistence, atomicity between cursor/account writes, real successful provider observation, credential rotation/scopes and reconciliation remain unverified. Another remaining failure boundary is caller-side error formatting (for example String(error.message) before safeAccountDiagnostic); malformed thrown values/getters can fail before the safe diagnostic helper is entered. Full repository-wide diagnostic/recovery sweep remains open.


### Malformed thrown values bypassed the diagnostic safety boundary

Finding/reproduction: runInventoryTaskBatch formatted String(error.message) before entering safeAccountDiagnostic. A verifier-only query rejection with null reproduced TypeError reading message at inventory/workers.js:258, aborting before durable retry persistence. Throwing message getters and custom message conversion hooks represented equivalent paths. Root cause: caller-side formatting remained outside the repaired helper.

Fix: inventory/sync-attempts.js adds safeAccountFailure. Message and providerStatus reads are individually guarded, non-string messages are discarded without invoking conversion hooks, and provider status is read once and accepted only as an integer HTTP status from 100 through 599. It delegates credential-aware redaction to safeAccountDiagnostic. The inventory worker failure path, Shopify readback failure formatting, Shopify order-observation failure path and scheduled seller-observation failure path use this boundary. Normal Error messages and numeric provider statuses are retained safely; malformed values produce a constant withheld diagnostic.

Fresh regression: scripts/verify-unified-orders.mjs temporarily substitutes one exact mapping query in its own disposable fixture to reject with null, a throwing message getter or a message object with a throwing toString. Each now completes the worker failure transition as retry, attempts 1, lease NULL, nonempty last_error. The query method is restored in finally. No production injection hook was added. The complete isolated suite passed and its generated PostgreSQL database was removed. scripts/verify-diagnostic-failure-boundary.mjs additionally passed null/undefined/getter/conversion/status-getter cases and preserved ordinary error plus 401 status. Evidence classes: ISOLATED_REGRESSION / GENERATED_LOCAL only.

Before: malformed exceptions could leave the worker in processing until lease reclamation. After: tested malformed exceptions reach durable retry with safe diagnostics. Remaining limitations: diagnostics that never return, actual process-kill recovery, database unavailability at core persistence, and complete repository-wide use of the new failure boundary remain open. No configured Mongo/PostgreSQL or REAL_PROVIDER state was changed; production remains NOT READY. This is concrete progress, not completion of the full forensic goal.


### Reconciliation diagnostic failure aborted the stock readback batch

Finding/reproduction: a disposable PostgreSQL trigger rejecting shopify_readback diagnostic inserts caused reconcileShopifyStock to throw from its catch-path audit, instead of returning its safe readback errors. Fresh pre-fix run failed with fixture reconciliation audit unavailable. The success path also awaited audit within the business try after committing stock observation and, for mismatch, a publish task. Root cause: non-authoritative diagnostics were coupled to reconciliation control flow.

Fix: inventory/workers.js reconcileShopifyStock now uses tryLogSyncAttempt for readback diagnostic success and failure. The stock-observation and mismatch outbox transaction is unchanged and remains authoritative. A diagnostic outage no longer aborts subsequent mappings or reports diagnostic failure as provider/business failure.

Regression: scripts/verify-unified-orders.mjs exercises real credential-unavailable readback failures with rejecting diagnostic storage; the batch returns safe errors. The disposable child success fixture now substitutes ShopifyConnector.readQuantity only in its guarded loader. Two mappings share one fixture physical balance of 5: provider double reports 5 for one mapping and 2 for the other. With diagnostic inserts rejected, summary remains checked 2, mismatched 1, unavailable 0, errors empty. Persisted targets are 5 for both; matching mapping is confirmed, mismatching mapping is pending, and exactly one publish_stock task is persisted. Independent before/after database comparison proves physical balance rows unchanged. These provider observations and confirmed strings are GENERATED_LOCAL fixture data, not REAL_PROVIDER readback evidence. No configured provider is reclassified.

Fresh node scripts/run-isolated-unified-orders.mjs passed the complete expanded suite. Child fixture and generated PostgreSQL database were removed. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL only. Remaining limitations: actual network/readback outage, process kill at reconciliation commit/ack boundaries, simultaneous reconcilers, duplicate queued publications across repeated mismatch scans, diagnostic hangs, and operator reconciliation remain unverified. Configured data planes unchanged; production remains NOT READY. The full forensic goal remains incomplete.


### Committed Tally export returned false rejection when diagnostics failed

Finding/reproduction: an isolated PostgreSQL trigger rejecting tally_export ci_sync_attempt inserts made the authenticated export endpoint return HTTP 400 after its receipt/catalog/held-voucher transaction committed. Fresh pre-fix regression failed with actual 400 versus required 200. Root cause: diagnostic insertion was awaited outside the business transaction but remained inside the endpoint's rejection catch. Affected boundary: inventory/tally-bridge.js POST /export.

Fix: the post-commit diagnostic uses tryLogSyncAttempt. Authentication, parsing, business transaction failures and held voucher mapping requirements retain their existing behavior; accepting a source export does not imply voucher posting or physical inventory movement.

Regression: scripts/verify-session-recovery.mjs installs a generated rejecting diagnostic trigger, sends the first authenticated export and exact replay, requires HTTP 200 for both and independently verifies one held voucher. Existing newer-export/older-replay preservation, wrong token 401, total two held exports and zero physical inventory events remain asserted. node scripts/run-isolated-sessions.mjs passed, including pairing rotation/concurrency, transaction rollback, OAuth precondition and session/auth checks. Generated trigger removed, fixture server stopped and disposable database removed. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL, not real Tally deployment or configured provider verification.

Before: durable accepted source data accompanied by a false rejection response. After: tested diagnostic outage cannot change committed export acceptance; replay remains deduplicated. Remaining limitations: diagnostic hangs, actual bridge/network interruption, crash at commit/response boundary, real Tally permissions, voucher/item/godown mapping and provider-verification semantics remain unverified. Equivalent post-commit diagnostic calls in Meesho report ingestion and catalog/webhook setup remain candidates requiring fresh tests. Configured environments unchanged; production remains NOT READY. Full forensic goal remains incomplete.


### Meesho import threw after committed order observation

Finding/reproduction: rejecting meesho_order_report diagnostic inserts in a generated PostgreSQL fixture caused importMeeshoOrders to throw after its report receipt/order transaction committed. Root cause: non-authoritative diagnostic insertion remained inside the caller-visible success boundary after commit. Affected source: inventory/meesho-orders.js post-transaction logSyncAttempt.

Fix: use tryLogSyncAttempt after successful nonduplicate import. Parsing, SKU validation, transaction rollback and duplicate receipt behavior remain authoritative. This accepts a report observation, not real provider authentication or stock reservation.

Regression: scripts/verify-unified-orders.mjs installs a rejecting diagnostic trigger and imports a one-line disposable CSV. Before repair the run threw fixture report diagnostic unavailable. After repair it returns duplicate false, orders 1, lines 1; exact replay returns duplicate true, orders 0, lines 0. Independent database assertions confirm one order and unchanged inventory-event count. node scripts/run-isolated-unified-orders.mjs passed; generated trigger and database were removed. Evidence class: ISOLATED_REGRESSION / GENERATED_LOCAL only.

Remaining limitations: real Meesho report provenance, configured account permissions, actual process/network interruption, post-commit response loss and diagnostic hangs remain unverified. Catalog/webhook setup and other post-commit diagnostics still require investigation. Configured environments unchanged; production remains NOT READY. Full forensic goal remains incomplete.


### Webhook setup diagnostics threw after persisted registration settings

Finding/reproduction: the guarded disposable provider-double fixture acknowledged five Shopify webhook subscriptions, persisted webhooksReady/target/IDs, then a rejecting webhooks_registered diagnostic trigger made provisionWebhooks throw. Fresh pre-fix run failed at inventory/connection-setup.js post-persistence logSyncAttempt. Root cause: optional diagnostics remained part of caller-visible business completion.

Fix: only the post-persistence webhook diagnostic uses tryLogSyncAttempt. Provider registration and settings persistence errors remain authoritative. Catalog diagnostic behavior is unchanged pending its own reproduction.

Regression: scripts/verify-observation-success-audit.mjs now calls provisionWebhooks using a provider double restricted by its loader to an owned disposable loopback database. With diagnostic insertion rejected it requires registered 5 and independently reads webhooksReady true plus five saved IDs. node scripts/run-isolated-unified-orders.mjs passed, and the generated database/trigger data were removed. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION only. Provider-double acknowledgements and fixture readiness flags do not establish real subscription validity or webhook delivery.

Before: committed setup accompanied by a thrown diagnostic failure. After: diagnostic outage cannot suppress the tested setup result. Remaining limitations: real provider registration/readback/delivery, partial registration failure, crash between external acknowledgement and local settings persistence, retries and diagnostic hangs remain unverified. Automatic catalog discovery still has a post-commit diagnostic candidate. Configured environment evidence unchanged; production remains NOT READY; full forensic goal incomplete.


### Catalog discovery diagnostics suppressed committed staging result

Finding/reproduction: the disposable provider-double fixture staged one catalog mapping and deactivated the account/mappings, then its rejecting catalog_mapping diagnostic trigger caused discoverConnectionCatalog to throw. Fresh pre-fix run failed at inventory/connection-setup.js post-transaction logSyncAttempt. Root cause: optional diagnostics remained part of business completion after staging committed.

Fix: post-commit catalog diagnostics use tryLogSyncAttempt. The mapping transaction, inactive status and approval requirements remain authoritative. No automatic activation or physical stock mutation was introduced.

Regression: scripts/verify-observation-success-audit.mjs provides one tracked catalog variant through its guarded loader, maps one disposable provider location and rejects catalog diagnostic inserts. It requires staged 1, unmatched/skipped 0, no duplicates; independent reads confirm inactive account, one discovered mapping ID, expected listing identity, active false and approved_at NULL. Physical inventory balance rows remain exactly unchanged. node scripts/run-isolated-unified-orders.mjs passed and its generated database was removed. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION only; no real catalog/provider verification.

Remaining limitations: real provider catalog pagination/disappearance, simultaneous discovery/activation, crash at commit/response boundary, diagnostic hangs and configured provider evidence remain unverified. Configured data planes unchanged; production remains NOT READY. Full forensic scope remains incomplete.


### Credential retest diagnostic outage prevented authoritative failure-state update

Finding/reproduction: verifyAndSave logged the failed provider probe before updating an existing account after an explicit retest. A generated trigger rejecting credential_retest diagnostic inserts caused a fixture 401 retest to throw before token_expired persistence, preserving the earlier verified state. Fresh pre-fix isolated run failed with fixture retest diagnostic unavailable. Root cause: optional audit storage preceded the authoritative account failure transition. Affected source: inventory/connections.js verifyAndSave catch path.

Fix: persist the existing-account explicit-retest failure state first, then use tryLogSyncAttempt for failed-probe diagnostics. Invalid proposed credential rotation still does not replace existing credentials or change state under the existing contract. Success-probe diagnostics and malformed probe diagnostic formatting remain separate open boundaries.

Regression: scripts/verify-unified-orders.mjs installs disposable encrypted Shopify credentials and initial verified state, returns 401 through a fetch double, and rejects failure diagnostics with a real generated trigger. After repair verifyAndSave returns ok false and independent database read confirms token_expired. Expanded isolated suite passed and its generated database was removed. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION only, no REAL_PROVIDER credential verification.

Remaining limitations: real credential expiration, malformed provider error payload/redaction, success diagnostic outage, actual process/network interruption, and authoritative failure of account-state persistence remain unverified. Configured account state was not changed. Production remains NOT READY; full forensic goal incomplete.


### Successful credential probe reported diagnostic failure after persistence

Finding/reproduction: the expanded credential fixture first verifies 401 failure-state persistence, then supplies a successful Shopify identity/scope/catalog/location response double while rejecting connect_test diagnostics. The pre-fix run threw from verifyAndSave after saving the account verification. Root cause: success diagnostic insertion was inside the caller-visible completion path after authoritative persistence.

Fix: inventory/connections.js uses tryLogSyncAttempt for this post-persistence success diagnostic. Provider probe validation and account persistence remain authoritative; no internal event now grants verification through the diagnostic logger.

Regression: scripts/verify-unified-orders.mjs requires successful result and independently persisted fixture verified state despite diagnostic outage, alongside the token_expired failure case. node scripts/run-isolated-unified-orders.mjs passed; generated database removed. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION only. The response double's fixture verified state does not verify configured credentials, external account authorization or real provider readback.

Remaining limitations: malformed provider diagnostics/redaction, real provider scopes/identity, process crashes, diagnostic hangs and core persistence outage remain open. Configured environments unchanged; production remains NOT READY. Full forensic goal remains incomplete.


### Malformed provider exceptions prevented explicit credential failure persistence

Finding/reproduction: verifyAndSave directly read error.message/providerStatus/diagnostic and recursively redacted them before persisting the failure. The disposable retest fixture rejecting with null reproduced TypeError at that formatting boundary. Throwing message getters and cyclic diagnostic payloads represent equivalent failures. Root cause: unsafe error extraction and redaction remained authoritative for credential failure recording.

Fix: inventory/connections.js obtains guarded safeAccountFailure details, then attempts additional redaction against proposed credential fields inside a separate catch. Unsafe provider payloads are discarded with a constant withheld diagnostic, preserving independently extracted numeric provider status. Account failure state now derives from that safe status. This does not accept failed rotation credentials.

Regression: scripts/verify-unified-orders.mjs resets fixture verified state and retests with null, throwing message getter and cyclic payload with status 401 while diagnostic storage is also unavailable. All return ok false and independently persist error or token_expired as appropriate. The expanded isolated suite passed; generated database removed. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION only.

Remaining limitations: actual provider malformed responses, diagnostic hangs/size bounds, new-account versus proposed-rotation exhaustive cases, HTTP wrapper error formatting and core persistence outages remain open. Configured state unchanged; production remains NOT READY. Full forensic goal incomplete.


### Authoritative retry/DLQ persistence rejection: last durable state verified

Fresh adversary: scripts/verify-unified-orders.mjs creates disposable unsupported tasks starting at attempts 0 and 7, then installs a real generated PostgreSQL trigger rejecting their retry/dead transitions. The worker propagates the authoritative write failure; independent readback proves the last durable state is processing, attempts 1 or 8, a live lease and NULL last_error. A second batch cannot double-claim that live lease. This is not a successful recorded business failure: operators must observe processing/lease state and the propagated worker exception.

After removing the fault and simulating lease expiry, the first task claims attempt 2 and persists retry; the exhausted task persists dead with reconciliation evidence without executing attempt 9. Both clear leases and retain nonempty failure evidence. Independent before/after comparison proves physical inventory balances unchanged for these unsupported fixture tasks. Existing lease, inventory lifecycle, duplicate/replay, provider-state and diagnostic-outage regressions also passed. No runtime change was needed for these tested cases.

Command: node scripts/run-isolated-unified-orders.mjs. Result: PASS; generated triggers removed and disposable PostgreSQL database removed. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL only. A trigger rejection demonstrates transaction failure/rollback; it does not demonstrate a disconnected server, process kill, connection-loss-at-commit ambiguity or deployment restart. Those remain open, as do committed business effects followed by actual database outage and operator alerting. Configured environments unchanged; production remains NOT READY. Full forensic scope remains incomplete.


### Actual worker process kill after durable claim

Fresh process-crash evidence: scripts/fixture-worker-claim-crash.mjs runs the real runInventoryTaskBatch in a separate verifier-owned process. It refuses non-loopback/non-codexqa_test databases and requires IPC. A test-only pool-query interception pauses at the exact fixture mapping lookup after the real claim transaction committed, before business processing. No production pause/injection hook was introduced.

scripts/verify-unified-orders.mjs tests prior attempts 0 and 7. The parent receives the checkpoint, independently verifies processing/attempt 1 or 8/live lease, sends SIGKILL only to its child and confirms that exit signal. Another worker cannot claim the still-live lease. After test-controlled expiry, attempt 1 recovers at attempt 2 and records retry; attempt 8 terminalizes dead without attempt 9. Both clear leases. Physical inventory balance rows compare exactly unchanged. Child exit is awaited and finally cleanup handles failures.

node scripts/run-isolated-unified-orders.mjs passed the full expanded suite and removed the generated database. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL, actual child process kill with simulated lease expiry. No runtime repair was needed for this tested claim/crash boundary. This does not prove crashes after physical ledger commit, provider acknowledgement, retry commit or DLQ persistence; provider-response loss, database disconnect-at-commit ambiguity, deployment restart and operator reconciliation remain open. Configured environments unchanged; production remains NOT READY. Full forensic goal incomplete.


### Actual worker kill after physical reservation commit, before queue acknowledgement

The owned child crash fixture now supports a stock-commit checkpoint: its test-only transaction-client wrapper pauses immediately before the worker done acknowledgement query. Real reservation processing has already committed. The parent independently verifies reserved_order 2, kills only its child with SIGKILL and confirms the exit. Outbox remains processing. After simulated lease expiry, a new batch processes the original task and commits done; independent event count remains exactly one reserve for STOCK-COMMIT-CRASH, with on_hand 5 and reserved_order 2. No duplicate stock reservation occurs in this tested crash/replay boundary.

The expanded scripts/verify-unified-orders.mjs uses a separately generated SKU/opening/mapping and signed ingress. The initial broad run exposed fixture publication tasks competing with later fault-test tasks; those exact fixture mapping publication tasks are now held after the crash proof, preserving them without external dispatch. The corrected complete node scripts/run-isolated-unified-orders.mjs passed and removed all generated data. No production runtime change was needed for this test.

Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL, actual process kill with controlled lease expiry. Crash checkpoint scaffolding exists only in the guarded disposable child. Real-provider acknowledgement loss, crashes after dispatch/release/return/transfer, actual deployment restart and connection-loss-at-commit ambiguity remain open. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### Actual worker kill after cancellation release commit

The signed-ingress crash fixture now cancels STOCK-COMMIT-CRASH after its verified two-unit reservation. A separate real worker process reaches the guarded test-only post-business/pre-ack checkpoint. Independent database read confirms reserved_order 0 before SIGKILL. The parent confirms child exit, verifies outbox processing, expires only that fixture lease and runs recovery. Outbox becomes done; exactly one cancel inventory event exists for the order, and on_hand remains 5/reserved_order 0. Recovery does not release twice or produce negative reserved stock.

node scripts/run-isolated-unified-orders.mjs passed with both reservation and cancellation actual process-kill cases plus the prior suite. Fixture publication tasks for this SKU are held to prevent unrelated provider work during later tests; all disposable data was removed by the runner. No runtime change was required for the tested boundary. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL, actual SIGKILL and controlled lease expiry. External cancellation authenticity/delivery, crash after dispatch/return/transfer, deployment restart and provider acknowledgement-loss remain unverified. Configured environments unchanged; production remains NOT READY. Full forensic goal remains incomplete.


### Actual worker kill after dispatch consumption commit

The disposable signed WooCommerce ingress fixture reserves two STOCK-CRASH units from on_hand 5, then accepts a newer completed order revision. A separate real worker reaches the guarded post-business/pre-ack checkpoint after dispatch consumption commits. Independent read confirms reserved_order 0 before the parent sends SIGKILL and verifies child exit. The outbox remains processing. After controlled fixture lease expiry, recovery commits done; exactly one dispatch event exists for DISPATCH-COMMIT-CRASH, with final on_hand 3/reserved_order 0. Replay does not consume twice.

node scripts/run-isolated-unified-orders.mjs passed with reservation, cancellation and dispatch actual worker kill cases and previous regressions. Publication tasks for the fixture SKU remain held during this proof to avoid unrelated external effects; the runner removes all generated data. No runtime change was required for this tested boundary. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL, actual SIGKILL with simulated lease expiry. The generated completed order status is source input, not proof of real shipment or provider fulfilment. Return/transfer crash boundaries, real provider acknowledgement loss and database disconnect-at-commit ambiguity remain open. Configured environments unchanged; production remains NOT READY. Full forensic goal incomplete.


### Actual process kill after return receipt/restock commit

A guarded disposable child invokes real approveReturnReceipt for two previously dispatched fixture units, signals only after the function transaction completes, and waits for parent SIGKILL. Independent pre-kill read confirms on_hand 5. Parent confirms the signal, then retries the identical receipt through the real service. Replay returns duplicate true; database readback proves exactly one receipt and one return_qc_approved event for RETURN-COMMIT-CRASH. Final balance is on_hand 5/reserved_order 0. This verified replay does not double-restock.

Artifacts: scripts/fixture-return-commit-crash.mjs and expanded scripts/verify-unified-orders.mjs. Child refuses non-loopback/non-codexqa_test databases and requires IPC. Fixture publication tasks remain held, child exit is awaited and all generated data is removed. node scripts/run-isolated-unified-orders.mjs passed. No runtime change required for the tested service boundary.

Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL, actual process kill after service commit; this is not a killed HTTP response path or proof of actual goods receipt/QC. Crashes inside receipt transaction, changed replay after process death, provider/network evidence, transfer crash boundaries and deployment recovery remain open. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### Actual process kill before return receipt transaction commit

The guarded return child now optionally pauses immediately before its real transaction-client COMMIT, after service writes have run. Parent reaches that IPC checkpoint, independently observes the previously committed on_hand 3, kills only its child with SIGKILL and confirms exit. Independent database readback then shows zero receipts for the request, zero return_qc_approved events for RETURN-COMMIT-CRASH and on_hand 3/reserved_order 0. Uncommitted restock does not escape the transaction.

The same receipt subsequently runs through the existing post-commit process-kill case, commits two returned units once, and replays as duplicate with exactly one receipt/event and final on_hand 5. Thus the expanded fixture exercises both sides of commit rather than treating claim expiry as proof of rollback. node scripts/run-isolated-unified-orders.mjs passed and removed all generated data. No runtime change was required for these tested cases.

Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL, actual SIGKILL before COMMIT and after service return. The pause exists only in the guarded disposable child. Connection loss while COMMIT is in flight, HTTP response loss, production restore/restart, real QC evidence and transfer failure boundaries remain unverified. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### WMS location move: destination failure rolls back both transfer legs

Current source distinguishes transferCentralWmsStock immediate physical location moves from legacy STO custody workflows. The former resolves exact tenant/SKU/physical locations and writes wms_transfer_out/in in one transaction; legacy api/transfers.js mutations remain 501 pending authoritative reservation/dispatch/in-transit/destination receipt lifecycle.

Fresh failure proof: scripts/verify-unified-orders.mjs rejects the destination wms_transfer_in event in a real generated PostgreSQL trigger after the source leg has executed. The service throws; independent readback finds neither event, source on_hand unchanged at 5 and no destination balance row. Removing the fault permits retry with duplicate false; exact replay returns duplicate true. Final source/destination balances are 3 and 2, total 5, with exactly two event legs. No runtime change needed for the tested transaction. Fixture publication work remains held.

node scripts/run-isolated-unified-orders.mjs passed; trigger and disposable database removed. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL only. This proves rollback/retry/conservation for the tested immediate WMS move, not STO in-transit custody, physical goods movement, actual transfer process crash, replenishment completion or configured readiness. Those remain unverified. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### WMS physical stock quantities accepted boolean/array coercion

Finding/reproduction: transferCentralWmsStock and adjustCentralWmsStock used Number(input.quantity), accepting true as 1 and single-element numeric arrays as quantities. Fresh isolated regression failed because a true transfer succeeded instead of rejecting. api/inventory-ops.js also coerced quantities before calling services, concealing malformed source shapes. Root cause: type coercion occurred before numeric-domain validation at both API and authoritative service boundaries.

Fix: inventory/wms-operations.js accepts only number/string quantities with nonblank strings before existing safe-integer/sign validation. API moves reject other source shapes; API adjustments forward the original quantity to the authoritative validator. Existing numeric inputs and numeric strings remain supported. No stock arithmetic or ledger schema was changed.

Regression: scripts/verify-unified-orders.mjs requires boolean, single-element array and object quantities to return status-400 rejection for both transfer and adjustment. The existing destination-failure rollback, exact transfer replay/conservation and process-crash inventory suite passed with unchanged expected balances. node scripts/run-isolated-unified-orders.mjs passed and generated database was removed. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL service behavior; full HTTP/browser API verification remains open.

Before: malformed quantity could cause physical movement. After: tested malformed shapes reject before service transaction. Remaining limitations: full API/client coercion sweep, configured WMS workflow, financial/unit conventions and exhaustive quantity inputs remain unverified. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### WMS malformed quantity HTTP proof and unsupported-method guard

Fresh actual HTTP fixture scripts/verify-wms-api-input-boundary.mjs explicitly disables PostgreSQL and selects empty Mongo memory mode before imports. A temporary loopback Express server invokes the real inventory-ops handler. POST/PUT across moves, scan, intercompany and adjustments with boolean/array/object/null/blank quantities produce 56 HTTP 400 responses rather than datastore-unavailable errors, proving rejection precedes location/ledger access in these cases.

Additional defect: DELETE/PATCH entered stock mutation handling because the handler only distinguished GET from all other methods. Pre-fix HTTP regression returned 400 from quantity processing instead of 405. api/inventory-ops.js now permits GET/POST/PUT after the existing CORS preflight and returns 405 with Allow for other methods. The HTTP verifier passed both unsupported-method cases after repair. An initial fixture cleanup typo was corrected to closeDataStore; temporary server/store closed successfully.

Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL actual HTTP boundary, not full authenticated configured workflow or ledger mutation proof. Prior isolated ledger suite supplies separate quantity-service evidence. Configured persistence was not touched. Remaining limitations: full server route/auth policy, valid HTTP mutation path and browser/configured WMS proof remain unverified. Production remains NOT READY; full forensic goal incomplete.


### Actual WMS transfer process kill before commit

The guarded scripts/fixture-transfer-commit-crash.mjs invokes real transferCentralWmsStock and pauses its transaction client before COMMIT. The verifier kills only that child with SIGKILL and confirms exit. Independent reads show neither transfer event and unchanged source/destination on_hand 3/2. Retrying the identical one-unit request commits both legs once; exact replay is duplicate, event count exactly two, balances 2/3 with total 5 conserved.

node scripts/run-isolated-unified-orders.mjs passed the expanded suite; generated database and child processes cleaned up. No runtime change needed for this tested boundary. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL actual process kill before COMMIT. This does not prove STO in-transit lifecycle, real physical transport, COMMIT-in-flight connection loss or transfer response-loss recovery. Those remain open. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### Actual WMS transfer process kill after commit

The guarded transfer child now also executes a fresh one-unit move and signals only after the real service transaction returns. Parent kills that owned process with SIGKILL and confirms exit. Exact service retry returns duplicate true, independent readback finds exactly two event legs for the request, and source/destination balances remain 1/4, total 5. Recovery does not move stock a second time.

node scripts/run-isolated-unified-orders.mjs passed with both pre-commit rollback and post-commit replay process-kill cases plus previous inventory regressions. Generated database/children removed; no runtime change required for the tested boundary. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL actual SIGKILL. This is service-level response-loss recovery, not physical transport or a killed authenticated HTTP request. COMMIT-in-flight ambiguity, deployment/database restart, STO custody and external provider recovery remain unverified. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### Stalled credential diagnostics still preceded durable worker failure state

Finding/reproduction: despite earlier exception handling, runInventoryTaskBatch awaited safeAccountFailure (credential lookup/redaction) before the core failure transaction. A verifier-owned gate paused that exact lookup. Independent database read found processing rather than retry, reproducing non-authoritative diagnostic latency blocking durable failure recording. Root cause: exception safety did not establish persistence ordering.

Fix: inventory/workers.js first commits retry/dead, cleared lease, safe constant last_error and intake failure marker. Only then does credential-aware diagnostic extraction run. Best-effort enrichment is fenced by tenant/task/attempt and retry/dead status, and updates intake details transactionally when applicable; failure cannot undo the already-durable operational state. Failure diagnostic audit remains optional. Null task payload access in the failure-order extraction is also guarded.

Regression: scripts/verify-unified-orders.mjs pauses only one diagnostic lookup in its disposable task and independently requires retry, attempts 1, lease NULL and nonempty last_error before releasing the diagnostic gate. Before repair it failed with processing; after repair the complete node scripts/run-isolated-unified-orders.mjs suite passed. The gate/query method is restored in finally and generated database removed. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL.

Remaining limitations: a permanently hanging diagnostic can still stall that batch's iteration, though tested failure state is already durable; worker kill during enrichment, cross-process stale enrichment, full retry/DLQ-stall matrix and deployment operational alerting remain open. This entry supersedes earlier ordering claims without erasing them. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### Stalled final-attempt diagnostics and stale enrichment fencing

The diagnostic-gate regression now starts tasks at attempts 0 and 7. While the exact credential diagnostic lookup is paused, independent reads require durable retry at attempt 1 or dead at attempt 8, cleared lease and safe last_error. The final-attempt case cannot claim a ninth execution after diagnostics resume.

For attempt 1, the verifier makes that retry due and changes its fixture task type to identify a newer failure, then runs a second real worker batch while the first lookup remains gated. Attempt 2 persists newer_diagnostic_fixture in last_error. Releasing the older lookup does not overwrite that newer message or attempt count, proving the implemented attempt fencing for this overlap. This uses two asynchronous batches in one verifier process, not independent deployed workers. No runtime change was required.

node scripts/run-isolated-unified-orders.mjs passed the expanded suite; gated query restored in finally and disposable database removed. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL. Permanently stalled diagnostics can still delay iteration; cross-process enrichment races, deployment/provider evidence and operational alerts remain open. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### Diagnostic type/size boundary and serialization proof

Finding/reproduction: safeAccountDiagnostic returned a BigInt field unchanged, allowing later JSON.stringify to throw at diagnostic persistence. Fresh unit regression failed because value 1n escaped instead of a constant fallback. Binary buffers, excessive object breadth/depth and oversized strings also lacked an explicit bounded-input contract.

Fix: inventory/sync-attempts.js validates diagnostic traversal before credential lookup/redaction, with at most 1000 nodes, depth 20 and 64000 aggregate key/string characters. Cycles, binary views/buffers, BigInt/symbol/function and nonplain object types are discarded. Serialized redacted output is checked inside the safety boundary and limited to 64000 characters. Fallback never echoes unsafe input. These are diagnostic resource limits, not business payload limits.

Regression: scripts/verify-diagnostic-failure-boundary.mjs passes BigInt, binary buffer, cyclic object, throwing getter, 65000-character string, broad 1001-element structure and depth-30 cases, preserving ordinary redaction and numeric provider status. node scripts/run-isolated-unified-orders.mjs also passed; disposable database removed. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL only.

Remaining limitations: malicious getters/proxies can hang during inspection; diagnostic query timeout/iteration progress and complete use across other serialization sites remain open. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### WhatsApp exhausted pending alert admitted a ninth send

Finding/reproduction: notification claim SQL lacked attempt_count < 8. A generated pending alert already at eight attempts was claimed and passed to a rejected-send double; regression failed claimed 1 versus 0. Root cause: terminal handling after rejected sends did not constrain future claims of exhausted pending state.

Fix: inventory/whatsapp.js tenant-scoped cleanup terminalizes exhausted pending alerts as failed, preserves existing last_error or records operator-review evidence, and clears claimed_at. Claim predicate requires attempt_count < 8. Sending/uncertain states retain their outcome-review contract.

Regression: scripts/verify-unified-orders.mjs proves pending attempt 8 causes zero send calls and becomes failed, then explicitly resets only its disposable alert and executes all eight HTTP-429 rejection doubles. Attempts persist 1 through 8, pending through 7, failed at 8 and claimed_at NULL; no ninth send occurs. Other fixture pending alerts are deferred to isolate this target. Full node scripts/run-isolated-unified-orders.mjs passed; disposable database removed. Evidence: ISOLATED_REGRESSION / GENERATED_LOCAL only, no Meta provider delivery evidence.

Eight is an existing implementation limit, not an independently established business specification. Real notification response loss, ambiguous delivery, authorized operator replay, concurrent claim races and complete backoff/provider classification proof remain open. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### 2026-10-03 continuation: notification cases pending approval-service recovery

Added separate authentication 401, authorization 403, transient 503, thrown timeout, unreadable successful message-ID response and null exception cases to scripts/verify-unified-orders.mjs. Assertions cover attempt/state/claimed_at, safe last_error, first transient backoff and no automatic resend of terminal/uncertain outcomes. These NEW cases are NOT VERIFIED: automatic approval review could not execute node scripts/run-isolated-unified-orders.mjs because account usage limits prevented approval review. The rejection explicitly said this was a review failure, not a safety determination. No test database or child was created by that rejected call. Do not treat earlier passing suite output as evidence for these additions. Local syntax and diagnostic boundary checks passed.

Independent source finding: scripts/inventory-worker.mjs printed raw exception objects in reconciliation/batch catches and raw message on lock loss. Those console paths bypassed the credential-aware diagnostic boundary and could expose provider/DB details. Replaced the raw payloads with fixed failure categories. Syntax passed; deployed logging and runtime secret-injection verification remain unproven. Configured data untouched. Production remains NOT READY; full forensic goal incomplete. The approval-service failure blocks escalated test execution, not remaining local source work.


### 2026-10-03: throwing console interrupted worker progression

Fresh local runtime proof: scripts/verify-worker-console-boundary.mjs evaluates the current worker loop with verifier-only process/pool/provider/logger doubles, without network or configured databases. Provider/heartbeat/task errors contain a fixture private marker. With a capturing console, raw error details are withheld. With a console that throws, the pre-fix loop aborted before reaching the task batch, proving observability could interrupt worker progression.

Fix: scripts/inventory-worker.mjs routes console writes through workerLog, which catches console failures. Existing fixed failure categories are preserved. The verifier now passes both capturing and throwing consoles, requires one task execution and completed pool cleanup, and asserts the private marker never reaches captured logs. node --check scripts/inventory-worker.mjs also passed. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION runtime loop with doubles, not deployed worker/database recovery.

The newly added six notification failure cases remain unverified because the previously rejected PostgreSQL run was not executed. Approval-service usage failure remains unresolved; no escalation bypass was attempted. Supervisor logging, permanently hanging diagnostics and actual operational alerting remain open. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.


### Supervisor console failures and spawn-error recovery

Fresh local runtime verifier scripts/verify-worker-supervisor-boundary.mjs reproduced raw spawn-error detail exposure and throwing-console interruption. scripts/inventory-worker-supervisor.mjs now uses guarded fixed-category logging. A second finding: restart scheduling listened only to exit. An actual local Node spawn of a nonexistent fixture executable emitted error and close, without exit; the isolated supervisor test failed because no restart was scheduled after error.

Fix: one guarded recover function handles spawn error and exit, scheduling the existing backoff once per child. The per-child finished flag prevents duplicate error/exit scheduling. Shutdown retains timer cancellation and no-restart semantics. Runtime tests pass capturing/throwing consoles, spawn-error recovery without exit, duplicate-event fencing, first 2000ms backoff, restart execution and SIGTERM/no further scheduling. The worker-console verifier and supervisor syntax check also pass.

Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION with process/logger/timer doubles, plus actual local failed-spawn event observation. No configured database/network was used. Actual deployed supervisor restart, repeated backoff/reset/cap, OS resource exhaustion and graceful shutdown of an active database worker remain open. PostgreSQL notification tests still pending unresolved automatic-approval usage failure; no bypass attempted. Production remains NOT READY; full forensic goal incomplete.


### Supervisor repeated-failure/backoff and actual process recovery

Expanded scripts/verify-worker-supervisor-boundary.mjs proves rapid-failure delays 2000,4000,8000,16000,30000,30000,30000ms with controlled clock/timers. After 61000ms healthy runtime, delay resets to 1000ms. Late events from previous children cannot schedule extra restart or detach the current child. SIGINT/SIGTERM/SIGHUP during backoff cancel timers; invoking a cancelled callback still cannot spawn, and repeated shutdown is idempotent.

scripts/verify-supervisor-real-process.mjs additionally launches the actual supervisor with a guarded test-only loader replacing only its worker entry module. That fixture child never imports env/database/provider code. Real OS processes prove a failed fixture worker restarts after the supervisor backoff, and SIGTERM during backoff or after restart exits cleanly. Expected starts are exactly one/two. Children are awaited and terminated in finally. Both local commands passed; no configured persistence or external service was accessed. No runtime change needed for these newly tested cases.

Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION, actual supervisor/child processes with replaced worker entry plus deterministic clock coverage. Real database worker graceful shutdown, stuck-child termination and deployed service manager remain open. Previously rejected PostgreSQL notification cases still unverified; automatic approval-service usage failure unresolved and not bypassed. Production remains NOT READY; full forensic goal incomplete.


### Stuck worker shutdown lacked a termination deadline

Finding/reproduction: supervisor stop sent SIGTERM with no deadline. Deterministic regression failed because active-child shutdown scheduled no bounded fallback; a worker hung in provider/diagnostic/database processing could hold supervisor shutdown indefinitely.

Fix: scripts/inventory-worker-supervisor.mjs gives its owned active child 30000ms after SIGTERM, then sends SIGKILL only if that same child remains current. Child completion cancels the deadline, and stopping never schedules restart. This is a shutdown deadline, not proof of rollback of already committed business effects; existing ledger/lease recovery evidence remains separately scoped.

Verification: deterministic supervisor/worker-console regressions passed. Actual supervisor tests now include a guarded database-free fixture worker that registers a SIGTERM-ignoring handler before readiness. The strengthened test explicitly observes the deadline category and clean supervisor exit with one worker start. Restart/backoff/normal shutdown cases also pass. Both real-process runs completed; all owned fixture processes exited. No configured database/provider code was imported.

Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION with actual OS termination of a fixture child. Actual database transaction cleanup, provider accepted-response ambiguity, deployed grace-period compatibility and worker descendants remain unverified. Pending PostgreSQL notification cases remain blocked by unresolved automatic approval-service usage failure; no bypass attempted. Production remains NOT READY; full forensic goal incomplete.


### Stalled heartbeat blocked business worker execution

Finding/reproduction: inventory-worker.mjs awaited heartbeat database persistence before any task batch. The local runtime verifier gated that heartbeat query and observed zero tasks, reproducing an observability dependency blocking business progress.

Fix: heartbeat query runs best-effort asynchronously, with an in-flight guard allowing at most one outstanding heartbeat. Fixed safe logging handles rejection. Worker task processing no longer awaits this diagnostic write. No business transaction or heartbeat interval changed.

Regression: scripts/verify-worker-console-boundary.mjs advances a controlled clock across repeated due intervals while heartbeat remains gated. Three business batches execute and exactly one heartbeat query remains outstanding. The gate is released in finally. Capturing/throwing-console cases still pass; supervisor boundary and worker syntax checks pass. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION runtime source with pool/process/clock doubles, no configured data access.

Residual risk: one stalled query still occupies one pool slot; actual pool saturation, heartbeat DB timeout and graceful end with an outstanding database query remain unverified. Read-only order/provider observation jobs can still delay the serial worker loop and need separate investigation. Database-backed notification cases remain pending the unresolved automatic approval-service usage failure. Production remains NOT READY; full forensic goal incomplete.


### Serial scheduled provider jobs starved inventory queue processing

Finding/reproduction: worker awaited order polling/reconciliation/seller observation before queue processing. Gating order observation in the local runtime verifier produced zero task executions; a stalled provider job could starve unrelated queued work. Heartbeat had already been independently repaired.

Fix: inventory-worker.mjs schedules order observation, Shopify reconciliation and seller observation independently, preserving existing intervals and at most one in-flight instance per job. Failures use fixed guarded logging. Graceful shutdown stops scheduling, waits for already-started scheduled jobs before releasing the tenant lock, then closes the pool. Supervisor's existing termination deadline handles permanently stuck shutdown.

Regression: scripts/verify-worker-console-boundary.mjs separately gates heartbeat, order observation, reconciliation and seller observation. Across advanced due intervals three task batches execute while the blocked job is invoked exactly once. For scheduled jobs, tenant lock remains held while the job is gated and is released after completion. Console-error cases, supervisor boundary and syntax checks also pass. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION with runtime-source process/pool/clock/provider doubles only.

Residual limitations: real simultaneous provider jobs/queue transactions, pool contention, token refresh locking, quota contention, reconciliation/enqueue races and deployment shutdown require fresh database/provider proof. Database tests remain unexecuted due unresolved automatic approval-service usage failure; do not extend earlier PostgreSQL passes to this scheduling change. Configured environments unchanged; production remains NOT READY; full forensic goal incomplete.

### 2026-10-03: Stalled notification delivery blocked subsequent inventory batches

Finding/reproduction: worker awaited WhatsApp delivery after each inventory batch. Gating notification delivery in the runtime-source verifier reproduced only one inventory batch instead of the required three. A stalled send therefore blocked unrelated inventory queue progress.

Fix: notification delivery now uses the existing independent scheduled-job guard, allowing at most one delivery batch per worker while inventory batches continue. Graceful shutdown waits for that delivery job before releasing the tenant lock. When inventory has no work, the loop retains a one-second idle delay; notification claims no longer determine this delay. Notification persistence, retry classification and provider acknowledgment rules are unchanged.

Verification: scripts/verify-worker-console-boundary.mjs passes with separate gates for heartbeat, order observation, reconciliation, seller observation and notification delivery. The notification gate permits three inventory batches, invokes delivery exactly once, and holds the tenant lock until delivery finishes. Safe-console cases, deterministic supervisor regression and worker syntax check pass. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION using current runtime source with process/pool/provider/clock doubles; no database or provider access.

Limitations: real database concurrency, notification versus inventory pool contention, idle delivery throughput and provider behavior remain unverified. The pending isolated PostgreSQL notification cases were not executed because automatic approval review failed at its usage limit; that failure remains unresolved and was not bypassed. Earlier database passes do not establish this scheduling change. Production remains NOT READY; full forensic goal incomplete.

### 2026-10-03: Notification preparation failure incorrectly required provider reconciliation

Finding/root cause: runWhatsAppBatch used one uncertain-outcome catch for both local preparation and actual provider calls. Order-line query failure, template preparation failure or JSON serialization failure therefore left an alert uncertain, although no send had begun. This unnecessarily removed safe retries and reported provider ambiguity without a provider call.

Fix: serialize the payload before setting the send-started boundary. Failures before that boundary persist pending with existing bounded exponential backoff, or failed at attempt eight, and clear the claim. After provider invocation begins, exceptions still persist uncertain and require operator reconciliation before retry. Failure diagnostics remain fixed constants, independent of exception formatting. No claim counter or provider-success semantics changed.

Regression: scripts/verify-whatsapp-preparation-boundary.mjs runs the current batch source with pool/transaction/provider doubles. Separately inject line-query, template, serialization and started-send exceptions at attempts one and eight. It verifies zero sends for preparation failures, pending versus failed, 60/3600-second backoff, cleared claims, sending-state guard, one failure persistence operation and no fixture-secret leakage. Started-send exceptions invoke the provider once and persist uncertain. Worker/supervisor deterministic checks and WhatsApp syntax check pass.

Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION only. Actual PostgreSQL persistence, database failure during retry recording, configured templates and genuine Meta behavior remain unverified. Database tests remain unexecuted because the automatic approval service usage-limit failure is unresolved; no bypass. Production remains NOT READY; full forensic goal incomplete.


### 2026-10-03: Signed WhatsApp callback lacked tenant-scoped alert lookup

Finding/root cause: callback verified signature and phone number but selected and locked alerts solely by provider message ID. The shared database lookup omitted the configured tenant boundary, unlike the sender claim query. A valid sender signature did not itself establish ownership of the selected database row.

Fix: require INVENTORY_ALLOWED_TENANT_ID before callback processing (503 when absent), and include that tenant in the provider-message lookup within the existing row-lock transaction. Foreign-tenant rows are ignored without writes. Existing signature, phone checks, monotonic status progression and transactional timeline rules are preserved.

Regression: scripts/verify-whatsapp-callback-tenant-boundary.mjs executes current callback source with actual HMAC/signature comparison and router/database doubles. Own-tenant signed callback writes status and timeline; foreign-tenant callback performs no writes; absent tenant returns 503 before a transaction; invalid signature returns 401 before a transaction. Preparation-failure regression and WhatsApp syntax check also pass. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION; no network or database access.

Limitations: actual PostgreSQL multi-tenant callback isolation, concurrent callbacks and genuine Meta callbacks still require verification. Automatic approval-service usage-limit failure continues to prevent the pending database run; no bypass attempted. Production remains NOT READY; full forensic goal incomplete.


### 2026-10-03: WhatsApp callback persistence failures returned malformed-input status

Finding/root cause: callback catch returned HTTP 400 for every exception, including transaction acquisition, alert lookup/update and timeline insertion failures. Operational persistence failure was indistinguishable from malformed input at the provider acknowledgment boundary.

Fix: track entry into persistence processing. Exceptions from that boundary return HTTP 503 without exposing error details; input parsing/signature behavior before persistence remains unchanged. Existing row-lock transaction and replay/monotonic state rules remain intact. Partial callback-batch processing also returns 503 after persistence has begun, permitting replay of already handled entries through existing idempotent checks.

Regression: current-source callback verifier injects select, update and timeline database failures separately and observes 503; signed malformed JSON observes 400 before any transaction. Existing tenant-isolation/signature cases and WhatsApp syntax pass. The current preparation-boundary verifier reported individual injected-case passes through timeline write failure, then exited 1 when its loopback server listen was denied with EPERM; its complete suite did not pass in this run. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION with actual signature cryptography and database/router doubles, not database transaction proof.

Remaining limitations: real rollback, commit-acknowledgment loss, callback replay after partial commit, and genuine Meta redelivery remain unverified. The previously rejected database run remains unexecuted due unresolved automatic approval-service usage limit; no bypass. Production remains NOT READY; full forensic goal incomplete.


### 2026-10-03: Malformed trailing callback status caused partial processing and retry response

Finding/reproduction: signed callback containing a valid delivered status followed by null processed the valid status before throwing on the null entry and returning 503. Runtime-source regression reproduced 503 instead of the required malformed-input 400. Root cause: nested batch validation occurred implicitly during processing, after earlier status transactions could complete.

Fix: validate entry/change collection structure and matching-phone status object structure across the entire batch before persistence begins. Malformed nested input returns 400 with zero transactions. Unrecognized event fields and unsupported status values retain existing ignore behavior. Valid operational persistence failures still return 503.

Regression: current-source signed callback verifier includes valid-first/null-tail input and now verifies 400, zero transactions and zero writes; tenant/signature/database-failure cases continue to pass. Syntax check passes. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION with router/database doubles and actual HMAC. No configured database writes or provider calls.

Remaining limitations: actual database rollback, concurrent callbacks, provider redelivery and full callback payload fidelity remain unverified. Prior database run remains unexecuted after automatic approval-service usage-limit rejection; no bypass. Production remains NOT READY; full forensic goal incomplete.


### 2026-10-03: Observation failure persistence still awaited diagnostic lookup

Finding/root cause: seller observation and Shopify order polling catch paths awaited safeAccountFailure before recording account error state and Shopify retry cursor. Although diagnostic exceptions were contained, a stalled credential/redaction database lookup could still prevent failure/backoff persistence.

Fix: extract guarded synchronous provider-status classification into safeProviderStatus; persist seller failure state or Shopify retry cursor and account failure state before awaiting credential-aware diagnostics. Shopify summary starts with a fixed safe failure message and is enriched afterward. No provider-verification success boundary, stock operation or retry interval changed.

Regression: scripts/verify-observation-diagnostic-order.mjs executes each current observation source with a gated diagnostic helper. While diagnostics remain unresolved it verifies the seller state write and both Shopify retry/state writes already occurred, with no raw fixture error leakage. The gate is released in finally. Diagnostic failure-boundary verifier and both observation syntax checks pass. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION only, source execution with database/provider doubles.

Limitations: diagnostics can still hold that scheduled observation job after state persistence; actual database failure, atomicity between Shopify cursor/account updates and later-account progression require further proof. Database tests remain unexecuted after unresolved automatic approval-service usage-limit rejection; no bypass. Production remains NOT READY; full forensic goal incomplete.


### 2026-10-03: Credential failure state and webhook fallback depended on diagnostics

Finding/root cause: verifyAndSave awaited credential-aware diagnostics before saving a new failed connection or marking an existing credential retest failed. armReadOnlyOrderFeed used required logSyncAttempt after setup-error persistence, allowing optional audit failure to suppress the already recorded polling fallback result.

Fix: credential failure uses guarded provider-status classification and a fixed safe initial verification error; new failure-state save or existing empty-input retest state update occurs before diagnostics. Failed credential rotation continues to preserve the prior account. Webhook failure audit uses tryLogSyncAttempt after persisted setup error. New failed-account verification intentionally stores the safe category; detailed diagnostics remain in optional activity and the response.

Regression: scripts/verify-credential-diagnostic-order.mjs gates diagnostics separately for retest, rotation and new connection, verifies expected state writes before the gate, token-expired classification and zero rotation writes. It also executes current webhook setup source with unavailable optional audit and verifies two setup writes plus returned polling fallback. Connections syntax check passes. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION with current source and database/provider doubles.

Limitations: actual credential encryption/database save failure, transaction acknowledgment loss and real provider retest remain unverified. Diagnostics can still delay response completion after failure persistence. Database verification remains pending unresolved automatic approval-service usage-limit failure; no bypass. Production remains NOT READY; full forensic goal incomplete.


### 2026-10-04: Connection API error formatting could throw instead of responding

Finding/root cause: connection route wrapper directly accessed error.message/status/code and called redaction outside a guard. Null exceptions, throwing getters or redaction failure could reject the error handler itself; invalid status values could also break response creation. This is an HTTP failure-reporting defect, separate from durable business-state persistence.

Fix: fixed safe fallback message, independently guarded error property access/redaction, integer HTTP error status range 400 through 599 and guarded account diagnostics. Preserve ordinary validation messages and database-error category; never format secondary thrown error text.

Regression: scripts/verify-connection-error-response-boundary.mjs executes current wrapper source and injects null, message/status/code getters, redaction failure, diagnostic failure, invalid status, ordinary validation and database error. All produce the expected response without secondary-error leakage. Credential-order/webhook-fallback regression and connections syntax check pass. Evidence: GENERATED_LOCAL / ISOLATED_REGRESSION with response/diagnostic doubles, no HTTP listener or configured database.

Limitations: actual Express integration, blocked diagnostic lookup response latency and real provider error redaction remain unverified. Database run remains unexecuted after unresolved automatic approval-service usage-limit rejection; no bypass. Production remains NOT READY; full forensic goal incomplete.
