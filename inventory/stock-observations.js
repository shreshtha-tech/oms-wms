import { transaction } from './db.js';
const invalid=message=>Object.assign(new Error(message),{code:'OBSERVATION_RECONCILIATION_REQUIRED'});
// Provider quantities are observations, never physical ledger mutations.
export async function recordStockObservation({tenantId,mappingId,quantity,eventTime}){
 if(!Number.isSafeInteger(quantity))throw invalid('Provider observation quantity must be an integer; reconciliation required');
 if(typeof eventTime!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(eventTime))throw invalid('Provider observation timestamp is missing or invalid; reconciliation required');
 const timestamp=Date.parse(eventTime);
 if(!Number.isFinite(timestamp)||timestamp>Date.now()+300000)throw invalid('Provider observation timestamp is invalid or too far in the future; reconciliation required');
 return transaction(async db=>{
  const mapping=await db.query('SELECT id FROM ci_channel_mapping WHERE tenant_id=$1 AND id=$2 AND active=true FOR SHARE',[tenantId,mappingId]);
  if(mapping.rowCount!==1)throw invalid('Provider observation mapping is unavailable for this tenant; reconciliation required');
  const result=await db.query(`INSERT INTO ci_channel_stock(tenant_id,mapping_id,observed_quantity,observed_at,publish_state)
    VALUES($1,$2,$3,$4,'observed') ON CONFLICT(tenant_id,mapping_id) DO UPDATE
    SET observed_quantity=EXCLUDED.observed_quantity,observed_at=EXCLUDED.observed_at
    WHERE ci_channel_stock.observed_at IS NULL OR ci_channel_stock.observed_at<EXCLUDED.observed_at
    RETURNING mapping_id`,[tenantId,mappingId,quantity,new Date(timestamp)]);
  if(result.rowCount)return{applied:true};
  const current=(await db.query('SELECT observed_quantity,observed_at FROM ci_channel_stock WHERE tenant_id=$1 AND mapping_id=$2',[tenantId,mappingId])).rows[0];
  if(current&&new Date(current.observed_at).getTime()===timestamp&&Number(current.observed_quantity)!==quantity)throw invalid('Conflicting provider quantities at the same timestamp; reconciliation required');
  return{applied:false,stale:Boolean(current&&new Date(current.observed_at).getTime()>timestamp)};
 });
}
