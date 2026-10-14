# Versioned standards and control map

Status: IN PROGRESS. Standard text is DOCUMENTED ONLY; local assessment remains separate. ASVS source: OWASP/ASVS v5.0.0_release, commit 5cf9b032440be53ce345ab3c130fda46ba1ce7a2 (STD-001). Chapters V8 and V16 only, paraphrased from CC BY-SA 4.0 material. No conformance level or overall compliance declared.

| ASVS control | Scoped requirement | Local evidence / gap | Roadmap |
|---|---|---|---|
| 8.1.1 | Document function and data rules | Return authority and warehouse rules unresolved LOC-006/012 | R-01 |
| 8.1.2, 8.2.3 | Define and enforce field restrictions | Full response/write property campaign missing | R-01/R-09 |
| 8.2.1 | Explicit function permission | Selected guarded routes; return approval gap LOC-006 | R-01 |
| 8.2.2 | Per-record authorization | Tenant SQL present; complete object/warehouse campaign absent LOC-005/012 | R-01 |
| 8.3.1 | Trusted-side enforcement | Existing requirePermission; no client role inference | R-01 |
| 8.4.1 | Prevent foreign-tenant effects | Configured single tenant; general multitenancy not established LOC-012 | R-01/R-02 |
| 16.1.1 | Inventory logs, access and retention | No completed inventory/retention proof LOC-013 | R-07 |
| 16.2.1–16.2.5 | Useful correlated metadata, time and privacy | Request IDs/allowlist present; complete coverage/time/privacy proof open LOC-013 | R-07 |
| 16.3.1, 16.3.2 | Authentication and authorization event coverage | Full decision/event coverage not demonstrated | R-01/R-07 |
| 16.4.1–16.4.3 | Injection protection and protected separate logging | JSON serialization present; storage/access/transport not verified LOC-013 | R-07 |
| 16.5.1–16.5.4 | Safe errors, dependency failure and last-resort handling | server.js handler and provider wrapper exist; broad failure campaign missing LOC-008 | R-03/R-07 |

OpenAPI 3.1.1, commit 69d8b7953c3259e243cf746388a0951b89649763, Security Requirement Object (STD-002): multiple schemes in one object combine, alternatives are represented as separate entries, and an empty object permits anonymous access. API documentation cannot enforce server permissions. Document concrete 202 acceptance versus committed receipt, 409 changed replay, unavailable 501 and permission failures; compare the specification with full-route tests, not just schema validity. No framework or schema generator adoption proposed.

Three source-level authorization approaches now available: Saleor required mutation permission plus order-channel check and channel-denial test (UP-013); Vendure resolver metadata enforced through guard strategy plus actual payment-order channel check (UP-017); Frappe separates role/type policy from document owner/user/share constraints with named owner/document tests (UP-018). Frappe privileged bypass and Vendure disabled/custom-auth configuration are limits, not patterns to inherit. None alone proves generic tenant isolation.

Supply-chain evidence: Scorecard wrapper/probe pipeline and runtime-error result (UP-020) informs explicit scanner failure states, but its wrapper fixture is not a local security verdict. Local immutable-action config is separately verified in earlier fixture evidence (LOC-011). Package integrity fields do not prove installed artifacts or vulnerability absence (SUP-001).
