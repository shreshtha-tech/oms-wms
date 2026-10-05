BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS ci_alert_recipient_tenant_identity ON ci_alert_recipient(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS ci_unified_order_tenant_identity ON ci_unified_order(tenant_id,id);
CREATE TABLE IF NOT EXISTS ci_alert_team (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120), description text NOT NULL DEFAULT '',
 kind text NOT NULL DEFAULT 'packing' CHECK(kind IN ('packing','informational')),
 instruction text NOT NULL DEFAULT 'Review observed order', active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,name), UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ci_alert_team_member (
 tenant_id text NOT NULL, team_id uuid NOT NULL, recipient_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,team_id,recipient_id),
 FOREIGN KEY(tenant_id,team_id) REFERENCES ci_alert_team(tenant_id,id),
 FOREIGN KEY(tenant_id,recipient_id) REFERENCES ci_alert_recipient(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ci_alert_sku_group (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,name), UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ci_alert_sku_group_member (
 tenant_id text NOT NULL, group_id uuid NOT NULL, master_sku_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,group_id,master_sku_id),
 FOREIGN KEY(tenant_id,group_id) REFERENCES ci_alert_sku_group(tenant_id,id),
 FOREIGN KEY(tenant_id,master_sku_id) REFERENCES ci_master_sku(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ci_alert_team_rule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, team_id uuid NOT NULL,
 platform text, programme text, account_id uuid, location_id uuid, sku_prefix text, sku_group_id uuid,
 payment_mode text, source_type text CHECK(source_type IN ('live','report')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,team_id) REFERENCES ci_alert_team(tenant_id,id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES ci_channel_account(tenant_id,id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES ci_location(tenant_id,id),
 FOREIGN KEY(tenant_id,sku_group_id) REFERENCES ci_alert_sku_group(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS ci_alert_team_rule_lookup ON ci_alert_team_rule(tenant_id,team_id);
ALTER TABLE ci_order_alert ADD COLUMN IF NOT EXISTS team_id uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='ci_order_alert_team_tenant_fk' AND conrelid='ci_order_alert'::regclass) THEN
  ALTER TABLE ci_order_alert ADD CONSTRAINT ci_order_alert_team_tenant_fk FOREIGN KEY(tenant_id,team_id) REFERENCES ci_alert_team(tenant_id,id);
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ci_team_alert_once_per_order ON ci_order_alert(tenant_id,order_id,recipient_id) WHERE team_id IS NOT NULL;
-- Persist intake facts, not a second programme identity. Programme comes from ci_program_order.
CREATE TABLE IF NOT EXISTS ci_order_alert_source (
 tenant_id text NOT NULL, order_id uuid NOT NULL,
 source_type text NOT NULL CHECK(source_type IN ('live','report')),
 notify boolean NOT NULL, packing_allowed boolean NOT NULL, custody boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,order_id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES ci_unified_order(tenant_id,id)
);
COMMIT;
