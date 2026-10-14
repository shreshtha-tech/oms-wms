# License and software supply-chain review

Inspection date: 2026-10-09 (Asia/Kolkata). Status: **IN PROGRESS**. Research/reporting only.

[Existing reuse review](../reuse-and-license-review.md) is preserved. Prior root-license assertions are not a completed per-file/package legal review. No upstream code was copied and no dependency was added.

package.json declares ISC for this application; that declaration does not establish the licenses of third-party dependencies or reference implementations. package-lock.json is present and captured in the source snapshot. A complete resolved runtime/dev/optional/transitive inventory, overrides provenance, license exceptions and current advisories remains INCOMPLETE.

Local overrides pin shell-quote under concurrently and uuid under exceljs. Their presence alone does not prove advisory remediation, dependency compatibility or license compliance; inspect the resolved lockfile and applicable advisories before making those claims.

.github/dependabot.yml only configures devcontainers weekly. There is no npm update entry in the inspected file; no workflow file was found under .github. Remote code-scanning, dependency-review, secret-protection and branch-policy settings are unknown, so do not equate missing YAML with absence of every GitHub security capability.

Proposed bounded supply-chain work: establish lockfile-derived inventory/SBOM, record package license and applicable notices, classify optional/dev versus redistributed runtime use, then inspect current advisories with affected/fixed ranges. Effort medium; benefit reviewable upgrades and reuse decisions; compatibility npm/Node; risk false positives and license misclassification; acceptance every shipped dependency has evidence or an explicit unresolved entry; validation clean-install checks, relevant regression tests and reviewed notices. Installing tools requires a specific proposal and subsequent authorization.

