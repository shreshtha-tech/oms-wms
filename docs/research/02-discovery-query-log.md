# Discovery query log

| Date | Where | Query | Result | Limitation / next action |
|---|---|---|---|---|
| 2026-10-15 | Local Git/filesystem | rev-parse root/HEAD; status --short; symbolic-ref --short HEAD; rg file inventory | Relocated repository verified; extensive staged work; earlier industry docs found | git branch --show-current unsupported by Git 2.15; fallback succeeded |
| 2026-10-15 | Web search | site.github.com saleor warehouse management allocate stocks race condition | Saleor warehouse/management.py source result | Search-result extract only; not yet immutable source inspection |
| 2026-10-15 | Web search | site:github.com inventory reservation warehouse management system stock ledger | Additional leads: JumpMasters/quartermaster, iKhaledAmin/Inventory-Management-System, brettljausn-ai/openwcs; also speculative project/spec hits | Candidate leads only; provenance, license, tests, maintenance and source not verified; no adoption claim |

GitHub code-search syntax, API availability and defect-history research remain pending. Exact searched URLs and immutable source captures will be added with each investigation.

2026-10-15 follow-up: public GitHub REST /repos/{owner}/{repo} and /commits/{default_branch} attempted for 48 candidates; exact results/errors in discovery-metadata.json. Anonymous API 403 rate limits encountered. Default sandbox DNS failed; public network retrieval succeeded with approved escalation. Commit-pinned raw.githubusercontent.com source/test/license requests and 404 failures are recorded individually in source-retrieval-manifest.json. No external code executed. Guessed paths are never treated as verified paths.

2026-10-15: commit-specific GitHub tree API requests for 11 repositories returned 403 rate limits; pinned web tree opens failed cache retrieval. Codeload archives were read as inert streams to locate tests/licenses; selected Saleor and Medusa archive manifests completed, while other streams remained pending. The identified temporary download process was explicitly terminated after over ten minutes to prioritize the user-authorized fixes (exit 143). Previously retrieved source files remain in the private temporary research directory. No external repository code executed. Official actions/checkout and actions/setup-node README usage was read through raw URLs; public v7 references resolved to 3d3c42e5aac5ba805825da76410c181273ba90b1 and 949feb2413d6458794dcd2491c4babbbce0c15c1 with credential helpers disabled.
