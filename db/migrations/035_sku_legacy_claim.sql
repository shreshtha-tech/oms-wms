BEGIN;

ALTER TABLE ci_sku_projection_outbox ADD COLUMN IF NOT EXISTS legacy_claim jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ci_sku_projection_outbox'::regclass AND conname='ci_sku_projection_legacy_claim_check') THEN
    ALTER TABLE ci_sku_projection_outbox ADD CONSTRAINT ci_sku_projection_legacy_claim_check CHECK (
      legacy_claim IS NULL OR (
        jsonb_typeof(legacy_claim)='object' AND
        length(legacy_claim->>'id') BETWEEN 1 AND 120 AND
        (legacy_claim->>'digest') ~ '^[a-f0-9]{64}$'
      )
    );
  END IF;
END $$;

COMMIT;
