BEGIN;
CREATE TABLE IF NOT EXISTS ci_import_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
  mode text NOT NULL CHECK(mode IN ('catalog','counts')), file_name text NOT NULL,
  file_sha256 text NOT NULL, rows jsonb NOT NULL, summary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','committed')),
  created_at timestamptz NOT NULL DEFAULT now(), committed_at timestamptz, result jsonb,
  UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ci_stock_observation (
  tenant_id text NOT NULL, account_id uuid NOT NULL, external_item_id text NOT NULL,
  external_location_id text NOT NULL, sku text NOT NULL, quantities jsonb NOT NULL,
  match_status text NOT NULL, observed_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,account_id,external_item_id,external_location_id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES ci_channel_account(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS ci_observation_sku ON ci_stock_observation(tenant_id,sku);
COMMIT;
