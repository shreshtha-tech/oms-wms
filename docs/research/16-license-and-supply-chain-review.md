# License and supply-chain review

Status: IN PROGRESS. This records exact public source-license declarations, not a legal clearance, artifact provenance guarantee, or completed dependency/advisory audit. No upstream implementation has been copied into the application. Source archives are inert research material.

| Repository | Inspected revision license | Finding | Reuse decision/limit |
|---|---|---|---|
| saleor/saleor | [LICENSE](https://github.com/saleor/saleor/blob/925b69959a97c9deda7cdc85092494896d0aa1f4/LICENSE) | BSD-3-Clause | Root text read; preserve notices/conditions for any future reuse. |
| frappe/erpnext | [license.txt](https://github.com/frappe/erpnext/blob/655186714ce8b163cf32effc1ab4f335b99df7ca/license.txt) | GPL-3.0 text | Patterns and test ideas only; no code imported. |
| odoo/odoo | [LICENSE](https://github.com/odoo/odoo/blob/993abab95278f488f47c231be38d9cbc85213c41/LICENSE) | LGPLv3; bundled components may differ | Root text explicitly points to component/source-specific notices. |
| medusajs/medusa | [LICENSE](https://github.com/medusajs/medusa/blob/0b97a96ea0d32ff3f4b18dbeeeeba9e763600a15/LICENSE) | MIT excluding Enterprise Materials | ENTERPRISE-LICENSE.md read; RBAC/SSO enumerated materials require commercial agreement; do not infer all code is MIT. |
| vendure-ecommerce/vendure | [LICENSE.md](https://github.com/vendure-ecommerce/vendure/blob/530fa0afad87c449635d3864b604de93d7dd0a43/LICENSE.md) | GPLv3 or commercial VCL | Root references plugin exception and FAQ; exception scope not yet reviewed. No direct copying recommended. |
| openboxes/openboxes | [epl-v10.html](https://github.com/openboxes/openboxes/blob/94f393a240347209ad88fa6b48124e0238dd17ad/epl-v10.html) | EPL-1.0 | Source header identifies this root text; full reuse obligations not yet analyzed. |
| timgit/pg-boss | [LICENSE](https://github.com/timgit/pg-boss/blob/b53278b0afea34aa9110c6b0ebd927cee48dd4ae/LICENSE) | MIT | Root text read; candidate mechanisms, no runtime adoption proposed. |
| graphile/worker | [LICENSE.md](https://github.com/graphile/worker/blob/4cda192c5df254392a1dff350e5d73f7d2c18a85/LICENSE.md) | MIT | Root text read; complete SQL/tests still need inspection. |
| Shopify/shopify-app-js | [LICENSE.md](https://github.com/Shopify/shopify-app-js/blob/e409d06d03aebb88c3b0af85ea6b0120e439fd6b/LICENSE.md) | MIT | Root text read; official validator is not a durable OMS integration. |
| apache/camel | [LICENSE.txt](https://github.com/apache/camel/blob/1afa3af6f48b54763b2982726ccb7e29cba93948/LICENSE.txt) | Apache-2.0 | Root license and source header read; NOTICE/dependency inventory needed for any reuse. |
| debezium/debezium | [LICENSE.txt](https://github.com/debezium/debezium/blob/2f84b29c03638d261823172d1d8bfa9ca3a99824/LICENSE.txt) | Apache-2.0 | Root text read; NOTICE/component obligations and actual CDC operations review pending. |
| woocommerce/woocommerce | [unresolved](https://github.com/woocommerce/woocommerce) | UNVERIFIED in current source retrieval | Root LICENSE guess failed. No code copying or adoption claim. |

Evidence IDs: UP-001 through UP-012. Corresponding revision and retrieval hashes are recorded in evidence.json and retrieval manifests. License labels from GitHub metadata alone are not treated as verified text. Any proposed copying requires file-scoped notice/exception review; none is currently authorized.

Local dependency snapshot SUP-001: 533 non-root lockfile records, 533 integrity fields and 371 license declarations. These counts came from parsing the current package-lock.json, not inspecting every resolved package. Missing declarations require review, not an automatic unlicensed verdict. No current package advisory matching or artifact signature/SBOM verification performed.

Existing CI uses immutable official action references, read-only token permissions, no credential persistence, npm ci --ignore-scripts and isolated tests (LOC-011). Hosted execution and branch protection/required checks are unverified. Dependabot npm/actions coverage is configuration only. No scanner framework is adopted merely because it appears in the discovery list.

Required remaining review: full resolved package license/notice and advisory matching; npm/pnpm lock ownership policy; lifecycle/native-build needs; official scanner and CodeQL version/action scope; container base/SBOM/provenance if containers are actually used; signed build/release requirements; secret scanning and permissions; update/migration rehearsal. R-09 remains evidence-gated.

Additional source review: Tryton stock module COPYRIGHT and LICENSE were retrieved/read at 8a743492cd18002a2c47f877e87aa32d79360c78; module declares GPLv3 or later (UP-015). OFBiz LICENSE and source headers were retrieved at b8b72d556e829d4a0818f8a4fed57e0750efcacb; source declares Apache-2.0 (UP-016). No application code reused. Metasfresh guessed source/license paths returned 404 and remain unresolved; no license inferred.
