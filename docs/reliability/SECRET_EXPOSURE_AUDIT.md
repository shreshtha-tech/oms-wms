# Secret exposure audit — 2026-10-04

**PRODUCTION READY = NO. COMPLETION = UNPROVEN.** These results establish a bounded exact-value scan, not a complete absence-of-secrets certification.

| Evidence layer | Text objects inspected | Finding count | Limits |
|---|---:|---:|---|
| Worktree source/text | 976 | 0 | Initial run follows repository ignore rules; expected private `.env` is the in-memory matching source, not a finding |
| Reachable Git history | 736 text blobs | 0 | Reachable refs only; bounded per-blob/total bytes; binary blobs excluded |
| Generated `dist`/`tmp` artifacts | 367 | 0 | Explicit second scan ignores repository ignore rules; seven binary artifacts excluded |

The scanner loads current configured secret values privately and searches exact values and URI password components without printing values, snippets, hashes of secret material or certificate/private-key contents. It also flags private-key markers for review. Reports contain source variable names and file locations only. Current findings are empty. No credential was rotated or revoked and no historical content was modified.

Authoritative sanitized evidence: `secret-exposure-evidence.json` and `generated-secret-exposure-evidence.json`. The source/history scan records 101 skips including the expected private configuration source and binary files. Generated-artifact scanning records seven binary exclusions. The reusable scanner now includes ignored files in its default worktree discovery; the initial evidence counts above belong to the executed initial source/history run and separate explicit artifact run.

Remaining requirements are unknown/previously rotated credentials, generic credential candidates and provenance classification, ignored private configuration copies outside the inspected generated directories, binary DOCX/PDF/XLSX/ZIP/image metadata, reachable or unreachable history beyond the stated bounds, encrypted database fixtures, browser storage, export permissions, and PII beyond secret values. A zero exact-match count does not prove those surfaces safe. Filesystem credentials in the intentional private `.env` still require appropriate operational handling; this scan does not authorize publication of that file.
