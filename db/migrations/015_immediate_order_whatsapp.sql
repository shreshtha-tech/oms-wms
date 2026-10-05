BEGIN;
CREATE TABLE IF NOT EXISTS ci_whatsapp_cutover (
 id text PRIMARY KEY,
 applied_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM ci_whatsapp_cutover WHERE id='immediate_order_alerts_2026_09') THEN
  -- Older new_order rows represented packing alerts and could be days old.
  -- Do not send them as fresh order notifications after this behavior changes.
  UPDATE ci_order_alert
  SET status='cancelled',last_error='Superseded by immediate order alert; historical packing alert was not sent'
  WHERE event_type='new_order' AND status='pending';
  INSERT INTO ci_whatsapp_cutover(id) VALUES('immediate_order_alerts_2026_09');
 END IF;
END $$;
COMMIT;
