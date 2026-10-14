export const receiptResultClaimSql = `WITH picked AS (
 SELECT event_id FROM ci_domain_outbox WHERE tenant_id=$1 AND status IN ('pending','retry','processing') AND status IN ('pending','retry') AND attempts<8 AND available_at<=now()
 ORDER BY created_at,event_id FOR UPDATE SKIP LOCKED LIMIT 1
) UPDATE ci_domain_outbox AS o SET status='processing',claim_token=$2,lease_until=now()+interval '2 minutes',attempts=o.attempts+1
 FROM picked WHERE o.event_id=picked.event_id AND o.tenant_id=$1 RETURNING o.event_id,o.envelope,o.attempts`;
export const receiptExpiredResultClaimSql = `WITH picked AS (
 SELECT event_id FROM ci_domain_outbox WHERE tenant_id=$1 AND status='processing' AND attempts<8 AND lease_until<=now()
 ORDER BY lease_until,event_id FOR UPDATE SKIP LOCKED LIMIT 1
) UPDATE ci_domain_outbox AS o SET status='processing',claim_token=$2,lease_until=now()+interval '2 minutes',attempts=o.attempts+1
 FROM picked WHERE o.event_id=picked.event_id AND o.tenant_id=$1 RETURNING o.event_id,o.envelope,o.attempts`;

export const mongoReadyClaim = (tenantId, now) => ({ filter: { tenant_id: tenantId, status: { $in: ['pending','retry'] }, attempts: { $lt: 8 }, available_at: { $lte: now } }, sort: { available_at: 1, _id: 1 } });
export const mongoExpiredClaim = (tenantId, now) => ({ filter: { tenant_id: tenantId, status: 'processing', attempts: { $lt: 8 }, lease_until: { $lte: now } }, sort: { lease_until: 1, _id: 1 } });
export const mongoReceiptClaimIndexes = Object.freeze([
 { keys: { tenant_id: 1, available_at: 1, _id: 1 }, options: { name: 'receipt_ready_active_idx', partialFilterExpression: { status: { $in: ['pending','retry'] }, attempts: { $lt: 8 } } } },
 { keys: { tenant_id: 1, lease_until: 1, _id: 1 }, options: { name: 'receipt_expired_active_idx', partialFilterExpression: { status: 'processing', attempts: { $lt: 8 } } } },
]);
