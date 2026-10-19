BEGIN;

ALTER TABLE ci_master_sku ADD COLUMN IF NOT EXISTS merge_in_progress boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ci_master_sku'::regclass AND conname='ci_master_merge_state_check') THEN
    ALTER TABLE ci_master_sku ADD CONSTRAINT ci_master_merge_state_check
      CHECK (merged_into_id IS NULL OR merge_in_progress=false);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ci_variant_merge_audit (
  tenant_id text NOT NULL,
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('applying','done')),
  source_opening jsonb NOT NULL,
  target_opening jsonb NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id,source_id),
  FOREIGN KEY (tenant_id,source_id) REFERENCES ci_master_sku(tenant_id,id),
  FOREIGN KEY (tenant_id,target_id) REFERENCES ci_master_sku(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS ci_variant_backfill_plan (
  tenant_id text NOT NULL,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
  plan_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,plan_hash)
);

COMMIT;
