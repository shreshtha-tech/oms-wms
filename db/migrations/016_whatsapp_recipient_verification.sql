BEGIN;
ALTER TABLE ci_alert_recipient ADD COLUMN IF NOT EXISTS verified_at timestamptz;
CREATE TABLE IF NOT EXISTS ci_whatsapp_verification_cutover (
 id text PRIMARY KEY,
 applied_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM ci_whatsapp_verification_cutover WHERE id='require_verified_recipient_2026_09') THEN
  UPDATE ci_order_alert
  SET status='cancelled',last_error='Recipient verification required; historical pending alert was not sent'
  WHERE status='pending';
  UPDATE ci_alert_recipient SET active=false WHERE verified_at IS NULL;
  INSERT INTO ci_whatsapp_verification_cutover(id) VALUES('require_verified_recipient_2026_09');
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS ci_recipient_verification (
 recipient_id uuid PRIMARY KEY REFERENCES ci_alert_recipient(id) ON DELETE CASCADE,
 tenant_id text NOT NULL,
 challenge_id uuid NOT NULL,
 code_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('sending','sent','verified','failed','locked')),
 attempts integer NOT NULL DEFAULT 0,
 requested_at timestamptz NOT NULL DEFAULT now(),
 provider_message_id text,
 window_start timestamptz NOT NULL DEFAULT now(),
 window_count integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ci_recipient_verification_tenant ON ci_recipient_verification(tenant_id,recipient_id);
COMMIT;
