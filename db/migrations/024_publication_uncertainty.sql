BEGIN;

-- A worker records intent before a provider mutation. If the worker disappears
-- before local acknowledgement, lease recovery must hold the task for readback.
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS remote_attempt_started_at timestamptz;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS remote_target_quantity bigint;
ALTER TABLE ci_outbox ADD COLUMN IF NOT EXISTS remote_request_id text;
ALTER TABLE ci_channel_stock ADD COLUMN IF NOT EXISTS readback_quantity bigint;
ALTER TABLE ci_channel_stock ADD COLUMN IF NOT EXISTS readback_at timestamptz;
CREATE INDEX IF NOT EXISTS ci_outbox_remote_uncertain ON ci_outbox(tenant_id,mapping_id,status)
 WHERE task_type='publish_stock' AND remote_attempt_started_at IS NOT NULL;

COMMIT;
