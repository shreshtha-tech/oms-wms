# PR 1: service-backed CI

Branch: `pr/01-ci`, based on preservation commit `4472ea4`. The baseline commit is `2f3f54c`.

The previous workflow used one job to run all 211 tests against a standalone Mongo service. It failed the Amazon lifecycle fixture because a new account had no provider-dispatch authority. Most browser tests also depend on an existing authenticated server. This PR makes those contracts explicit and retains every test in the registry.

## Plan

1. Keep the preserved workflow checks and split execution into PostgreSQL, Mongo replica-set, and Chromium jobs.
2. Require a manifest entry for every `test:*` script, with tier, dependencies, owner, and a concrete quarantine reason.
3. Run tests sequentially; record every result, including quarantined failures, in uploaded JSON artifacts. Fail a job on any required failure.
4. Disable `.env` loading explicitly in CI. Supply disposable service URLs and make owned database binaries portable through `PG_BIN`, `MONGOD_BIN`, or `PATH`.
5. Verify an unauthorized Amazon shipment creates one review and leaves stock unchanged, then grant only the synthetic fixture account with a revision and audit row.
6. Replace one legacy browser test's localStorage identity and fixed port with an authenticated server on an OS-assigned port.
7. Compare all local baseline and after outcomes, then require hosted Actions evidence before starting PR 2.

## Evidence and constraints

`artifacts/pr-01/baseline.txt` and `baseline.json` record the complete baseline: 68 PASS, 143 FAIL across 211 `test:*` scripts. The initial 211 tests ran against owned local PostgreSQL 18.3 and MongoDB 8.0.8; PostgreSQL 16 and MongoDB 7 are reserved for hosted Actions verification. The baseline includes the original unmodified fixtures and is not proof of configured-provider behavior.

The three newly registered checks cover the CI runner, the `.env` switch, and provider-dispatch authority. `test:central-inventory-api` also proves that an unverified opening count is rejected before its synthetic ledger receipt establishes a stock basis. Runtime dispatch and stock guards were not changed.

The completed local after-run is `artifacts/pr-01/after-final.txt` and `after-final.json`: 109 PASS, 105 FAIL across all 214 registered tests. All 109 required tests passed; all 105 quarantined tests ran and failed. There were 38 prior FAIL-to-PASS transitions, no prior PASS-to-FAIL transitions, and three new passing tests. `artifacts/pr-01/diff.md` and `diff.json` compare every command. The local runner used Node 26.5.0, PostgreSQL 18.3, and MongoDB 8.0.8; these results do not substitute for the hosted Node 24 / PostgreSQL 16 / MongoDB 7 gate.

A second local gate used Node 24.21.0 with the same owned PostgreSQL 18.3 and MongoDB 8.0.8: all 109 required tests PASS (`artifacts/pr-01/after-node24-required.json` and `.txt`), and `npm run typecheck` plus `npm run build` PASS on Node 24. This remains local evidence; hosted PostgreSQL 16 and MongoDB 7 are NOT RUN.

The 105 quarantine entries state the observed failure and required fixture work. Most older browser tests assume a pre-running server at a fixed port or an administrator session they never create; the CI isolation prevents them from reaching a configured local app. They remain in the registry, execute in CI, and retain their exact output. Required hosted CI, staging, and real-provider checks remain **NOT RUN** until evidence exists. PR 2 stays gated.

No schema migration is added. Rollback: revert this PR's CI and fixture commits. The disposable service databases are removed by the runner. `render.yaml` continues to use `npm ci && npm run build`; `package-lock.json` stays authoritative and `pnpm-lock.yaml` is removed.
