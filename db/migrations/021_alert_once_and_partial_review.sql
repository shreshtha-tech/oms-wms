BEGIN;
CREATE TABLE IF NOT EXISTS ci_order_alert_once (
 tenant_id text NOT NULL, order_id uuid NOT NULL, recipient_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,order_id,recipient_id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES ci_unified_order(tenant_id,id),
 FOREIGN KEY(tenant_id,recipient_id) REFERENCES ci_alert_recipient(tenant_id,id)
);
INSERT INTO ci_order_alert_once(tenant_id,order_id,recipient_id)
SELECT DISTINCT tenant_id,order_id,recipient_id FROM ci_order_alert ON CONFLICT DO NOTHING;
ALTER TABLE ci_unified_order DROP CONSTRAINT IF EXISTS ci_unified_order_work_status_check;
ALTER TABLE ci_unified_order ADD CONSTRAINT ci_unified_order_work_status_check
 CHECK(work_status IN ('new','accepted','packed','partially_shipped','dispatched','cancelled','returned'));
COMMIT;
