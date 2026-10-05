BEGIN;
ALTER TABLE ci_unified_order ADD COLUMN IF NOT EXISTS provider_updated_at timestamptz;
CREATE INDEX IF NOT EXISTS ci_unified_order_provider_updated ON ci_unified_order(tenant_id,account_id,provider_updated_at DESC);
CREATE INDEX IF NOT EXISTS ci_ingress_source_received ON ci_ingress(tenant_id,source,received_at DESC);
COMMIT;
