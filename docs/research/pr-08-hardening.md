# PR8 hardening plan

Status: draft parallel track after PR1. This checkpoint addresses the legacy CORS boundary first; the rest of PR8 remains open.

1. Characterize the current CORS helper and route ordering before editing.
2. Replace wildcard legacy CORS with exact `CORS_ORIGINS` matching. Invalid entries fail closed; same-origin calls need no CORS header.
3. Handle API preflight before authentication and return 403 for disallowed origins. Send credential permission only to allowed origins; align the mutation-origin guard with the same explicit allowlist.
4. Add isolated request tests for allowed, denied, missing and malformed origins, actual and preflight requests, and no wildcard.
5. Run existing security, origin, Render and build/typecheck checks; record baseline and after evidence.

Remaining PR8 work: security headers, per-route body limits, complete mounted-route permission classification, legacy roles, and tracked-file cleanup after reference review. This CORS checkpoint alone does not pass the full PR8 or production security gate.
