CREATE INDEX CONCURRENTLY IF NOT EXISTS ci_domain_outbox_claim_expired_idx
 ON ci_domain_outbox (tenant_id,lease_until,event_id)
 WHERE status='processing' AND attempts<8;
