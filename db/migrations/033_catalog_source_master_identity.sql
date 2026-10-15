BEGIN;

-- Retain the original source SKU while linking it to the physical master.
ALTER TABLE ci_catalog_source_row ADD COLUMN IF NOT EXISTS master_sku_id uuid;
UPDATE ci_catalog_source_row r SET master_sku_id=s.id
  FROM ci_master_sku s
  WHERE s.tenant_id=r.tenant_id AND s.sku=r.sku AND r.master_sku_id IS NULL;
ALTER TABLE ci_catalog_source_row ALTER COLUMN master_sku_id SET NOT NULL;
ALTER TABLE ci_catalog_source_row DROP CONSTRAINT IF EXISTS ci_catalog_source_row_tenant_id_sku_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ci_catalog_source_row'::regclass AND conname='ci_catalog_source_row_master_identity_fkey') THEN
    ALTER TABLE ci_catalog_source_row ADD CONSTRAINT ci_catalog_source_row_master_identity_fkey
      FOREIGN KEY (tenant_id,master_sku_id) REFERENCES ci_master_sku(tenant_id,id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ci_catalog_source_master_idx
  ON ci_catalog_source_row(tenant_id,master_sku_id,imported_at DESC);

COMMIT;
