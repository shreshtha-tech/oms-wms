# 008 Tax Group — source contract and bypass proof

api/tax-groups.js stores group metadata in generic_records module tax-group and components in tax_group_codes referencing tax_codes. Validates base fields/date/status, component ids/duplicates/levels and active-code assignment; code/name duplicate checks are read-before-write. Mapping replacement deletes prior rows then inserts new rows, with application compensation restoring prior mappings on exceptions; group metadata update follows. This is not a database transaction or crash-safe proof. List joins codes and displays summed percentages, not verified tax compounding. Delete rejects 409.

Fresh memory scripts/verify-tax-group-bypass.mjs reproduced generic DELETE removing group metadata while component mapping survived, bypassing dedicated delete rejection. Generic tax-group writes now fail closed 501; group/mapping preserved. Expanded memory protected suite covers 40 mutation cases across ten patterns. No complete group creation/update/failure/financial proof.

Remaining: replacement/compensation races and failures, process crash, historical orphan reconciliation, status/reference effects, index uniqueness, tenant/role/audit requirements, configured persistence and full browser/LIVE contract. Business owner unspecified. Module UNVERIFIED; production NOT READY.

Fresh OPEN concurrency defect: memory and disposable Mongo simultaneous single-component replacements both returned 200 and persisted a two-code mixture. scripts/verify-tax-group-concurrency.mjs and its disposable runner fail the coherent-set invariant. Existing compensation is not serializable. Required atomic/durable revision repair is outstanding; no successful workflow claim.

Current repair evidence supersedes the historical open replacement defect only for tested scopes: datastore-owned atomic save passes memory/in-process and separate-process replica-set replacement, duplicate creation conflict, injected rollback/recovery and standalone no-write rejection. Previous compensation path is no longer used by saves. Crash/commit ambiguity, reader snapshots, configured deployment and full workflow/financial/permission proof remain open.
