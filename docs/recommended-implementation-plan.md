# Recommended implementation plan from industry research

Status: proposal only. This research does not authorize source or database changes. Highest-value candidate identified: make the existing SKU CreateUpdate import a server-owned, bounded, retry-safe workflow, because current source parses and caps rows in the browser, then updates SKUs individually before a valid import-history request reaches 501. The 501 response claims no SKU changes were created even though earlier row writes may have committed, and the UI reports only that final error. This is a source-confirmed partial-write and false outcome-reporting defect; actual persistence/failure windows remain NOT RUN. A current uncommitted server change correctly blocks fabricated import history but does not undo prior browser-issued SKU mutations. Exact production business semantics require product-owner review before implementation.

## Phase 0 — agree on import behavior

Confirm whether CreateUpdate must be all-or-nothing or whether valid rows may commit when other rows fail. Until a contract is approved, fail closed and do not advertise the UI path as a completed import. Confirm allowed fields, duplicate SKU behavior, create-vs-update rules, attribute handling, per-file/row/byte limits, authorization role, retention and audit visibility. Reconcile Mongo transaction availability in the supported deployments. This decision changes the persistence model and must precede implementation.

## Phase 1 — server-owned validation and preview

Add a dedicated backend service behind the existing SKU import route. The service should accept file bytes (or an authorized upload reference), authenticate and authorize before parsing, enforce extension/content/byte/row limits, parse a strict CSV schema, validate the active Attribute Set, reject ambiguous duplicate SKU keys, and compute a stable file/request digest. Return a preview with row-numbered validation errors and proposed creates/updates without mutating `skus`. Keep stock quantities out of this master-data import.

Acceptance criteria:

- Invalid auth, wrong tenant/scope, inactive Attribute Set, malformed CSV, duplicate identifiers, oversized input and unexpected columns produce deterministic client-safe errors and zero writes.
- Preview output identifies create/update/no-op rows without leaking server paths or exception details.
- Repeated preview is read-only and yields the same digest/results for the same bytes and relevant master snapshot.

## Phase 2 — atomic commit, audit and idempotent recovery

After preview approval (or an explicitly agreed one-step import), commit according to the selected contract. Preferred default is one all-or-nothing Mongo transaction with a durable job/history row, unique request key and import digest; update SKU records and final history under one transaction. If supported Mongo deployment cannot transact, stop and design a separately approved durable staging/recovery protocol rather than silently reverting to row-by-row client writes. On duplicate request, return the prior outcome when digest matches and conflict when it differs. Keep request outcome queryable after client timeout.

Acceptance criteria:

- Full success atomically changes every accepted row and writes exactly one committed import record/audit event.
- Any row failure in all-or-nothing mode rolls back every row and leaves a terminal failed history with safe diagnostics, or a separately specified staging record if the model needs preview state.
- Concurrent imports for same SKU cannot create duplicates or overwrite an update without a deterministic conflict/review outcome.
- Retry after response loss does not duplicate rows/history; same key with changed bytes is rejected.
- No route writes balances, reservations, stock events or provider mappings.

## Phase 3 — client integration and operator recovery

Replace the current client loop that sends one `/api/skus` mutation per row, then reaches a history endpoint that rejects because no processor exists. The current uncommitted route change prevents fabricated history but leaves partial client-side SKU writes possible; its “No SKU changes” wording is inaccurate for the whole UI workflow. The UI should upload once, display server-calculated preview/errors, require confirmation if the approved contract requires it, submit the stable request ID, and poll/read the durable outcome after timeout. A failed transport must show `outcome unknown` and retrieve the import job rather than blindly repeat an unkeyed write.

Acceptance criteria:

- Browser flow makes one import command for the selected file; it does not call per-row POST/PUT endpoints.
- Cancellation before commit produces no SKU changes. Timeout followed by refresh displays the authoritative final job state.
- Row-level results, counts and audit actor/date come from server records, not caller-supplied values.
- Existing single-SKU master edit behavior and central inventory ownership remain unchanged.

## Phase 4 — isolated verification and gated rollout

Build or use only a policy-compliant fresh loopback Mongo replica-set database with an `_test` name; validate the target before importing application modules. Test route authorization, size limits, transaction rollback, duplicate and concurrent SKU keys, retry/replay, changed-payload conflict, history integrity, restart/recovery and browser timeout. Existing `scripts/verify-sku-import.mjs` is not an approved harness as written: it connects the test process directly to a `codexqa_*` Mongo database, sends mutations to an independently configured running server, does not verify target equality and does not clean inserted records. Replace or wrap it so the server and assertions demonstrably use the same unique disposable database and cleanup completes. Do not point at Atlas or a configured business database. If disposable Mongo startup fails before assertions, report application semantics as NOT RUN.

Rollout requires an explicit owner decision, reviewed diff, tests, migration/backup plan if schema changes, operator instructions, monitoring/rollback, and separate hosted/provider evidence if any external behavior is later added. This plan does not authorize those actions.

## Later research-led candidates

1. Define a test matrix for multi-SKU and multi-location allocation with a stable database lock order, using Saleor’s warehouse tests as a design reference.
2. For each incomplete WMS transition, choose one workflow and define physical owner, allowed actor, quantity, idempotency, rollback/review state and ledger effects before enabling legacy UI mutations. OpenBoxes can inform process discovery; its records are not the authority.
3. Keep the existing PG outbox/SQS layout unless representative volume/recovery measurements show a concrete limit; compare pg-boss only against that measured requirement.
4. Keep cross-store workflows on explicit local outbox/inbox boundaries; borrow Medusa-style compensation vocabulary without substituting a workflow engine or copying enterprise-only code.

## Stop point

This deliverable ends at the review gate. No SKU-import, inventory, API or UI implementation was made in this research turn. No read-only worktree branch was created: this checkout is on `main` with pre-existing local changes, and repository metadata is outside the configured writable scope. Preserve the existing checkout and review this proposal before authorizing implementation.
