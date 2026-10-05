# Tax Group atomic replacement — repair constraints and evidence

Status: repair required; concurrency regression currently fails in both memory and disposable standalone Mongo. This is an implementation design, not a verified repair.

Current contracts traced from source:

- api/tax-groups.js joins generic_records group metadata, tax_group_codes mappings and tax_codes rates for response. TaxGroup.tsx consumes components with tax_code_id/tax_level. Preserve that response shape.
- api/taxapp.js validates/resolves tax groups using generic_records module/code/status. Preserve metadata identity and existing Tax Application links.
- Existing verify-tax-group-workflow.mjs directly reads tax_group_codes. Replacing persistence with an embedded array would change these readers and require a migration/read-version contract; it is not a drop-in repair.
- api/mongo.js currently has no Mongo session/transaction propagation. Existing find/insert/update/remove operate independently, including sequence allocation. PostgreSQL ledger transaction helpers do not cover these legacy Mongo writes.

Selected repair direction: a datastore-owned atomic group save, keeping metadata/mapping schema and API shape. Mongo implementation must use one session transaction for group write and component replacement, with snapshot/majority settings and driver retry behavior. Validate referenced codes in the same transaction. Concurrent edits must conflict/retry against a fresh authoritative snapshot, not run application compensation against another writer's state. A transaction failure must leave metadata and mappings at the previous complete set. Sequence values may have gaps, but mapping identity allocation must not collide. Do not nest existing compensation inside automatic transaction retries.

Deployment capability is a prerequisite: standalone Mongo cannot execute multi-document transactions. Detect/support replica-set or mongos capability and return explicit unavailable responses before business mutation where transactional save is unsupported. The configured Mongo capability remains unknown because connectivity is not established. This prerequisite must not be reported as configured success from a disposable fixture.

Memory implementation must provide the same coherent-set contract across the entire save, including rollback on validation/faults. A serialized memory callback is acceptable only as the memory implementation; it is not evidence of cross-process Mongo correctness. Do not introduce a process mutex as the production repair.

Required executable evidence before claiming repair: current failing concurrency regression on memory and a replica-set Mongo fixture; separate-process concurrent saves; injected failure after deleting mappings and before metadata update; transaction abort readback; unavailable standalone produces no changes; driver retry produces a coherent set once; process termination during transaction preserves prior state; downstream response/Tax Application reference and existing workflow regressions. Ownership/authorization, rate applicability/rounding and group-code rename referential safety remain separate unproved contracts.

No schema migration or configured write is authorized by this design artifact alone. Repository-side implementation and disposable tests remain within the ongoing repair scope; configured data changes require their actual operational authorization and evidence.
