# Operational controls

`/health/live` reports process availability independently of databases. `/health/ready` verifies required configured dependencies. `/api/health/databases`, `/api/health/metrics` and `/api/health/operations` require the existing administrator session. Their responses omit credentials, payloads and provider hostnames.

The operations endpoint reads real tenant-scoped outbox depth, dead letters, queue age and worker heartbeat. It returns 503 if monitoring queries fail rather than inventing zero values. Request metrics use matched route patterns and safe request IDs. Database/provider logs classify failures without serializing raw error messages or credentials.

Configure external monitoring to scrape internal metrics and alert on these thresholds: required database unavailable for 30 seconds; five or more pool waiters; 5xx above 2% for 5 minutes; 429 above 5% for 5 minutes; provider timeouts above 5%; more than 100 queued jobs; oldest queued work above 5 minutes; any dead letter; worker heartbeat older than 90 seconds. Thresholds are starting operational policies, not capacity-tested service level objectives. Inventory drift must be investigated against the authoritative ledger rather than automatically corrected from provider quantities.

Metrics are process-local counters. An external time-series system and notification destination must be configured to retain history and deliver operational alerts. No external alert messages are sent by this change. Provider verification and credential/Atlas access remediation remain deployment prerequisites.

Database writes are not retried by the pool. A lost acknowledgement can imply an unknown commit outcome; the business operation must reuse its durable key or require reconciliation. WhatsApp retains uncertain send outcomes for review and never blindly resends them. Provider read retries are bounded and classified; POST/mutation retries require explicit safety and are disabled by default.

Deploy migrations with `npm run inventory:migrate` as an explicit deployment step. HTTP startup and local `npm run dev` do not apply schema automatically. The Render pre-deploy command separates migration execution from web startup; verify provider deployment support before rollout. Migration 019 adds only the login rate-limit table and index. Roll back application code while leaving that additive table intact. Do not drop operational records during rollback.

Shutdown marks readiness unavailable, stops new connections, drains active requests, closes idle connections and pools, with a 30-second deadline. Workers use the existing tenant lease/outbox recovery protections and a bounded supervisor shutdown. A forced timeout does not assert that in-flight business mutations failed: replay/reconcile using their persisted identity.

The Render blueprint enables `TRUST_PROXY=true`, which trusts exactly one proxy hop. Local development does not trust forwarded client addresses by default. For another hosting topology, verify trusted ingress before enabling this setting. Liveness stays successful while the process drains; readiness declines.

Readiness checks `ci_auth_session`, `ci_login_rate_limit` and `ci_outbox` presence as well as database connectivity. `SCHEMA_UNAVAILABLE` requires completing the explicit migration step; it must not be treated as a successful deployment. PostgreSQL transport/deadline errors return 503/504, and raw SQL constraint details are not returned to clients. Mongo query deadline codes 50/262 return 504 without forcing reconnection of an otherwise healthy pool.
