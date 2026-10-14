# Provider resilience matrix

Date: 2026-10-08 (Asia/Kolkata). Part 1 source audit. **PROVIDER RESILIENCE: BLOCKED**. No genuine provider request was made for this matrix.

## Transport boundaries

| Transport | Destination/TLS boundary | Timeout/response bound | Retry/uncertainty | Gaps |
|---|---|---|---|---|
| `inventory/connection-security.js`, providerFetch | HTTPS origin, public DNS answers checked and selected address pinned; does not implement redirect following | 20-second per-attempt AbortSignal includes DNS; 20-second socket inactivity; 4,000,000-byte buffered response cap | GET/HEAD or explicit retrySafe uses capped safe retry; mutations otherwise one attempt; durable publication handles uncertainty above transport | Caller-specific destination/account ownership, retrySafe correctness, total multi-attempt deadline, account fairness and host/circuit cardinality |
| `inventory/whatsapp.js`, whatsappFetch | Exact graph.facebook.com origin; public DNS answers checked and pinned | 20-second total deadline across DNS and response; socket inactivity 20 seconds; 4,000,000-byte response cap | Queue knows dispatch/accepted/uncertain; no blanket mutation transport retry | Injected slow-drip/DNS deadline regression passed; genuine Meta, sender/pool occupancy and cancellation remain unverified |
| `api/external-app-connections.js` native fetch | Restricted alphanumeric/hyphen subdomain under fixed marketingcloudapis.com suffix; HTTPS; redirect error | 15-second signal; response.json lacks local byte cap | Connection failure returned as HTTP 200 with jsonMessage; no credential mutation claimed | Bounded response reader, public-address/DNS strategy, sanitized provider text and truthful application status contract |
| `inventory/sqs-worker.js` AWS SDK | Queue URL/settings and SDK client; IAM/source policy external | Receive asks 10 messages with 20-second long poll; explicit SDK transport deadline not set in this function | Durable accept then delete; failure retains message | Verify SDK configuration and retries in current lock/runtime; queue URL/account ownership, visibility, DLQ, abort/shutdown and source provenance |

The guarded HTTPS transport protects only its own callers. The native fetch and SQS paths are separate audit surfaces. No exhaustive arbitrary-URL or SSRF absence claim is made.

## Provider/capability evidence

| Provider/capability | Current source | Safe uncertainty boundary | Fresh evidence in this campaign | Production gate |
|---|---|---|---|---|
| Shopify order ingress/poll | Signature/digest ingress; bounded page/line poll; durable revision/high-water | Incomplete scan fails; cursor not promoted on failed scan | Source review only | Real subscriptions, late/missing events, poll overlap, account scopes and multi-instance recovery |
| Shopify stock publication | Compare/set, durable dispatch/ack/readback and mapping session lock | UNKNOWN_REMOTE_STATE / READBACK_PENDING / mismatch requires reconciliation | No fresh DB/provider publication test this turn | Genuine mapped stock write/readback, eventual consistency, account pacing and independent-provider latency |
| WooCommerce stock/ingress | Signed ingress and explicit listing quantity read/write/readback | Held uncertain publication reconciled by independent read | Source review only | Genuine permissions/schema, delivery, readback and lease race |
| Amazon MFN/SQS | SP-API stock patch/readback; queue accept/delete; full-shipment authority policy | ACK is separate from readback; partial shipment review remains separate | Controlled SQS poison/accept/delete fixture PASS | Genuine IAM/notifications, approved channel mappings, write/readback, provider revision semantics |
| Meta WhatsApp | Separate queue; accepted IDs and signed callbacks | Uncertain send does not imply failure or safe resend | Earlier current campaign mock/callback verifier PASS; not rerun for this matrix | Real sender/template/consent permissions, accepted/delivered callback, response-loss reconciliation |
| Flipkart | Probe/connection source; no complete central order lifecycle evidenced | Unsupported capability must remain blocked | No fresh provider request | Redacted approved schemas, permissions, pagination/recovery and stock contracts |
| Report-only/other marketplaces | Per-account/file or observation paths | Observations must not overwrite physical ledger | Source inventory only | Each provider's actual capability, data provenance and approved contracts |

## Retry and isolation observations

