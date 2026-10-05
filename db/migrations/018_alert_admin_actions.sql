BEGIN;
CREATE TABLE IF NOT EXISTS ci_alert_admin_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
 operator text NOT NULL, action text NOT NULL, subject_id uuid NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ci_alert_admin_audit_subject ON ci_alert_admin_audit(tenant_id,subject_id,created_at);
CREATE TABLE IF NOT EXISTS ci_alert_test_attempt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, request_id uuid NOT NULL,
 team_id uuid NOT NULL, recipient_id uuid NOT NULL, operator text NOT NULL,
 status text NOT NULL CHECK(status IN ('sending','accepted','failed','uncertain')),
 last_error text, provider_message_id text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_id), FOREIGN KEY(tenant_id,team_id) REFERENCES ci_alert_team(tenant_id,id),
 FOREIGN KEY(tenant_id,recipient_id) REFERENCES ci_alert_recipient(tenant_id,id)
);
COMMIT;