ASVS official repository states CC-BY-SA-4.0. Treat the standard as a referenced verification framework, with attribution/share-alike review if redistributing adapted requirement text. Ajv root MIT license is verified; its repository advisory page showed no published advisories at the latest selected check, but local transitive `ajv@6.15.0` still belongs in the full lockfile scan. OpenTelemetry exact package/runtime licenses and versions remain unverified; selected upstream advisories now include database-username span attributes and configuration-specific core risks (see [catalog](repository-catalog.md#selected-advisory-and-security-guidance-refresh--2026-10-09)). No OpenTelemetry package is currently in the lockfile. Medusa EE carve-outs, ERPNext/Vendure copyleft and OpenBoxes EPL-1.0 require exact-file and distribution review before reuse.

## Fresh upstream license evidence

Saleor root LICENSE on main identifies BSD-3-Clause: preserve required copyright/license/disclaimer notices when redistributing and do not imply endorsement. Exact-package reuse still requires review.

Medusa root LICENSE on develop explicitly excludes Enterprise materials. The v2.21.2 ENTERPRISE-LICENSE.md identifies RBAC/SSO modules, policies, permission middleware, related UI and tests as proprietary materials requiring a commercial agreement. The reviewed cart reservation step is outside the listed Enterprise paths, but license evidence should ultimately be checked at the identical revision for every copied file. No code reuse occurred. Prefer independently designed local patterns and tests; do not copy Enterprise RBAC as a shortcut for local authorization.

Sources: [Saleor LICENSE](https://raw.githubusercontent.com/saleor/saleor/main/LICENSE), [Medusa root LICENSE](https://raw.githubusercontent.com/medusajs/medusa/develop/LICENSE), [Medusa Enterprise scope v2.21.2](https://raw.githubusercontent.com/medusajs/medusa/v2.21.2/ENTERPRISE-LICENSE.md).


## Resolved lockfile inventory — fresh offline inspection

[dependency-inventory.json](dependency-inventory.json) records 533 lockfile package entries, versions, declared license fields, dev/optional flags, integrity presence, and installed-manifest comparisons. All entries have integrity fields; this does not independently verify downloaded bytes or publisher trust. No observed installed version differs from the lockfile. Seventy absent installed manifests are optional packages; their absence is not a failed clean install claim.

162 lockfile entries omit license metadata. Installed manifests resolve declared metadata for 160; `png-js@2.0.0` has a local MIT LICENSE, leaving `buffers@0.1.1` unresolved. Its installed package.json and files contain no explicit license grant or LICENSE file. The lock graph path is `exceljs@4.4.0` → `unzipper@0.10.14` → `binary@0.3.0` → `buffers@0.1.1`. [Debian's copyright record](https://sources.debian.org/copyright/license/node-buffers/0.1.1-2/) identifies MIT and attributes that to an upstream package.json at commit `1b745ee35d33eb166e15ef1866073a07c6d7de87`, but the referenced GitHub repository/commit could not be retrieved and the installed npm package differs by omitting the license field ([npm package metadata](https://www.npmjs.com/package/buffers?activeTab=dependencies) lists no license). Treat this as conflicting provenance evidence, not cleared compliance. Its use should be reviewed before redistributing that dependency path. The inventory excludes registry URLs, credentials and configuration. Current advisory matching, shipped-runtime closure, SBOM standard conversion and redistributed notices remain incomplete.

[Official Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) confirms npm ecosystem/root manifest configuration is available. Existing configuration only covers devcontainers. Proposed change remains small effort, low configuration risk with update-PR noise/upgrade risk, acceptance root lockfile dependencies receive reviewable updates while existing devcontainers config is preserved; validate YAML/schema and a representative update on an isolated branch after authorization. No CI file or dependency was changed.

## Current lockfile and advisory-source check — 2026-10-09

Recomputed against the current package-lock.json and local node_modules: 533 non-root entries, 162 missing lockfile license declarations, 160 recovered from installed manifests, two still missing installed-manifest license metadata (`buffers@0.1.1`, `png-js@2.0.0`), zero missing integrity fields, 70 absent installed manifests, and zero installed-version mismatches. The lockfile marks 365 entries as non-dev (77 optional); 288 are non-dev and non-optional. `npm explain` shows both unresolved metadata packages are on direct production dependency paths: `exceljs@4.4.0` → `unzipper@0.10.14` → `binary@0.3.0` → `buffers@0.1.1`, and `pdfkit@0.20.2` → `png-js@2.0.0`. The installed `png-js` package contains an MIT LICENSE with copyright notice, so this is a missing package metadata field with local license text available. `buffers@0.1.1` has no installed license field or LICENSE file and remains unresolved; external Debian attribution conflicts with the installed npm artifact and does not clear it. This makes `buffers` the single identified unresolved license grant on the current non-dev graph, not proof that the whole dependency set is compliant.

`npm audit --json --package-lock-only` was attempted read-only. It could not resolve `registry.npmjs.org` (`ENOTFOUND`), so it returned no vulnerability data. No clean or zero-vulnerability result is claimed. Re-run an advisory scan when registry access is available, then map every advisory's affected/fixed range against the lockfile and distinguish runtime from dev-only reachability. No packages were installed or changed.

An independent targeted match against GitHub-reviewed advisories found the current resolved versions outside the listed affected ranges for three ExcelJS transitive packages: `uuid@11.1.1` equals the fixed version for [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq); `tmp@0.2.7` equals the fixed version for [GHSA-7c78-jf6q-g5cm](https://github.com/advisories/GHSA-7c78-jf6q-g5cm); and `brace-expansion` resolutions 1.1.21, 2.1.7 and 5.0.12 exceed the fixed ranges in [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7). This is a bounded hand-match, not a complete dependency audit. `package.json` overrides ExcelJS's declared uuid range to 11.1.1; reviewed source shows ExcelJS imports only `v4`, and `scripts/verify-exceljs-uuid-override.mjs` passed a real XLSX write/read check with data-bar extension IDs, formula, values and formatting. It proves this exercised compatibility path, not compatibility for every ExcelJS use or every uuid API.


## License metadata follow-up

Installed node_modules/png-js/LICENSE was inspected and identifies MIT; its absent package.json/lockfile license field is a metadata omission, not license absence. buffers@0.1.1 remains unresolved after installed filename/README inspection. Full third-party notices and shipped dependency closure remain incomplete. Preserve source evidence for png-js before making a redistribution decision.

## Selected upstream advisory status — 2026-10-09

Repository-candidate advisory review is recorded in the [repository catalog](repository-catalog.md#selected-upstream-authorizationorder-advisory-review--2026-10-09). Saleor's two high-impact advisories provide explicit affected/fixed ranges; the current listed 3.23.40 tag is later than the relevant 3.23 patch floors, but the release notes reviewed do not enumerate those fixes. Vendure's delegated-admin escalation is fixed from 3.7.2; a separate draft-order access report has a confirmed v3.7.0 reproducer, unknown full affected range and no patch listed. Do not state that the listed v3.7.4 release is clear until its exact resolver source is compared with the report. The Medusa advisory page displayed no published repository advisories at inspection, which does not establish absence of transitive package advisories; its separate issue report is not counted as a GHSA.

These upstream advisories are source-selection and regression-design evidence only. They do not identify vulnerabilities in the local application, and no candidate's code or dependency was copied.


## Corrected upstream license paths — 2026-10-09

[Ajv master LICENSE](https://raw.githubusercontent.com/ajv-validator/ajv/master/LICENSE) identifies MIT. [OpenBoxes develop LICENSE.md](https://raw.githubusercontent.com/openboxes/openboxes/develop/LICENSE.md) identifies EPL-1.0; previous failed LICENSE request was a path failure. [Vendure master LICENSE.md](https://raw.githubusercontent.com/vendurehq/vendure/master/LICENSE.md) identifies GPLv3 as default without a commercial agreement and references a plugin exception. The exception and commercial terms were not inspected. Do not infer that the exception permits copying core implementation into this application.

Recommendation: keep these references as independently implemented design/test concepts until exact source revision, distribution scope and notices are reviewed. Applicability: any proposed code reuse; effort small for a bounded file review, larger for framework adoption; risk incompatible obligations; acceptance exact copied files and dependencies have reviewed license evidence and required notices; validation compare selected revision LICENSE/exception/NOTICE with the proposed diff. No upstream code copied or packages installed.
