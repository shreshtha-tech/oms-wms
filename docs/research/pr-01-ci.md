# PR 1: service-backed CI

Branch: `pr/01-ci`, based on preservation commit `4472ea4`.

`.github/workflows/ci.yml` runs `npm ci`, `npm run typecheck`, `npm run build`, and `npm run inventory:migrate` against a disposable PostgreSQL 16 service. MongoDB 7 and Chromium support the existing verification scripts. `scripts/run-ci-tests.mjs` discovers every `test:*` entry from `package.json`, runs sequentially, records each outcome, and exits nonzero on any failure. It does not skip incompatible tests or reinterpret failure as success.

Schema: no new migration. The existing migration CLI is executed only against `oms_ci_test`; no configured database credentials enter CI.

Rollback: revert the PR 1 commit to restore the preserved workflow. There are no runtime stock or schema changes to reverse. The service database is destroyed with the runner.

Known blockers: several isolated runners require `/opt/homebrew/bin` binaries; legacy browser tests require their own authenticated API fixture (for example `scripts/verify-vendor-master.mjs` defaults to port 3003 and localStorage identity). A Mongo standalone service does not satisfy replica-set tests. These contracts need portability/fixture work before full CI can be green. Do not start PR 2 or merge while these gates fail. Hosted CI and staging/provider tests remain NOT RUN.

## Local validation

- PASS: `npm ci`, `npm run typecheck`, `npm run build` on Node 26.5.0. CI specifies Node 24; that environment remains unverified.
- PASS: workflow YAML parsing, runner syntax, and `git diff --check`.
- PASS: runner isolation check discovers both test entries, excludes non-test entries, continues after an injected failure, records both outcomes, and exits nonzero.
- PASS: `scripts/verify-migration-history.mjs` on its owned PostgreSQL cluster.
- PASS: `npm run inventory:migrate` on a fresh owned PostgreSQL 18.3 cluster with `.env` loading disabled. PostgreSQL 16 service execution remains NOT RUN locally (Docker unavailable).
- PASS: `scripts/verify-sku-import-provenance.mjs` and `scripts/verify-sku-import-integrity.mjs`.
- FAIL: `npm run test:central-inventory`, `scripts/verify-central-inventory.mjs:43`, expected on-hand 1, actual 3. The Amazon account is created after migration without provider authority. Existing `scripts/verify-phase-b-dispatch.mjs` explicitly exercises permission/revision-controlled authority. Resolve the fixture contract without broadening runtime dispatch authority.
- NOT RUN: `test:central-inventory-api` (the owned-stack check stopped at the preceding failure); full 211 registered `test:*` entries; GitHub Actions; staging/provider verification.

This is a draft local change, not a green or merge-ready PR. PRs 2–7 remain gated on PR 1. `render.yaml` already uses `npm ci && npm run build`. The preservation commit excludes untracked contents within the `ponytail` submodule; those remain on disk.
