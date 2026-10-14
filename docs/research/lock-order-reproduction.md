# Receipt versus order lock ordering — reproduced

Evidence LOC-016. Date 2026-10-15 Asia/Kolkata. Research-only fixture; application code unchanged.

The previously inferred deadlock is now confirmed under a deterministic interleaving. Actual receiveCentralInboundStock and processInventoryTask (Shopify orders/create) ran concurrently against a new disposable PostgreSQL cluster. SKU A had the lexically higher UUID, SKU B the lower. Receipt code processed A→B by SKU code; order code processed B→A by mapped internal ID. Fixture wrappers paused each connection immediately after its first actual parent-SKU locking query completed, then released both for their second lock.

Observed: receipt rejected with PostgreSQL 40P01; Shopify reservation committed. No provider call, configured database or live credentials were used. Explicit empty Mongo/credential environment and forbidden provider fetch guarded the final run. The fixture initialized and removed only its own temporary cluster.

| Assertion | Result | Evidence |
|---|---|---|
| Shared caller lock order avoids this deadlock | FAIL | Opposite first locks observed; one actual transaction rejected 40P01 |
| Losing receipt rolls back completely | PASS | Both balances stayed at on_hand 10/reserved 1; only two opening and two reservation events existed |
| Same-identity receipt retry completes once | PASS | Both balances became on_hand 11/reserved 1; exactly two inbound events added |
| Exact replay of receipt and order is idempotent | PASS | Balances, six total events and two reservations unchanged |

This is an avoidable availability/retry problem, not evidence of stock corruption. It does not establish production frequency, latency, broader deadlock freedom, configured HTTP behavior or any provider outcome. Do not promote the forced scheduling fixture to a load benchmark.

Reproduction: `/opt/homebrew/bin/node docs/research/fixtures/lock-order-research.mjs` from the existing workspace. It uses installed PostgreSQL binaries and package dependencies, never imports env.js, and creates synthetic records only in a newly owned instance. File currently records the known workspace path for exact reproduction; adjust that explicit local path if the checkout moves. Results write to /private/tmp/oms-lock-order-research-result.json; the reviewed result is archived as lock-order-reproduction.json with inspected application hashes.

R-02 recommendation: acquire all affected parent-SKU locks in one shared canonical internal-ID order before any writer performs quantity-derived reads/writes. Keep canonical request payload/digest order independent from execution lock order, so existing replay identities remain stable. Compare Vendure batch-lock helper (UP-004) and ERPNext sorted processing gates (UP-007). Add the opposite-order case as a regression only after roadmap approval; no source fix made during research.
