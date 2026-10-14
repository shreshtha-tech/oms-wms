# Audit provenance versus business history

Source inspection on 2026-10-15; upstream tests NOT RUN. Exact pinned links and licenses: UP-021/022/023 in [evidence.json](evidence.json). This comparison does not claim compliance or universal logging coverage.

| Implementation | Actual mechanism | Evidence boundary | Local decision |
|---|---|---|---|
| Saleor UP-021 | Event-specific order functions persist type, date, JSON parameters and user/app; GraphQL test asserts fields and actor | Model user/app use SET_NULL, order uses CASCADE. Durable row is not immutable retention proof | Keep explicit operation/actor and object identity; decide retained actor snapshot separately from mutable user FK |
| Vendure UP-022 | Context-derived administrator, typed data, public/private history; saved row followed by event publication | Update/delete paths exist and check order channel; no demonstrated atomic durable message from these calls alone | Do not use customer-visible/editable notes as sole security audit; enforce scope on history access too |
| Frappe UP-023 | Document field and child-row diff; session impersonator/audit-user metadata | Versioned fields are configurable. Tests deliberately suppress ignored fields; new documents may have no version | Define required operation fields explicitly; do not assume generic diff covers physical approval or original actor |
| Local LOC-005/006/013 | Return receipt/ledger/timeline transaction; bounded process telemetry | Return actor/inspection provenance is incomplete; process metrics are not durable security records | R-01 binds actor from session; R-07 defines retention, redaction, access and durable correlation |

Proposed minimal return-approval audit contract, subject to roadmap approval: authenticated actor ID; effective tenant; operation; return/order/warehouse IDs; stable request identity; outcome; reason and controlled evidence reference; timestamp; correlation ID; replay or conflict outcome. Persist the successful operation record with the domain change. A denied operation needs a bounded separate audit path since the domain transaction must have no effects. Do not store credentials or unbounded provider payloads. Retention and access policy remain owner decisions. Evidence: LOC-005/006/013, STD-001, UP-021/022/023.

Tests to design after approval: actor supplied by client cannot override session actor; concurrent/replayed success records one domain effect with traceable attempt outcomes; denied foreign warehouse request has no ledger effect; later user deletion does not erase required operation attribution; public notes cannot expose restricted inspection evidence. These tests are proposed, NOT RUN.
