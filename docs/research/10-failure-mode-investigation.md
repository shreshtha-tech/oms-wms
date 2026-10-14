# Failure-mode investigation

Status: research synthesis completed within the scope in completion-audit.md. The detailed twelve-scenario [adversarial plan](17-adversarial-test-plan.md) defines invariants, setup, injected failures, expected state, DB/event assertions, recovery and proposed locations. It does not claim the proposed tests exist or passed.

Strong current failure evidence:
- UP-004: Vendure explicit concurrent final-unit and absolute-adjustment tests. Same-transition strategy and row-lock-driver scope materially limit the guarantee. Bulk lock-order/deadlock assertions now read: reversed admin-update IDs versus settlement must not deadlock; final balances29/19 or accepted MariaDB snapshot abort. Fixed-wait/driver scope remains a limit.
- UP-001: Saleor allocation shortage due to checkout reservations raises InsufficientStock and leaves no Allocation rows; not a real concurrent test.
- UP-007: ERPNext cancellation restores delivered reservation quantity/status, and unrelated issue cannot consume reserved stock. These are domain regressions, not proof of all database races.
- UP-003: Medusa module tests assert rejected reservation preserves reserved_quantity; compensation uses saved IDs. Lock provider test uses a toy stock counter. Workflow cancellation/crash timing still needs complete trace.
- UP-005: pg-boss retry test references regression #839: unset retry delay with backoff must not produce immediate retry. Test assertions verify nonzero delay and eventual fetchability; issue/PR history not yet independently inspected.
- UP-009: Camel duplicate pass-through must not remove or confirm a key owned by another exchange. This owner distinction suggests a late-worker/fencing test locally; repository durability itself remains a separate requirement.
- UP-011: Debezium ignores tombstones/deletes and treats update as unexpected; copying mutable job rows into CDC would require a changed event contract.

Historical leads needing corroboration: Medusa issue https://github.com/medusajs/medusa/issues/17022 reports a nested completion/compensation timing problem for package 2.13.1 and points to #15028. This is a reporter claim, not verified reproduction, fix status, or proof the inspected newer commit is affected. Official Vendure release/changelog describes stock-lock and absolute-adjustment fixes, but exact merged diffs still need immutable matching. These leads must not be promoted to verified local defects.

Local failures already addressed under earlier scoped authorization: hidden SKU writes before import 501 and missing checksum history, with exact test scopes in confirmed-defect-validation.json. Current research-only policy does not authorize further application edits.

Unresolved failure cases include complete pick/cancel custody, partial returns/refunds, prolonged cross-replica quota handling, lease-expiry fencing, actual migration invalid-index fault, object/warehouse permission denial, and restoration under approved RPO/RTO. No capacity, p95/p99 or recovery targets invented.

## Cross-writer lock order — LOC-016

New source-derived question: inbound receipts sort by SKU code, while provider order workers sort mapped internal IDs before both call the parent-SKU-locking ledger. Construct an isolated pair A/B where SKU A maps to the higher internal UUID and SKU B to the lower. Hold receiver after it locks A and worker after it locks B, then release barriers for their second lock. Determine whether PostgreSQL detects a deadlock and whether each caller safely reports/retries the aborted operation with the same identity. This was initially INFERRED and is now reproduced; see runtime update below. No stock-corruption claim. A single shared canonical lock-order contract may reduce failure/retry churn, but the complete writer/caller trace is required before implementation. UP-004 batch lock tests and ERPNext sorted processing gates provide relevant competing patterns.

## Verified historical patch and reported workflow defect

HIST-001 records the actual OpenBoxes PR #5943 patch and test diff, pinned to its From commit, instead of relying solely on an advisory. The patch replaces an executable template engine and enforces document type. Tests were read in diff, not run. HIST-002 records the independently opened Medusa #17022 report, expressly DOCUMENTED ONLY with reporter version 2.13.1. No current-version affected claim or verified fix is inferred.

## LOC-016 runtime update

The earlier INFERRED/NOT RUN description is historical. lock-order-reproduction.md and lock-order-reproduction.json now record a confirmed deterministic deadlock using actual local receipt and Shopify processor paths on owned PostgreSQL. Lock-order consistency FAIL; atomic rollback, whole-operation same-identity retry and exact replay PASS. No application fix or provider/configured proof.
