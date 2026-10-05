BEGIN;
CREATE TABLE IF NOT EXISTS ci_alert_rule (
  tenant_id text NOT NULL,
  master_sku_id uuid NOT NULL,
  threshold bigint NOT NULL CHECK (threshold >= 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, master_sku_id),
  FOREIGN KEY (tenant_id, master_sku_id) REFERENCES ci_master_sku(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS ci_stock_alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  master_sku_id uuid NOT NULL,
  threshold bigint NOT NULL,
  sellable bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY (tenant_id, master_sku_id) REFERENCES ci_master_sku(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ci_stock_alert_one_open ON ci_stock_alert(tenant_id, master_sku_id) WHERE status='open';
COMMIT;