`reliability/provider-call.js` caps requested maxAttempts to 1–5 (default 3). Selected transient status/transport errors retry only when the caller marks retry safe. Authentication/validation/permanent errors and malformed transport responses do not receive generic retry. A circuit opens after five exhausted calls for 30 seconds; state is process-local and capped to 500 stored keys. Once that cap is reached, new keys are not retained, so stable breaker behavior for overflow origins is not proven.

The providerFetch circuit key is origin. Accounts sharing a provider origin may share a circuit within one process; separate processes do not share it. `inventory/rate-limit.js` provides PG account token-bucket pacing on selected connector paths; callers and all transports must be traced before claiming universal pacing. Retry-After seconds are capped to a five-second local sleep, so a provider's longer cooldown is not honored by this helper's immediate retry schedule. Durable worker backoff is a separate layer and does not establish account-wide cooldown.

Publication holds a DB session lock/connection across remote I/O. The worker's main inventory loop is sequential for the tenant. Bounded individual calls therefore do not establish provider isolation, request-class fairness or bounded end-to-end job duration. Test each layer rather than treating the transport timeout as the operation SLO.

## Required failure acceptance

| Injected condition | Expected safe result | Current evidence | Remaining control/proof |
|---|---|---|---|
| 429 for 20 minutes | Account paced, no amplification, unrelated work progresses | Capped retry source and historical/focused transport fixture only | Real-duration controlled campaign; durable cooldown and account fairness |
| Mutation accepted, response lost | UNKNOWN_REMOTE_STATE; readback before any resend | Publication/WhatsApp source state machines; no genuine provider proof | Crash/DB-fault fixture refresh plus provider readback contract |
| Provider latency ×20 / slow-drip | Bounded occupancy/deadline, provider isolation | Shared transport total per-attempt deadline; Meta overall deadline absent | Controlled transport timing plus pool/worker fairness measurements |
| 401/403/permanent validation | No unsafe automatic retry; capability visibly blocked | Source retry classification and focused injected-transport regression | Worker/account transition for every connector and genuine scope failure |
| Provider A down / A+B down | Local orders/ledger and independent providers continue safely | Separate jobs source; main outbox fairness gap remains | Sustained combined-fault and load campaign |
| Readback mismatch/unavailable | Explicit pending/reconciliation; no overwrite of physical truth | Source publication/readback state | Genuine eventual-consistency bounds, mismatch and restoration reconciliation |
| DNS/private destination/redirect | Reject unsafe destinations without leaking credentials | Guarded transport source; no exhaustive callers proof | Full controlled SSRF/DNS/redirect campaign and destination ownership inventory |

Runtime repairs: NOT IMPLEMENTED in Part 1. Real-provider/staging verification: NOT RUN. Production resilience remains BLOCKED.

## WhatsApp total deadline repair

whatsappFetch now shares a monotonic 20-second total budget across DNS lookup and response completion. A slow-drip response cannot extend the operation indefinitely by resetting socket inactivity. Timeout settles once and destroys the request; normal completion/error clears the timer. Interrupted responses reject explicitly. Fixed Meta origin, public DNS validation/pinning, 4 MB response cap, dispatch callback and queue uncertainty semantics remain in place. The third transport parameter is an internal injection seam; HTTP callers do not control it.

verify-whatsapp-total-deadline.mjs PASS: injected response emits bytes every 5 ms but hits a 40 ms total test deadline, destroys the request and reports one dispatch; stalled DNS hits a 20 ms test deadline without creating a request. Test deadlines override the production 20-second guardrail. No genuine Meta request was made. Files: inventory/whatsapp.js, new verifier and package.json test registration. Real provider latency and total sender-job budget remain open.

Existing verify-whatsapp-reliability.mjs also PASS after the change: preparation/pre-dispatch failures, post-dispatch uncertainty, acceptance persistence faults, 429/503 pending behavior, signed callbacks and OTP/consent/tenant boundaries. Sandbox listener attempt failed EPERM; approved local-listener rerun passed. Evidence uses injected provider/database responses, not real delivery.

2026-10-08 current-source regression refresh: fresh-store stock publication uncertainty and publication ordering suites PASS after bounded worker recovery integration. Injected Shopify/WooCommerce/Amazon responses preserve timeout/acknowledgement uncertainty, readback mismatch quarantine, mapping locks and no blind resend. Provider-authority dispatch suite PASS for review/evidence, alert timing and partial-shipment holds. These are actual PostgreSQL application-path fixtures with injected providers; live provider acceptance, long-duration outage/load and hosted recovery remain unverified.
