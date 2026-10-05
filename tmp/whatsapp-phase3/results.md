# Phase 3 review — 26 entries (20 accounts + 6 programmes)

Phase 3 implements admin APIs and the Mobile team / per-order alert UI only. No Flipkart polling, report importer, channel matrix, provider setup or deployment was started.

## Existing files touched
- inventory/unified-orders.js: mounts the alert-admin router; protects existing member, OTP and sender-setup routes with the configured administrator check; masks mobile numbers in member list/save/state responses; keeps recipient numbers private for Meta/OTP.
- inventory/db.js: registers additive migration 018.
- src/pages/UnifiedOrders.tsx: embeds team management in Mobile team, exposes the informational event subscription, uses masked API responses in member rows and OTP notices, adds the shared alert component to its order timeline.
- src/pages/LiveOrderWorkspace.tsx: embeds the per-order alert component in the order detail that the app actually uses.

## Added files
- db/migrations/018_alert_admin_actions.sql: additive operator-audit and test-attempt tables, tenant foreign keys and unique tenant/request ID. No production database migration was performed.
- inventory/alert-admin.js: uses the existing authenticated configured-admin identity; tenant-owned team/member/rule management and SKU-group creation; catalog pickers; test send with a persisted nonce, one-minute member cooldown and the shared tenant rate limiter; per-order masked alerts; reviewed/requeue actions with operator audit and eligibility checks. Editing a team purpose cancels incompatible pending events.
- src/pages/AlertTeams.tsx: create/edit/deactivate teams, membership, all rule matchers and rule deletion, SKU groups, test-member selection and real attempt history. Disables controls during mutations and preserves existing matchers on rule edit.
- src/pages/OrderAlerts.tsx: masked number, team, real status/error, review history, operator note and explicit uncertain-delivery acknowledgement before re-queue. Includes styles for use outside the Central Inventory page.
- scripts/verify-alert-admin.mjs: actual-session PostgreSQL API fixtures with fake Meta.
- scripts/verify-alert-admin-ui.mjs: actual React components served through Vite, actual session/API/database fixture, fake Meta, desktop/mobile interaction and screenshots.
- scripts/run-isolated-whatsapp-phase3.mjs: local-only disposable database wrapper with an explicit suite allowlist and database cleanup.

## Ran / passed
- node scripts/run-isolated-whatsapp-phase3.mjs: actual session authentication; unsigned/non-admin sessions rejected; cross-tenant mutation rejected; masked recipient list/save and alert errors; 26-entry catalog; team/member/rule management, SKU group; migration replay; audit uses authenticated operator rather than request-body operator; reviewed leaves delivery status unchanged; requeue blocks accepted/sending/delivered/read/cancelled/pending, stale/cancelled orders, invalid recipients/event subscriptions/hours, and unacknowledged uncertainty; purpose changes cancel incompatible pending alerts. Test send preserves four variables, uses TEST order identifier without creating a business order, nonce replay sends nothing again, cooldown and consent/verification/mute/active/hours guards, safe Meta codes and pre/post-dispatch failure classification.
- node scripts/run-isolated-whatsapp-phase3.mjs scripts/verify-alert-admin-ui.mjs: Mobile team create/edit/deactivate; membership; rule add/edit/delete; platform and SKU matchers survive payment-mode editing; fake test send and retry share one persisted request; actual Live Orders detail displays error and masked member; reviewed/requeue operator history; desktop/mobile screenshots, mobile overflow assertions and no browser script errors.
- npm run test:unified-orders-isolated: passed, database removed.
- test:central-inventory via node scripts/run-isolated-central-inventory.mjs: passed, database removed.
- test:central-inventory-api via node scripts/run-isolated-whatsapp-phase3.mjs scripts/verify-central-inventory-api.mjs: passed, database removed. The three required database regressions were run in that order.
- node scripts/verify-whatsapp-transport.mjs: passed with mocked DNS/HTTPS, no network calls.
- npm run typecheck: passed.
- npm run build: passed. Existing warnings remain: Node 20.14 below Vite supported version and a bundle larger than 500 kB.

Earlier browser fixture attempts failed (initial module import and accessible-name selection); both were corrected and the successful run then exposed and fixed a real edit-refresh race. The final browser assertion checks preservation of platform and SKU fields rather than just successful form submission. Screenshots were visually inspected.

## Not run / limits
No live Meta or seller-provider request, configured real-team/browser acceptance, production migration or deployment. Browser checks are isolated fixture evidence, not a production UI session. Test attempts display acceptance/failure/uncertainty; delivery callbacks continue to track real order alerts, so accepted test messages do not claim delivered/read status. The SKU-group creation picker lists the first 1000 master SKUs; rules can select existing tenant groups. Admin access is the existing single configured administrator, not a new role system. Account report/custody policy controls and the full channel matrix are later phases.

## Manual acceptance after review
Apply migration 018 through the normal migration command on the intended environment. Sign in as the configured administrator, open Central Inventory → Mobile team, add/verify a consenting member, create a team, save membership and a rule for one authorized account. Send one test and confirm it arrives on that member's phone; accepted alone is not delivery proof. Observe one genuine eligible order, open its Live Orders detail and confirm one alert per member, masked number, correct team/content and delivery callback status. For a failed fixture/controlled failure, record an operator review and confirm the delivery status is unchanged; requeue only after correcting the cause. Check an unverified member and a second tenant cannot receive/send or change records. Inspect the saved operator history. Do not requeue delivered or unreviewed uncertain alerts.

Stop here for Phase 3 review. Phase 4 needs next and the redacted Flipkart response sample before adapter mapping.

## Local 404 follow-up — 2026-10-03
The frontend base `/api/inventory-sync/unified/alert-admin`, unified router mount `/alert-admin`, private router mount `/unified`, and server mount `/api/inventory-sync` agree. The local backend on port 3002 was PID 53659, started at 04:33:53 before the Phase 3 router source was updated at 21:14:52. It was running `node server.js`, without hot reload. Restarted only that API process; the replacement PID was 67518. Vite and inventory workers were left running. No source route or auth bypass was introduced.

A read-only configured-local PostgreSQL check also found `ci_alert_team`, `ci_alert_admin_audit`, and `ci_alert_test_attempt` absent. Applied only additive migrations 017 and 018 under the existing schema advisory lock; confirmed those three tables now exist. This is configured local schema evidence, not a production deployment or provider test. The earlier Phase 3 report's no-production-migration statement still applies.

Extended scripts/verify-alert-admin.mjs to exercise the full `inventoryPrivate` production router chain at the exact frontend teams/catalog URLs with a real authenticated fixture session. The updated isolated Phase 3 suite passed and removed its disposable database. The actual local server responds 401 to a signed-out probe, as expected; no private browser cookie or admin password was read, copied, or minted against the configured database. The user's existing signed-in Safari page must be refreshed to confirm its visible error clears.

Follow-up diff: 404-followup.diff. Only the verifier and this review record changed; the runtime API restart and local additive migrations were the fix. No Phase 4 work started.
