# Phase 2 review — 26 entries (20 accounts + 6 programmes)

Scope: team migration and first-order routing only. Phase 3 admin APIs/UI, Phase 4 Flipkart polling, Phase 5 report adapters and Phase 6 matrix remain pending.

## Files
- db/migrations/017_order_alert_teams.sql: additive team/member/rule tables, tenant-owned SKU groups, nullable alert team_id, one team alert per recipient/order, tenant foreign keys, neutral intake facts. Existing programme identity remains ci_program_order.
- inventory/db.js: registers migration 017.
- inventory/order-alert-routing.js: OR across rules, AND within a rule; platform/programme/account/physical location/SKU prefix/group/payment/source matching; recipient guards, first-event dedup, legacy recipient fallback.
- inventory/order-alert-policy.js: freshness, report opt-in, custody informational opt-in, Tally exclusion, programme assignment using the existing table; stock policy independent from alert opt-in.
- inventory/unified-orders.js: persists intake facts and calls routing inside the intake transaction; Amazon non-MFN or missing fulfillment type treated conservatively as custody.
- inventory/workers.js: policy guard before warehouse reservation/mutation, including Amazon quick-commerce programmes received under platform amazon.
- inventory/whatsapp.js: four template variables with programme label and team instruction/dispatch note; rechecks policy, active team and membership before dispatch.
- scripts/verify-order-alert-routing.mjs and run-isolated-whatsapp-phase2.mjs: disposable PostgreSQL routing fixtures, fake sender, actual custody worker check, migration replay.
- scripts/verify-whatsapp-reliability.mjs: supplies the newly required policy lookup in its fake pool; existing failure assertions retained.

## Verification
PASS routing PostgreSQL fixture: all matchers; OR/AND; no rules; same recipient in two teams; repeated webhook/poll intake; verification/consent/mute/active/hours/event guards; cancellation/freshness; report defaults and opt-in; Shopsy vs parent; Minutes informational-only; Amazon FBA/missing fulfillment suppression; custody worker leaves ledger unchanged; removed team members are not sent queued alerts; late programme classification cancels queued packing notification before dispatch; legacy behavior; cross-tenant FK rejection; migration replay; four-variable content.
PASS existing fake WhatsApp reliability and transport, callback tenant boundary, approved template tests and archived Phase 1 baseline characterization.
PASS existing isolated WhatsApp PostgreSQL suite, including OTP limits and lockout.
PASS test:unified-orders-isolated.
PASS test:central-inventory via its disposable PostgreSQL wrapper.
PASS test:central-inventory-api via the disposable Phase 2 wrapper.
PASS npm run typecheck and npm run build. Build warns about Node 20.14 being below Vite's supported version and an existing bundle over 500 kB.

Tests use local disposable databases and fake providers. No live Meta/provider calls, browser verification, production migration, or real-team acceptance was performed. Programme identity is accepted only from an explicit authorized normalizer argument or an existing ci_program_order assignment; no provider fields were invented. Report/custody opt-in flags are persisted account settings consumed by policy; the admin controls arrive in Phase 3. No render.yaml change in this phase.

Packing suppression guard: Amazon fulfillment must explicitly be MFN. AFN or unknown fulfillment is informational-only after account opt-in and cannot reserve warehouse stock. Existing custody programme assignments override even MFN-shaped notifications. Membership or team deactivation prevents later sends. Unknown physical warehouse mappings fail matching.

Review phase2.diff against the saved Phase 1 files. Stop here until next.
