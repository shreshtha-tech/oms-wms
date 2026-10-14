# Reuse and license review

Review date: 2026-10-09. This is an engineering triage, not legal advice. Confirm the exact file/package license and obtain counsel review before copying or linking code into this private repository. Repository licenses can change; preserve review date and source URLs.

## Current application

`package.json` declares the application `private: true`; that setting is not itself a license grant or compatibility analysis. No assumption is made here about a user-provided commercial distribution model. This report therefore recommends pattern-only reuse unless a file-level audit and legal review approve a specific dependency or code excerpt.

## Upstream repositories

| Repository | Reviewed license evidence | Practical reuse assessment |
|---|---|---|
| [ERPNext](https://github.com/frappe/erpnext) | Repository identifies GPL-3.0; reviewed [`stock_ledger.py`](https://github.com/frappe/erpnext/blob/develop/erpnext/stock/stock_ledger.py) and its [stock ledger tests](https://github.com/frappe/erpnext/blob/develop/erpnext/stock/doctype/stock_ledger_entry/test_stock_ledger_entry.py). | Treat code copying or derivative integration as high review risk for a private app. Use ideas only absent an approved compliance plan. Independently check dependency and file headers. |
| [Medusa](https://github.com/medusajs/medusa) | Repository has [MIT license](https://github.com/medusajs/medusa/blob/develop/LICENSE) and a separate [Enterprise License](https://github.com/medusajs/medusa/blob/develop/ENTERPRISE-LICENSE.md). | Do not infer all repository paths are MIT from the root license. Inventory core/workflow source and any enterprise-marked path must be individually checked; exclude EE material from copying without commercial authorization. |
| [Saleor](https://github.com/saleor/saleor) | Repository [LICENSE](https://github.com/saleor/saleor/blob/main/LICENSE) is BSD-3-Clause. | Permissive relative to copyleft candidates, but preserve notices/conditions and audit copied code/dependencies. Pattern-only remains simpler than source reuse. |
| [Vendure](https://github.com/vendurehq/vendure) | Root [LICENSE.md](https://github.com/vendurehq/vendure/blob/master/LICENSE.md) is GPL-family; repository publishes a [plugin exception](https://github.com/vendurehq/vendure/blob/master/license/plugin-exception.txt). | Exception applies under its stated terms; do not assume it permits arbitrary modification or copying of core. A separate plugin integration and a fork/core derivative require distinct review. |
| [OpenBoxes](https://github.com/openboxes/openboxes) | The project is reported as EPL-1.0; the source tree and service were inspected, but the direct root license file could not be fetched in this review. Verify current terms before reuse. | Do not copy its large Groovy service into the Node app without file-level license verification and legal analysis. |
| [Shopify/shopify-app-js](https://github.com/Shopify/shopify-app-js) | Root repository advertises MIT; the package monorepo includes `@shopify/shopify-api` and an Express adapter. The old [`shopify-api-js`](https://github.com/Shopify/shopify-api-js) is archived and moved. | Candidate only for Shopify-specific API/OAuth/webhook needs. Review package notices, API version, transitive dependencies and scopes before installation; current local code already performs raw-body HMAC and idempotent ingress. |
| [pg-boss](https://github.com/timgit/pg-boss) | Reviewed project [LICENSE](https://github.com/timgit/pg-boss/blob/master/LICENSE), source and tests. | Could be an ordinary third-party dependency if it satisfies package metadata and transitive dependency review, but it would add queue semantics beside existing SQS/outbox. License is not the main adoption blocker. |
| [Cline](https://github.com/cline/cline) | Reviewed repository [root LICENSE](https://github.com/cline/cline/blob/main/LICENSE). | Developer tool, outside runtime product scope. Do not treat a package-level sub-license as a statement for all repository paths. |
| [OpenHands](https://github.com/OpenHands/OpenHands) | Reviewed repository [root LICENSE](https://github.com/OpenHands/OpenHands/blob/main/LICENSE), which is MIT. | Developer agent UI/tooling, outside runtime product scope. Do not transfer code merely because the top-level project has a permissive license. |

## Recommendation

Use external repositories for architectural study: stable lock ordering and reservation tests (Saleor), explicit compensation boundaries (Medusa), event provenance/replay (ERPNext), allocation strategy extension points (Vendure), and WMS process vocabulary (OpenBoxes). Do not copy source code in this research phase. Before any later code reuse, record exact source commit SHA, path, applicable license/header, dependency tree, required notices, modification/distribution model and counsel decision. Verify Medusa and Vendure commercial boundaries from current upstream terms at that time.
