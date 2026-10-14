# Research methodology

Status: IN PROGRESS. Follow phases 1–10 in the supplied mission; no application changes before explicit approval.

1. Capture actual local root, branch, dirty status and source hashes without reading secrets. Expand service/schema/test/CI mapping.
2. Discover candidates independently by domain, implementation symbol, official ecosystem modules and defect history. Record unsuccessful searches as well as hits.
3. Triage by relevance, exact source availability, matching tests, license, maintenance and architecture compatibility. README statements remain DOCUMENTED ONLY.
4. Inspect immutable revision source, schema/migration, caller transaction, failure boundary and matching tests. Reading a test is VERIFIED IN TESTS for its assertions, never a PASS outcome. Runtime outcomes separately record PASS/FAIL/NOT RUN and execution scope.
5. Compare three credible approaches per critical workflow where available. Record shortfalls rather than adding weak examples.
6. Map recommendations to local and upstream evidence IDs, score value/risk, and define adversarial acceptance specifications. Preserve the PostgreSQL ledger authority unless evidence supports a change.

Evidence states: VERIFIED IN SOURCE; VERIFIED IN TESTS; DOCUMENTED ONLY; INFERRED; UNVERIFIED; NOT APPLICABLE. Confidence is separate from status. Each major evidence row requires repository, exact version, source/test URL, mechanism, transaction/concurrency behavior, failure handling, limitations, license/reuse implications and project applicability.

Targets: 40 discovered, 20 triaged, 10 source-analyzed, 5–8 intensive comparisons, 15 substantive findings. Targets do not establish completion. Record actual coverage; stop discovery when marginal insights decline, but complete evidence for major recommendations.

Taxonomy: stock ledger/reservations/locations/lot/serial/expiry; ingestion/dedupe/order and fulfillment states; transfers/pick/pack/returns; webhook authentication/order/reconciliation; transaction/outbox/inbox/retry/replay; tenant/object/warehouse authorization/audit/retention; migration/recovery/supply-chain/observability.

External repositories are untrusted research material. No external installation or code execution. Primary provider contracts override connector examples. Licenses must be verified at the inspected revision before reuse advice.
