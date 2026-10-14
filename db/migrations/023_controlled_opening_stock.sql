BEGIN;

-- NULL means that opening-stock eligibility has not been verified. Do not
-- infer active status from a historical catalog or an existing location row.
ALTER TABLE ci_master_sku ADD COLUMN IF NOT EXISTS opening_stock_active boolean;
ALTER TABLE ci_master_sku ADD COLUMN IF NOT EXISTS opening_stock_verified_at timestamptz;
ALTER TABLE ci_master_sku ADD COLUMN IF NOT EXISTS opening_stock_verified_by text;
ALTER TABLE ci_location ADD COLUMN IF NOT EXISTS opening_stock_active boolean;
ALTER TABLE ci_location ADD COLUMN IF NOT EXISTS opening_stock_verified_at timestamptz;
ALTER TABLE ci_location ADD COLUMN IF NOT EXISTS opening_stock_verified_by text;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ci_master_opening_verified') THEN
  ALTER TABLE ci_master_sku ADD CONSTRAINT ci_master_opening_verified CHECK
   (opening_stock_active IS NULL OR (opening_stock_verified_at IS NOT NULL AND nullif(opening_stock_verified_by,'') IS NOT NULL));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ci_location_opening_verified') THEN
  ALTER TABLE ci_location ADD CONSTRAINT ci_location_opening_verified CHECK
   (opening_stock_active IS NULL OR (opening_stock_verified_at IS NOT NULL AND nullif(opening_stock_verified_by,'') IS NOT NULL));
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS ci_opening_stock_batch (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 source_reference text NOT NULL,
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 file_name text NOT NULL,
 file_bytes bigint NOT NULL CHECK(file_bytes>0),
 source_date date NOT NULL,
 mapping_version text NOT NULL,
 mapping_sha256 text NOT NULL CHECK(mapping_sha256 ~ '^[a-f0-9]{64}$'),
 row_digest text NOT NULL CHECK(row_digest ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN
  ('DRAFT','VALIDATED','AWAITING_APPROVAL','APPROVED','POSTING','POSTED','RECONCILED','FAILED_RETRYABLE','REQUIRES_RECONCILIATION')),
 rows_read integer NOT NULL CHECK(rows_read>=0),
 rows_valid integer NOT NULL CHECK(rows_valid>=0),
 validation_summary jsonb NOT NULL,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 validated_at timestamptz,
 approval_requested_at timestamptz,
 approved_by text,
 approved_at timestamptz,
 posted_by text,
 posting_started_at timestamptz,
 posted_at timestamptz,
 reconciled_at timestamptz,
 result jsonb,
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,source_reference),
 UNIQUE(tenant_id,file_sha256,mapping_version,source_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS ci_inventory_event_tenant_id_unique ON ci_inventory_event(tenant_id,id);
CREATE TABLE IF NOT EXISTS ci_opening_stock_line (
 tenant_id text NOT NULL,
 batch_id uuid NOT NULL,
 sheet_name text NOT NULL,
 source_row integer NOT NULL CHECK(source_row>0),
 master_sku_id uuid NOT NULL,
 location_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>=0),
 uom text NOT NULL,
 event_id uuid,
 PRIMARY KEY(tenant_id,batch_id,sheet_name,source_row),
 UNIQUE(tenant_id,batch_id,master_sku_id,location_id),
 FOREIGN KEY(tenant_id,batch_id) REFERENCES ci_opening_stock_batch(tenant_id,id),
 FOREIGN KEY(tenant_id,master_sku_id) REFERENCES ci_master_sku(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES ci_location(tenant_id,id),
 FOREIGN KEY(tenant_id,event_id) REFERENCES ci_inventory_event(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS ci_opening_stock_audit (
 id bigserial PRIMARY KEY,
 tenant_id text NOT NULL,
 batch_id uuid NOT NULL,
 from_status text,
 to_status text NOT NULL,
 actor text NOT NULL,
 reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,batch_id) REFERENCES ci_opening_stock_batch(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS ci_opening_stock_audit_batch ON ci_opening_stock_audit(tenant_id,batch_id,id);

COMMIT;
