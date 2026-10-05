# Admin parity scope — 2026-09-24

Only Exports, Force Order Pull, Settings, Manage Api, API Dashboard, Language Setting and the seven Admin Logs entries are in scope. Shared shell and unrelated workflows remain outside this change.

| Requirement | Current LIVE evidence | Implementation / verification |
| --- | --- | --- |
| Exports | pendingDisplay, seven columns, empty grid, two notices, refresh hidden for two seconds | Match module layout; verify refresh and report actions |
| Force Order Pull | forceOrderPullBS, 24px inputs, warehouse toggle, required location/order validation | Match module form; validate/reset; retain configured channel integration boundary |
| Settings | displayAdminSettings repeatedly navigates away before DOM capture | Pending manual opening; do not infer current layout from older evidence |
| Manage Api | displayManageApiBS plus manageApiKeyEdit and manageApiWebhook captured | Dedicated grid/editor/webhook configuration; persistence and local browser checks |
| API Dashboard | apiDashboard, timing/hit cards, four filters and charts captured | Replace unrelated counters with request metrics and observed filters |
| Language Setting | displayVinLanguageAction, selectors, property filters, edit/save handlers captured | Dedicated language search/override persistence; reset retains language |
| User Audit Logs | roleLogBS, four-field download form, exact validation captured | Dedicated export request instead of generic audit grid |
| Accounting Log | tallyInterfaceAction, two grids and financial-client selector | Dedicated transactions and transaction-type logs |
| Tax Integration Log | taxSettingAction, integration/status/date filters | Dedicated tax columns and search |
| Device Tracking Log | deviceTrackingLogBS, Intugine/device/invoice filters | Dedicated device columns and search |
| External Apps Logs | displayExtAppsFailedOrderGrid, default Error filter, reset | Dedicated app log grid and filter search |
| POS Integration Log | displayPosIntLog, wide 18-column grid, repush/export actions | Dedicated POS log grid, horizontal scrolling |
| Repush Log | repushlogdisplay, WebHook/EmailTransit/TransmitDetail/ManifestStatus tabs | Dedicated tab-specific logs |

Snapshots and read-only handler observations: `artifacts/live-parity/admin/`. No LIVE Save, Repush, Confirm, deletion, or export generation has been executed. Tenant dropdown values are evidence, not local seed data. API credentials are redacted. Initial direct-route login-page captures were discarded.

Validation remains pending until recorded below; screenshots or a build alone do not establish workflow parity.
