BEGIN;

ALTER TABLE ci_master_sku
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS size text,
  ADD COLUMN IF NOT EXISTS pool_label text,
  ADD COLUMN IF NOT EXISTS attr_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS merged_into_id uuid,
  ADD COLUMN IF NOT EXISTS variant_key text GENERATED ALWAYS AS (
    CASE WHEN category IS NOT NULL AND product_type IS NOT NULL AND color IS NOT NULL AND size IS NOT NULL
      THEN category||'|'||product_type||'|'||color||'|'||size||coalesce('|'||pool_label,'')
    END
  ) STORED;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ci_master_sku_attr_status_check') THEN
    ALTER TABLE ci_master_sku ADD CONSTRAINT ci_master_sku_attr_status_check
      CHECK (attr_status IN ('legacy','parsed','verified','review'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ci_master_sku_merge_target_fkey') THEN
    ALTER TABLE ci_master_sku ADD CONSTRAINT ci_master_sku_merge_target_fkey
      FOREIGN KEY (tenant_id,merged_into_id) REFERENCES ci_master_sku(tenant_id,id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ci_master_variant_unique
  ON ci_master_sku (tenant_id,variant_key)
  WHERE variant_key IS NOT NULL AND merged_into_id IS NULL;

CREATE TABLE IF NOT EXISTS ci_attribute_value (
  tenant_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('brand','category','type','color','size')),
  code text NOT NULL,
  label text,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id,kind,code)
);

CREATE TABLE IF NOT EXISTS ci_attribute_alias (
  tenant_id text NOT NULL,
  kind text NOT NULL,
  alias_norm text NOT NULL,
  code text NOT NULL,
  PRIMARY KEY (tenant_id,kind,alias_norm),
  FOREIGN KEY (tenant_id,kind,code) REFERENCES ci_attribute_value(tenant_id,kind,code)
);

CREATE TABLE IF NOT EXISTS ci_sku_alias (
  tenant_id text NOT NULL,
  alias_sku text NOT NULL,
  master_sku_id uuid NOT NULL,
  brand text,
  source text NOT NULL CHECK (source IN ('parsed','import','legacy_master','manual')),
  parse_result jsonb,
  PRIMARY KEY (tenant_id,alias_sku),
  FOREIGN KEY (tenant_id,master_sku_id) REFERENCES ci_master_sku(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS ci_sku_noise_rule (
  tenant_id text NOT NULL,
  platform text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('prefix','suffix')),
  token_norm text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id,platform,kind,token_norm)
);

ALTER TABLE ci_channel_account ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE ci_unified_order_line ADD COLUMN IF NOT EXISTS brand text;

COMMIT;
