BEGIN;
ALTER TABLE ci_domain_outbox ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE ci_domain_outbox ADD COLUMN IF NOT EXISTS lease_until timestamptz;
COMMIT;
