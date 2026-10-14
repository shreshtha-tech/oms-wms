BEGIN;
-- Correct only the old one-time Stage 1 grant on unrelated platforms. A later
-- operator decision has a newer revision/audit row and is left untouched.
WITH changed AS (
 UPDATE ci_channel_account account
 SET settings=account.settings||'{"providerAuthoritative":false}'::jsonb,
     provider_authority_revision=account.provider_authority_revision+1,
     updated_at=now()
 FROM ci_provider_authority_audit audit
 WHERE account.tenant_id=audit.tenant_id AND account.id=audit.account_id
   AND account.provider_authority_revision=audit.revision
   AND audit.actor='owner_stage_1_policy'
   AND audit.previous_value=false AND audit.new_value=true
   AND account.platform NOT IN ('woocommerce','amazon')
   AND account.settings->>'providerAuthoritative'='true'
 RETURNING account.tenant_id,account.id,account.provider_authority_revision
)
INSERT INTO ci_provider_authority_audit
  (tenant_id,account_id,previous_value,new_value,revision,actor,reason)
SELECT tenant_id,id,true,false,provider_authority_revision,
  'migration_029_scope','Removed Stage 1 auto-grant from unrelated platform'
FROM changed ON CONFLICT DO NOTHING;
COMMIT;
