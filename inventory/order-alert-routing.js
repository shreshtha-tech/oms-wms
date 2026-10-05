import { orderAlertPolicy } from './order-alert-policy.js';

// Caller owns the order transaction. Rules within one team are OR; matchers
// within a rule are AND. NULL matches any. Missing rules match nothing.
export async function routeIncomingOrderAlerts(db,{tenantId,orderId}){
 const policy=await orderAlertPolicy(db,{tenantId,orderId});
 if(!policy.enabled)return {teams:0,legacy:0};
 const first=await db.query("SELECT count(*)::integer AS count FROM ci_order_timeline WHERE tenant_id=$1 AND order_id=$2 AND event_type IN ('received','observed')",[tenantId,orderId]);
 if(first.rows[0].count!==1)return {teams:0,legacy:0};
 const teams=await db.query(`WITH identity AS (
  SELECT l.external_line_id,l.seller_sku,CASE WHEN count(DISTINCT i.master_sku_id)=1 THEN min(i.master_sku_id::text)::uuid END AS master_sku_id,
   CASE WHEN count(DISTINCT m.internal_location_id)=1 THEN min(m.internal_location_id::text)::uuid END AS location_id
  FROM ci_unified_order o JOIN ci_unified_order_line l ON l.tenant_id=o.tenant_id AND l.order_id=o.id
  LEFT JOIN LATERAL (SELECT s.id AS master_sku_id FROM ci_master_sku s WHERE s.tenant_id=o.tenant_id AND s.sku=l.seller_sku
   UNION SELECT cm.master_sku_id FROM ci_channel_mapping cm WHERE cm.tenant_id=o.tenant_id AND cm.account_id=o.account_id AND cm.external_sku=l.seller_sku AND cm.active) i ON true
  LEFT JOIN ci_channel_mapping m ON m.tenant_id=o.tenant_id AND m.account_id=o.account_id AND m.external_sku=l.seller_sku AND m.active
  WHERE o.tenant_id=$1 AND o.id=$2 GROUP BY l.external_line_id,l.seller_sku
 ), candidates AS (
  SELECT DISTINCT ON (r.id) r.id AS recipient_id,t.id AS team_id,
   CASE WHEN t.kind='informational' THEN 'order_observed' WHEN 'new_order'=ANY(r.event_types) THEN 'new_order' ELSE 'packing_ready' END AS event_type
  FROM ci_unified_order o LEFT JOIN ci_program_order p ON p.tenant_id=o.tenant_id AND p.order_id=o.id
  JOIN ci_alert_team_rule rule ON rule.tenant_id=o.tenant_id
  JOIN ci_alert_team t ON t.tenant_id=rule.tenant_id AND t.id=rule.team_id AND t.active
  JOIN ci_alert_team_member member ON member.tenant_id=t.tenant_id AND member.team_id=t.id
  JOIN ci_alert_recipient r ON r.tenant_id=member.tenant_id AND r.id=member.recipient_id
  WHERE o.tenant_id=$1 AND o.id=$2 AND r.active AND NOT r.muted AND r.consented_at IS NOT NULL AND r.verified_at IS NOT NULL
  AND (r.alert_start IS NULL OR (r.alert_start<r.alert_end AND (now() AT TIME ZONE 'Asia/Kolkata')::time>=r.alert_start AND (now() AT TIME ZONE 'Asia/Kolkata')::time<r.alert_end)
   OR (r.alert_start>r.alert_end AND ((now() AT TIME ZONE 'Asia/Kolkata')::time>=r.alert_start OR (now() AT TIME ZONE 'Asia/Kolkata')::time<r.alert_end)))
  AND ((t.kind='informational' AND 'order_observed'=ANY(r.event_types)) OR (t.kind='packing' AND NOT $4 AND ('new_order'=ANY(r.event_types) OR ($5 AND 'packing_ready'=ANY(r.event_types)))))
  AND (rule.platform IS NULL OR rule.platform=o.platform) AND (rule.programme IS NULL OR rule.programme=p.program_key)
  AND (rule.account_id IS NULL OR rule.account_id=o.account_id) AND (rule.payment_mode IS NULL OR rule.payment_mode=o.payment_mode)
  AND (rule.source_type IS NULL OR rule.source_type=$3)
  AND (rule.location_id IS NULL OR EXISTS(SELECT 1 FROM identity i JOIN ci_location loc ON loc.tenant_id=$1 AND loc.id=i.location_id AND loc.location_type IN ('warehouse','store') WHERE i.location_id=rule.location_id))
  AND (rule.sku_prefix IS NULL OR EXISTS(SELECT 1 FROM identity i WHERE left(i.seller_sku,length(rule.sku_prefix))=rule.sku_prefix))
  AND (rule.sku_group_id IS NULL OR EXISTS(SELECT 1 FROM identity i JOIN ci_alert_sku_group_member g ON g.tenant_id=$1 AND g.master_sku_id=i.master_sku_id WHERE g.group_id=rule.sku_group_id))
  AND NOT EXISTS(SELECT 1 FROM ci_order_alert a WHERE a.tenant_id=o.tenant_id AND a.order_id=o.id AND a.recipient_id=r.id)
  ORDER BY r.id,t.id
 ) INSERT INTO ci_order_alert(tenant_id,order_id,recipient_id,event_type,team_id)
 SELECT $1,$2,recipient_id,event_type,team_id FROM candidates ON CONFLICT DO NOTHING RETURNING id`,[tenantId,orderId,policy.sourceType,policy.informationalOnly,policy.packingAllowed]);
 // Recipients outside all teams retain their existing platform/event behavior.
 const legacy=await db.query(`INSERT INTO ci_order_alert(tenant_id,order_id,recipient_id,event_type)
  SELECT $1,$2,r.id,event_type FROM ci_unified_order o JOIN ci_alert_recipient r ON r.tenant_id=o.tenant_id
  CROSS JOIN LATERAL (SELECT CASE WHEN $3 THEN 'order_observed' ELSE 'new_order' END AS event_type
   UNION ALL SELECT 'packing_ready' WHERE $4 AND NOT $3) e
  WHERE o.tenant_id=$1 AND o.id=$2 AND r.active AND NOT r.muted AND r.consented_at IS NOT NULL AND r.verified_at IS NOT NULL
  AND (cardinality(r.platforms)=0 OR o.platform=ANY(r.platforms))
  AND (e.event_type=ANY(r.event_types) OR (e.event_type='new_order' AND 'order_observed'=ANY(r.event_types)))
  AND NOT EXISTS(SELECT 1 FROM ci_alert_team_member m WHERE m.tenant_id=r.tenant_id AND m.recipient_id=r.id)
  ON CONFLICT DO NOTHING RETURNING id`,[tenantId,orderId,policy.informationalOnly,policy.packingAllowed]);
 return {teams:teams.rowCount,legacy:legacy.rowCount};
}
