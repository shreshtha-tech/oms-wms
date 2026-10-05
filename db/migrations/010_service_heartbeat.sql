BEGIN;
CREATE TABLE IF NOT EXISTS ci_service_heartbeat (
 tenant_id text NOT NULL, service text NOT NULL, last_seen_at timestamptz NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(tenant_id,service)
);
COMMIT;
