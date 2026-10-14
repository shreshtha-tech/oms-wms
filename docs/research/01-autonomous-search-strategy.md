# Autonomous search strategy

Status: IN PROGRESS — research only under the latest brief; no further application changes until roadmap approval. Prior confirmed fixes are historical authorized work, not completion of this research.

Questions derived from the actual stack:
1. Can every PostgreSQL stock writer share stable lock order and event identity, including first reservation, adjustment and cross-location transfer? Compare row locks, parent-row gates, advisory locks and conditional updates.
2. Can provider observations change financial, fulfillment and warehouse state independently without replaying stock? Inspect order transitions, quantity revisions and terminal-state guards.
3. Does the existing inbox/outbox survive crashes and preserve remote uncertainty? Compare owner fencing, transactional receipts, mutable jobs and immutable CDC events.
4. Which physical WMS dimensions are represented in the authoritative database rather than just UI/configuration? Inspect lot/serial/bin/LPN, receiving, picking, QC and transfer custody.
5. Is every stock-authorizing endpoint protected by both operation permission and tenant/object/warehouse scope? Inspect real mounts and handler calls, not menu labels.
6. Which reliability gaps justify a new dependency? Require measured local limits, maintenance/license review and an acceptance test before recommending replacement.

Independent search axes: business capability (cycle count, returns, pick/pack); algorithm (FEFO, allocation); database (ordered locks, conditional writes); stack (Node/TypeScript/Express/PostgreSQL); failure (oversell, lost update, duplicate delivery, partial external success); test (barriers, crash injection, replay assertions); bug/fix history; provider contract. Use queries with competing approaches, not only chosen patterns.

Sequence: DISCOVER → FILTER → INSPECT SOURCE → TRACE WORKFLOW → VERIFY TEST ASSERTIONS → COMPARE → IDENTIFY LOCAL GAPS → NEW QUESTIONS → SEARCH AGAIN. Search hits are leads, not code verification. GitHub web/code/API syntax differs. API rate limits led to pinned raw URLs and inert archive streaming. No downloaded code is executed.

Repository metadata snapshot covers 48 attempted candidates, 24 successful metadata lookups; others remain access-incomplete. This is not 48 verified production systems. Existing industry reports remain historical leads. New searches found Zehelein/pg-transactional-outbox and smaller concurrency-focused projects; none is promoted from README claims to verified implementation.

Stopping rule: finish evidence for major recommendations and investigate credible competing mechanisms. Numeric targets never justify weak entries or invented results. Track unresolved questions in progress.json and 14-implementation-roadmap.md.
