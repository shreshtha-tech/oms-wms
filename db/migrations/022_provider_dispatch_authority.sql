BEGIN;
ALTER TABLE ci_channel_account ADD COLUMN IF NOT EXISTS provider_authority_revision bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS ci_provider_authority_audit (
 id bigserial PRIMARY KEY,tenant_id text NOT NULL,account_id uuid NOT NULL,
 previous_value boolean NOT NULL,new_value boolean NOT NULL,revision bigint NOT NULL,
 actor text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,account_id) REFERENCES ci_channel_account(tenant_id,id),
 UNIQUE(tenant_id,account_id,revision)
);
CREATE TABLE IF NOT EXISTS ci_provider_authority_cutover (
 id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now()
);
WITH claimed AS (
 INSERT INTO ci_provider_authority_cutover(id) VALUES('stage_1_all_existing')
 ON CONFLICT DO NOTHING RETURNING id
), changed AS (
 UPDATE ci_channel_account SET settings=settings||'{"providerAuthoritative":true}'::jsonb,
 provider_authority_revision=provider_authority_revision+1,updated_at=now()
 WHERE EXISTS(SELECT 1 FROM claimed) AND platform IN ('woocommerce','amazon')
   AND settings->>'providerAuthoritative' IS DISTINCT FROM 'true'
 RETURNING tenant_id,id,provider_authority_revision,coalesce((settings->>'providerAuthoritative')::boolean,false) AS value
)
INSERT INTO ci_provider_authority_audit(tenant_id,account_id,previous_value,new_value,revision,actor,reason)
SELECT tenant_id,id,false,true,provider_authority_revision,'owner_stage_1_policy','Existing channel authorized for Stage 1 provider evidence' FROM changed
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS ci_dispatch_review (
 tenant_id text NOT NULL,account_id uuid NOT NULL,external_order_id text NOT NULL,
 reason text NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed')),
 first_observed_at timestamptz NOT NULL DEFAULT now(),last_observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,account_id,external_order_id,reason),
 FOREIGN KEY(tenant_id,account_id) REFERENCES ci_channel_account(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ci_dispatch_evidence (
 tenant_id text NOT NULL,event_id uuid NOT NULL,account_id uuid NOT NULL,
 external_order_id text NOT NULL,external_line_id text NOT NULL,
 evidence_type text NOT NULL CHECK(evidence_type IN ('provider-evidence','handover')),
 source_revision text,recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,event_id),FOREIGN KEY(event_id) REFERENCES ci_inventory_event(id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES ci_channel_account(tenant_id,id)
);
COMMIT;
