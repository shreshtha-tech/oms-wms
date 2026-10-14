# Proposed first implementation slice: return approval authority and actor provenance

Approval required by the latest user research brief. This document is a proposal; no code or grants have been changed. Evidence LOC-005/006/012, UP-013/017/018/021/022/023/024, STD-001/002.

Problem: inventory/unified-orders.js mounts POST /returns/:id/approve-receipt without an operation-specific requirePermission. The existing configured session and tenant boundary do not themselves grant return approval authority. inventory/return-service.js bounds stock by ordered/dispatched units and request identity, but does not bind an approving actor. This is a source-confirmed control omission, not a configured exploit demonstration.

Proposed scope:

1. Add `central_inventory.returns.approve` to api/auth-session.js permission allowlist; place its guard on this route before return DB work. Grant it to nobody automatically. Existing configuration must explicitly authorize operators after review.
2. Derive actor username from the authenticated server session. Current account identity is username, not an invented user UUID. Pass it as trusted service context; reject missing actor on new approvals. Client actor fields cannot override it.
3. Persist original approver snapshot on the receipt and existing order timeline in the same transaction as stock effects using a forward-only migration reviewed against current HEAD. Leave pre-existing receipts explicitly legacy/unattributed, never fabricate past actors. Exact replay preserves original receipt/actor; record later attempts separately if needed without duplicating stock.
4. Keep current tenant/return→account→order→SKU relation and warehouse/store location validation, dispatched-unit cap, reservation/event behavior and exact/changed request replay contract. Do not invent warehouse assignments absent an approved grant model. Dedicated warehouse-level grants and physical QC/disposition remain R-06 follow-ups.
5. Make UI approval affordance follow this capability while keeping server enforcement authoritative. Add full-mounted authenticated route tests with owned stores and synthetic sessions, plus existing receipt regressions.

Expected touched paths: api/auth-session.js, inventory/unified-orders.js, inventory/return-service.js, new reviewed db/migrations SQL, actual return UI callsite discovered before edit, and focused verification script. No generic stock API, provider write, broker or orchestrator introduced.

Acceptance: anonymous401; valid ungranted session403 before receipt/stock effects; granted synthetic operator succeeds; foreign tenant/object/location denied with no foreign changes; client actor spoofing ignored/rejected; success receipt/timeline retains authenticated actor; exact replay no additional event/receipt/outbox; changed intent409; cumulative dispatch bound unchanged; transaction failure leaves no partial approval/actor record; legacy receipts remain identifiable without fabricated attribution. UI cannot bypass guard. Existing configured credentials are not accessed to test this.

Migration/review: use a fresh owned database for fresh-install, existing-schema adoption, rollback-on-failure and rerun checks; checksum history must remain valid. New columns must accept legacy records explicitly. No deployed migration or privilege grant is authorized merely by approving code review. Hosted/provider proof remains separate.

Exit evidence: exact changed-source hashes, full-route denial and granted-path results, stock/replay invariants, migration recovery result and concise review diff. Only then proceed to R-02 lock ordering and R-04 quota fixes under the approved roadmap. A complete condition-specific returns workflow is intentionally a later domain phase requiring physical policy.
