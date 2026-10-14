# Integration patterns

Status: research synthesis completed within the scope in completion-audit.md. Current official-contract refresh is bounded to the cited pages; a complete provider integration audit remains open.

| Integration | Source/contract evidence | What it establishes | Outstanding proof |
|---|---|---|---|
| Shopify | UP-006 validator/tests; LOC-002 inbox; DOC-001 official overview | Raw-body HMAC and headers; delivery deduplication; out-of-order/missed deliveries require reconciliation | Full pagination/version/scope/rate contract, revision tie handling, configured webhook registration and full reconciliation |
| Flipkart | LOC-014 and DOC-002 | Local constrained cursor traversal and grouped item observation match general paginated shipment contract; types are preDispatch/postDispatch/cancelled | Every filter/state/date constraint, server cap behavior, Advantage exclusions, full account history/completeness and configured readback |
| WooCommerce | UP-012 sender HMAC/delivery ID; inventory/http.js callback; LOC-015 readiness | Signed intake with durable delivery digest; refund status observation is not physical return intake | Missing-event recovery polling, full stock reconciliation, webhook disable/retry contract and matching tests |
| Amazon | LOC-007 provider dispatch gates; LOC-015 queue setup gap; DOC-003 quota dimensions | Existing notification processing is distinct from verified account-level queue onboarding; account/operation quotas require contract-specific scheduling | IAM/SQS subscription/visibility/deletion, order/listing endpoint contracts, PII/RDT applicability, full SKU coverage |
| Other channels | Connection samples identified in historical docs only | No new current complete integration claim | Discover each actual adapter and official API before recommending writes |

Durable intake pattern: authenticate raw event → bind exact provider account/tenant → validate identity/shape → transactionally record receipt+safe observation+outbox → acknowledge accepted intake → worker validates mapped stock transition → ledger transaction → provider work with durable attempt identity → independent readback/reconciliation (LOC-001/002/007). HTTP 202 proves acceptance, not final stock or fulfillment commitment.

Never collapse credentials verified, sample response observed, webhook registered, delivery accepted, worker healthy, order history complete, publication acknowledged and reconciled quantity into one Connected boolean (LOC-015). Poll overlap must use stable business/item IDs and provider revision semantics; pagination cursor validation protects both completeness and token forwarding (LOC-014).

Shopify explicitly documents no guaranteed ordering and recommends API reconciliation (DOC-001). The generic provider retry wrapper has process-local circuits and a five-second cap on numeric Retry-After (LOC-008); this must be compared with each actual operation contract before claiming compliant quota handling. Amazon inbound documentation illustrates multiple quota scopes, but its numeric quotas must not be copied to Orders or Listings operations (DOC-003).

Candidate recommendations: preserve inbox/outbox and uncertainty records (R-02/R-03); finish per-provider contract and full-history acceptance (R-04). Authentication helper adoption alone cannot create a durable marketplace integration (UP-006).
