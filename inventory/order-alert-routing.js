import { orderAlertPolicy } from './order-alert-policy.js';

// Caller owns the order transaction. Rules within one team are OR; matchers
// within a rule are AND. NULL matches any. Missing rules match nothing.
export async function routeIncomingOrderAlerts(db,{tenantId,orderId,phase='intake'}){
 const policy=await orderAlertPolicy(db,{tenantId,orderId});
 if(!policy.enabled)return {teams:0,legacy:0};
 const packing=phase==='packing';
 if(packing){
  if(!policy.packingAllowed)return {teams:0,legacy:0};
  const ready=await db.query(`SELECT count(*)::int AS lines,count(r.id)::int AS reserved
   FROM ci_unified_order o JOIN ci_unified_order_line l ON l.tenant_id=o.tenant_id AND l.order_id=o.id
   LEFT JOIN ci_reservation r ON r.tenant_id=o.tenant_id AND r.source=o.platform||':'||o.account_id::text
    AND r.external_order_id=o.external_order_id AND r.external_line_id=l.external_line_id AND r.status='active'
   WHERE o.tenant_id=$1 AND o.id=$2 AND o.work_status NOT IN ('cancelled','returned','dispatched','partially_shipped')`,[tenantId,orderId]);
  if(!ready.rows[0]?.lines||ready.rows[0].lines!==ready.rows[0].reserved)return {teams:0,legacy:0};
 }else{
  const first=await db.query("SELECT count(*)::integer AS count FROM ci_order_timeline WHERE tenant_id=$1 AND order_id=$2 AND event_type IN ('received','observed')",[tenantId,orderId]);
  if(first.rows[0].count!==1)return {teams:0,legacy:0};
 }
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
   CASE WHEN t.kind='informational' THEN 'order_observed' WHEN $6 THEN 'packing_ready' ELSE 'new_order' END AS event_type
  FROM ci_unified_order o LEFT JOIN ci_program_order p ON p.tenant_id=o.tenant_id AND p.order_id=o.id
  JOIN ci_alert_team_rule rule ON rule.tenant_id=o.tenant_id
  JOIN ci_alert_team t ON t.tenant_id=rule.tenant_id AND t.id=rule.team_id AND t.active
  JOIN ci_alert_team_member member ON member.tenant_id=t.tenant_id AND member.team_id=t.id
  JOIN ci_alert_recipient r ON r.tenant_id=member.tenant_id AND r.id=member.recipient_id
  WHERE o.tenant_id=$1 AND o.id=$2 AND r.active AND NOT r.muted AND r.consented_at IS NOT NULL AND r.verified_at IS NOT NULL
  AND (r.alert_start IS NULL OR (r.alert_start<r.alert_end AND (now() AT TIME ZONE 'Asia/Kolkata')::time>=r.alert_start AND (now() AT TIME ZONE 'Asia/Kolkata')::time<r.alert_end)
   OR (r.alert_start>r.alert_end AND ((now() AT TIME ZONE 'Asia/Kolkata')::time>=r.alert_start OR (now() AT TIME ZONE 'Asia/Kolkata')::time<r.alert_end)))
  AND ((t.kind='informational' AND NOT $6 AND 'order_observed'=ANY(r.event_types)) OR (t.kind='packing' AND NOT $4 AND $5 AND (($6 AND 'packing_ready'=ANY(r.event_types)) OR (NOT $6 AND 'new_order'=ANY(r.event_types)))))
  AND (rule.platform IS NULL OR rule.platform=o.platform) AND (rule.programme IS NULL OR rule.programme=p.program_key)
  AND (rule.account_id IS NULL OR rule.account_id=o.account_id) AND (rule.payment_mode IS NULL OR rule.payment_mode=o.payment_mode)
  AND (rule.source_type IS NULL OR rule.source_type=$3)
  AND (rule.location_id IS NULL OR EXISTS(SELECT 1 FROM identity i JOIN ci_location loc ON loc.tenant_id=$1 AND loc.id=i.location_id AND loc.location_type IN ('warehouse','store') WHERE i.location_id=rule.location_id))
  AND (rule.sku_prefix IS NULL OR EXISTS(SELECT 1 FROM identity i WHERE left(i.seller_sku,length(rule.sku_prefix))=rule.sku_prefix))
  AND (rule.sku_group_id IS NULL OR EXISTS(SELECT 1 FROM identity i JOIN ci_alert_sku_group_member g ON g.tenant_id=$1 AND g.master_sku_id=i.master_sku_id WHERE g.group_id=rule.sku_group_id))
  AND NOT EXISTS(SELECT 1 FROM ci_order_alert a WHERE a.tenant_id=o.tenant_id AND a.order_id=o.id AND a.recipient_id=r.id)
  ORDER BY r.id,t.id
 ), claims AS (
  INSERT INTO ci_order_alert_once(tenant_id,order_id,recipient_id)
  SELECT $1,$2,recipient_id FROM candidates ON CONFLICT DO NOTHING RETURNING recipient_id
 ) INSERT INTO ci_order_alert(tenant_id,order_id,recipient_id,event_type,team_id)
 SELECT $1,$2,c.recipient_id,c.event_type,c.team_id FROM candidates c JOIN claims q ON q.recipient_id=c.recipient_id
 ON CONFLICT DO NOTHING RETURNING id`,[tenantId,orderId,policy.sourceType,policy.informationalOnly,policy.packingAllowed,packing]);
 // Recipients outside all teams retain their existing platform/event behavior.
 const legacy=await db.query(`WITH candidates AS (
  SELECT r.id AS recipient_id,CASE WHEN $3 THEN 'order_observed' WHEN $5 THEN 'packing_ready' ELSE 'new_order' END AS event_type
  FROM ci_unified_order o JOIN ci_alert_recipient r ON r.tenant_id=o.tenant_id
  WHERE o.tenant_id=$1 AND o.id=$2 AND r.active AND NOT r.muted AND r.consented_at IS NOT NULL AND r.verified_at IS NOT NULL
  AND (cardinality(r.platforms)=0 OR o.platform=ANY(r.platforms))
  AND (($3 AND NOT $5 AND 'order_observed'=ANY(r.event_types)) OR (NOT $3 AND $5 AND $4 AND 'packing_ready'=ANY(r.event_types)) OR (NOT $3 AND NOT $5 AND 'new_order'=ANY(r.event_types)))
  AND NOT EXISTS(SELECT 1 FROM ci_alert_team_member m WHERE m.tenant_id=r.tenant_id AND m.recipient_id=r.id)
 ), claims AS (
  INSERT INTO ci_order_alert_once(tenant_id,order_id,recipient_id)
  SELECT $1,$2,recipient_id FROM candidates ON CONFLICT DO NOTHING RETURNING recipient_id
 ) INSERT INTO ci_order_alert(tenant_id,order_id,recipient_id,event_type)
 SELECT $1,$2,c.recipient_id,c.event_type FROM candidates c JOIN claims q ON q.recipient_id=c.recipient_id
 ON CONFLICT DO NOTHING RETURNING id`,[tenantId,orderId,policy.informationalOnly,policy.packingAllowed,packing]);
 return {teams:teams.rowCount,legacy:legacy.rowCount};
}
export async function routePackingReadyForOrder(db,{tenantId,accountId,externalOrderId}){
 const order=(await db.query('SELECT id FROM ci_unified_order WHERE tenant_id=$1 AND account_id=$2 AND external_order_id=$3',[tenantId,accountId,externalOrderId])).rows[0];
 if(!order)return {teams:0,legacy:0};
 return routeIncomingOrderAlerts(db,{tenantId,orderId:order.id,phase:'packing'});
}
