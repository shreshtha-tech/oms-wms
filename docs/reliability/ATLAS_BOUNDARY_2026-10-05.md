# Configured Atlas continuation — 2026-10-05

{
  "date": "2026-10-05",
  "status": "BLOCKED_ON_CONFIGURED_ATLAS_TLS_BEFORE_AUTHENTICATION",
  "productionReady": false,
  "configuredValuesChanged": false,
  "credentialValuesPrinted": false,
  "runtime": {
    "node": "v24.21.0",
    "httpRoot": 200,
    "authSessionEndpoint": 200,
    "loginConfigured": true,
    "postgres": "READY",
    "readiness": 503,
    "mongodb": "DEGRADED"
  },
  "mongoProbe": {
    "file": "tmp/mongo-reliability/configured-mongo-boundary-current.log",
    "readOnly": true,
    "uriPresent": true,
    "uriWhitespace": false,
    "driverTlsEnabled": true,
    "tlsVerificationDisabled": false,
    "srvResolved": true,
    "endpointCount": 3,
    "allEndpointDns": true,
    "allEndpointTcp": true,
    "allTlsProtocols": "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR",
    "tlsAlert": "80",
    "authenticatedPing": false,
    "failureBoundary": "before ServerHello/certificate and before Mongo authentication"
  },
  "impact": {
    "wmsZone": "api/wms-zones.js reads generic_records via the shared Mongo manager; it correctly returns the dependency-unavailable response when Atlas cannot connect",
    "staticDependencyMap": {
      "sourceFiles": 771,
      "mongoDependent": 215,
      "postgresDependent": 300,
      "both": 215,
      "mongoOnly": 0,
      "postgresOnly": 85,
      "evidenceLimit": "Static dependency trace; not a count of runtime failures. The 85 PostgreSQL-only source modules still use shared PostgreSQL authentication."
    }
  },
  "repairAssessment": "No safe repository-side fallback can serve legacy Mongo records while the configured Atlas TLS handshake fails. Do not disable certificate validation or silently switch legacy data to memory/PostgreSQL. The central manager already retries with bounded backoff and routes fail closed.",
  "requiredOwnerAction": [
    "Check the correct Atlas project and cluster status/events for the probe time.",
    "Have the network/Atlas owner investigate why all three Atlas nodes accept TCP but send TLS alert 80 before certificate exchange; compare from another already-approved network and check for TLS inspection.",
    "Keep TLS certificate verification enabled and do not broadly allow network access.",
    "After TLS succeeds, rerun the sanitized probe and require authenticatedPing=true, then check tenant data and screen persistence."
  ],
  "evidenceLayer": "Current local configured-connection diagnostic plus local HTTP health responses; no Atlas management access, provider authentication, configured data readback, deployment or browser end-to-end verification."
}


## Post-fix recovery evidence — 2026-10-05

The earlier TLS-failure JSON above is a preserved pre-fix snapshot. The fresh recovery record supersedes its connection status for this probe; see `tmp/mongo-reliability/configured-mongo-boundary-after-user-fix.log`.

```json
{
  "date": "2026-10-05",
  "status": "RECOVERED_CONFIGURED_TLS_AND_AUTHENTICATED_PING",
  "configuredValuesChanged": false,
  "credentialValuesPrinted": false,
  "mongoProbe": {
    "runtime": "v24.21.0",
    "readOnly": true,
    "tlsVerificationDisabled": false,
    "srvResolved": true,
    "endpointCount": 3,
    "allEndpointDns": true,
    "allEndpointTcp": true,
    "allEndpointTlsVerified": true,
    "tlsProtocol": "TLSv1.3",
    "authenticatedPing": true,
    "configuredDatabaseSelected": true,
    "probeLog": "tmp/mongo-reliability/configured-mongo-boundary-after-user-fix.log"
  },
  "liveServer": {
    "liveness": "HTTP 200",
    "readiness": "HTTP 200",
    "mongodb": "READY",
    "postgres": "READY",
    "recoveredWithoutRestart": true,
    "readinessRequestId": "79dd278c-1f7f-4521-b8bd-17fc78ced883"
  },
  "wmsZone": {
    "layer": "Authenticated HTTP using a synthetic administrator and disposable local PostgreSQL; read-only requests against configured MongoDB",
    "metadataStatus": 200,
    "locations": 0,
    "bins": 0,
    "pickers": 0,
    "searchStatus": 200,
    "zoneRows": 0,
    "log": "tmp/mongo-reliability/wms-read-recovery-current.log"
  },
  "configuredMongoCollections": {
    "allRelevantApplicationCollectionsAbsent": true,
    "collections": [
      "generic_records",
      "admin_records",
      "partners",
      "skus",
      "vendors",
      "purchase_orders",
      "sales_orders"
    ],
    "log": "tmp/mongo-reliability/configured-mongo-collection-inventory-current.log"
  },
  "interpretation": "The outage is repaired at the current configured TLS/connection boundary. The selected Mongo database currently has no relevant application collections; successful reads return empty results. No guessed/seed records were inserted. Correct business database/tenant selection or authoritative data restore/setup must be confirmed before claiming website data is restored.",
  "productionReady": false,
  "remaining": "Configured application identity/tenant correctness, legacy dataset restoration, module-by-module populated workflows, provider and hosted/deployment proof remain incomplete."
}
```

## Collection spelling correction

The preserved recovery snapshot above lists `sales_orders`. Source review confirms the application collection is `sale_orders`. The earlier seven-name check therefore did not directly check the correct order collection name; later visible database inventory found only `_counters`, but visibility remains bounded by the identity's permissions. Neither observation proves a fresh setup or identifies the authoritative business data source.
