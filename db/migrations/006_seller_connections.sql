BEGIN;
ALTER TABLE ci_channel_account ADD COLUMN IF NOT EXISTS connection_state text NOT NULL DEFAULT 'not_connected';
ALTER TABLE ci_channel_account ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE ci_channel_account ADD COLUMN IF NOT EXISTS verification jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ci_channel_account ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS ci_connection_oauth (
 state_hash text PRIMARY KEY, tenant_id text NOT NULL, platform text NOT NULL,
 browser_hash text NOT NULL, encrypted_credentials bytea NOT NULL, credential_iv bytea NOT NULL,
 credential_tag bytea NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS ci_sync_attempt (
 id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id uuid NOT NULL,
 direction text NOT NULL, operation text NOT NULL, sku_count integer NOT NULL DEFAULT 0,
 status text NOT NULL CHECK(status IN ('running','success','failed')), diagnostic jsonb NOT NULL DEFAULT '{}',
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(tenant_id,account_id) REFERENCES ci_channel_account(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS ci_sync_attempt_account ON ci_sync_attempt(tenant_id,account_id,started_at DESC);
CREATE TABLE IF NOT EXISTS ci_connection_location (
 tenant_id text NOT NULL, account_id uuid NOT NULL, external_location_id text NOT NULL,
 internal_location_id uuid NOT NULL, PRIMARY KEY(tenant_id,account_id,external_location_id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES ci_channel_account(tenant_id,id),
 FOREIGN KEY(tenant_id,internal_location_id) REFERENCES ci_location(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ci_agent_pairing (
 code_hash text PRIMARY KEY, tenant_id text NOT NULL, account_id uuid NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 FOREIGN KEY(tenant_id,account_id) REFERENCES ci_channel_account(tenant_id,id)
);
COMMIT;
