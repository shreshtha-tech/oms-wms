# Configured Atlas failure boundary — 2026-10-04

**Configured MongoDB is unavailable. PRODUCTION READY = NO. COMPLETION = UNPROVEN.** All probes used the existing private configuration. No configured collection, account, credential, access list, balance or business record was changed. Local fixture MongoDB results are unrelated to this configured data-plane status.

| Boundary | Current evidence | Conclusion |
|---|---|---|
| URI/environment | Existing mongodb+srv URI parses in Mongo driver 6.21.0; configured DB and credential objects present; no outer whitespace; TLS enabled | Syntax/config loading are observed. Presence is not credential validity |
| DNS | SRV resolves three endpoints; TXT resolves; all three endpoints resolve IPv4 addresses | This run is not blocked by SRV/TXT/host resolution |
| TCP | All three endpoints accept a TCP connection, observed in 38–61 ms | This run is not blocked by TCP connection refusal or timeout |
| SNI/TLS | Correct endpoint SNI supplied, certificate verification enabled; default, TLS 1.2-only and TLS 1.3-only Node handshakes all fail with ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR / alert 80 | Failure occurs at TLS negotiation, not after authenticated database access |
| Independent TLS implementation | System LibreSSL sends ClientHello to all three endpoints; no ServerHello or peer certificate is received; handshake exits unsuccessfully | Failure reproduces without the Node driver. A Node-driver-only root cause is not supported by this observation |
| General local TLS control | Official MongoDB public HTTPS handshake succeeds with certificate verification and TLS 1.3 | Local TLS/trust works for the control endpoint; this does not certify Atlas's unreceived certificate |
| Certificate/CA/hostname validation | Atlas sends no peer certificate in the independent trace | Certificate validation cannot complete. Do not diagnose an expired/untrusted Atlas certificate from this evidence |
| Authentication | Driver cannot establish TLS; authenticated ping fails | Username/password correctness and privileges remain unverified; no authentication failure was demonstrated |
| Server selection | MongoServerSelectionError after 8-second configured deadline, with TLS failures on every candidate | Selection timeout is a downstream symptom of the TLS boundary |
| Configured database/tenant/persistence | Not reached | Operational collections, configured tenant and application/browser persistence remain unverified |
| Atlas cluster/access list/network policy | No authenticated Atlas management interface is available in the current tools | Running cluster, correct project, exact host egress access-list entry, private/public connection mode, endpoint policy and possible security interception need owner-side verification |

Evidence:

- `tmp/mongo-reliability/configured-mongo-boundary-2026-10-04.json`
- `tmp/mongo-reliability/configured-mongo-system-tls-2026-10-04.json`
- `tmp/mongo-reliability/public-tls-control-2026-10-04.json`

The TLS alert does **not** establish that the password is wrong, that the access list is wrong, or that a specific cipher/CA is wrong. The narrower verified result is DNS and TCP success followed by failure before ServerHello/certificate and authentication.

## Required owner-side verification

1. In the correct Atlas project, confirm the configured cluster is running, not paused/deleted, and corresponds to the existing private connection configuration.
2. Inspect Database & Network Access / Network Access. Confirm the application's **current outbound egress IP**, including any VPN/NAT or hosted deployment egress, is permitted by a narrow approved entry. A laptop's local/LAN IP and a hosted server's egress are not interchangeable. Do not open access to all addresses merely to make this test pass.
3. Confirm the URI uses the project's intended public/private endpoint mode. Check Atlas project/cluster events and connection diagnostics around the evidence timestamp; involve the network administrator if TLS inspection/firewall policy applies to the database port.
4. Compare the same read-only diagnostic from an already approved host/network. This separates a local network path/policy from the cluster-side setting; it does not require revealing credentials.
5. After TLS succeeds, verify the database user's intended auth source, account permissions and configured database privately. Do not rotate or replace credentials merely because an unauthenticated handshake failed.
6. Rerun `node scripts/probe-configured-mongo-boundary.mjs` on supported Node. Require `authenticatedPing: true`; then verify configured collections/tenant and API/browser persistence separately. Do not disable certificate or hostname verification.

Atlas requires the client's IP to be in its project access list and documents DNS, network, cluster and credential checks separately. Those are investigation branches, not causes established by this trace. [Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/), [Atlas IP access lists](https://www.mongodb.com/docs/atlas/security/ip-access-list/).
