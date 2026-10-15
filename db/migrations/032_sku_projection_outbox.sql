BEGIN;

ALTER TABLE ci_sku_alias
  ADD COLUMN IF NOT EXISTS projection_revision bigint NOT NULL DEFAULT 0
    CHECK (projection_revision >= 0);

CREATE TABLE IF NOT EXISTS ci_sku_projection_outbox (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  alias_sku text NOT NULL,
  master_sku_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','retry','done','held','dead','unknown_remote')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  lease_until timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,alias_sku,revision),
  FOREIGN KEY (tenant_id,alias_sku) REFERENCES ci_sku_alias(tenant_id,alias_sku),
  FOREIGN KEY (tenant_id,master_sku_id) REFERENCES ci_master_sku(tenant_id,id)
);

CREATE INDEX IF NOT EXISTS ci_sku_projection_pending_idx
  ON ci_sku_projection_outbox (tenant_id,available_at,id)
  WHERE status IN ('pending','retry');

CREATE INDEX IF NOT EXISTS ci_sku_projection_expired_idx
  ON ci_sku_projection_outbox (tenant_id,lease_until,id)
  WHERE status='processing';

COMMIT;
