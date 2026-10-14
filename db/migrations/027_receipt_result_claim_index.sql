CREATE INDEX CONCURRENTLY IF NOT EXISTS ci_domain_outbox_claim_active_idx
 ON ci_domain_outbox (tenant_id,created_at,event_id)
 WHERE status IN ('pending','retry','processing') AND attempts<8;
