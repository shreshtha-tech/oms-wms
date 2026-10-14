BEGIN;

-- Keep one sanitized, mapping-specific publication/readback record on each
-- durable outbox command. The historical mapping identity is snapshotted before
-- a provider mutation so later mapping edits do not rewrite the evidence.
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS publication_state text;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS provider_platform text;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS internal_sku_id uuid;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS external_sku text;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS provider_listing_id text;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS internal_location_id uuid;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS provider_location_id text;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS pack_size integer;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS source_event_id uuid;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS expected_quantity bigint;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS provider_response_reference text;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS readback_quantity bigint;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS readback_at timestamptz;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS reconciliation_result text;

ALTER TABLE ci_outbox DROP CONSTRAINT IF EXISTS ci_outbox_publication_state_check;
ALTER TABLE ci_outbox ADD CONSTRAINT ci_outbox_publication_state_check CHECK (
  publication_state IS NULL OR publication_state IN (
    'READY','SENDING','ACKNOWLEDGED','READBACK_PENDING','RECONCILED','MISMATCH',
    'RETRYABLE_FAILURE','AUTH_FAILURE','UNKNOWN_REMOTE_STATE','REQUIRES_RECONCILIATION',
    'BLOCKED_MAPPING','BLOCKED_LOCATION','BLOCKED_CAPABILITY'
  )
);
ALTER TABLE ci_outbox DROP CONSTRAINT IF EXISTS ci_outbox_pack_size_check;
ALTER TABLE ci_outbox ADD CONSTRAINT ci_outbox_pack_size_check CHECK (pack_size IS NULL OR pack_size > 0);

CREATE INDEX IF NOT EXISTS ci_outbox_publication_attention
  ON ci_outbox(tenant_id,publication_state,id DESC)
  WHERE task_type='publish_stock' AND publication_state IS NOT NULL;

COMMIT;
