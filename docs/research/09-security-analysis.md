# Security analysis

Status: research synthesis completed within the scope in completion-audit.md. Findings are source-scoped; no production credentials, configured account changes or exploit traffic used.

The current server authenticates the private /api mount, then inventory/http.js binds a single configured tenant (LOC-012). Selected Central Inventory and connection mutations use requirePermission. This proves neither a general multi-tenant model nor complete operation/object/warehouse authorization.

Priority finding LOC-006: unified return approval POST is authenticated and tenant-bound, but the inspected route directly calls approveReturnReceipt without an operation-level permission guard. The permission allowlist has stock/count/connection/opening-stock permissions but no dedicated return approval capability. The service validates quantities and original dispatch (LOC-005); these integrity controls do not decide who may authorize restocking. Classify as implemented with security risk. Wrong-role full-mounted HTTP proof and intended role policy remain unresolved. Do not invent grants from alert roles, menu labels or an Admin name.

OWASP function-level and object-level checks are separate obligations: explicit grants for sensitive functions (DOC-005) and authorized object/tenant/warehouse association for every caller-supplied ID (DOC-004). Proposed R-01 must deny unauthorized requests before stock/database side effects, record actor and reason, and prove exact replay/changed replay/cross-object denial on synthetic fixtures. No further application edits are authorized under the latest brief.

Return-service actor/QC evidence is also incomplete: approveReturnReceipt accepts identity/quantity/location but no authenticated actor argument or immutable physical inspection record. qc_status is updated after receipt, but a QC label does not prove inspection. Audit design must distinguish request actor, authorizer, physical receiver, condition and stock disposition (LOC-005/006).

Existing ledger events and timeline entries provide business provenance (LOC-001/005/007). Request telemetry has an allowlist and bounded cardinality (LOC-013), but it is not an immutable, access-controlled, retention-governed audit trail. No general audit-retention completeness claim is made.

Supply chain: current npm/actions Dependabot and pinned workflow are present after earlier authorized fixes (LOC-011). Hosted checks, repository protection, secret scanning, package advisory matching, container SBOM/provenance and signature verification are NOT RUN or unresolved. Metadata license labels are not a license audit. Medusa excludes Enterprise RBAC/SSO materials (UP-003); Vendure is GPLv3/VCL with a referenced plugin exception (UP-004). These sources are patterns, not a copy authorization.

Remaining standards work: versioned ASVS applicability/control mapping, sensitive-data retention/deletion, OAuth account binding, encryption/key lifecycle, SSRF/upload bounds, API resource limits, backup protection and full role/object/warehouse campaigns. A standard listing is not a local compliance verdict.

## Function and object enforcement follow-up

UP-013 traces Saleor permission enforcement in BaseMutation plus order-channel check and a no-channel-access test. UP-017 traces Vendure resolver permission metadata, AuthGuard configured strategy call, and payment-order channel check before refund even for empty line arrays. These are stronger evidence for R-01 than a general RBAC feature list; neither proves all framework routes are secure.

Historical implementation: HIST-001 inspects OpenBoxes PR #5943 patch at ea5ba4bc5fc1060f985febbad55a47a548843ecb, including type validation, restricted resolution and controller/service test additions. It is an interpreter/type-boundary lesson, not a claim this Node project has the same vulnerability.
