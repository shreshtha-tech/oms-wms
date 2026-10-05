import { inventoryPool } from './db.js';
import { currentCredentials } from './connection-setup.js';
import { probeConnection } from './connection-provider.js';
import { tryLogSyncAttempt, safeAccountDiagnostic, safeAccountFailure, safeProviderStatus } from './sync-attempts.js';

// Approved read-only connections refresh their verified sample/custody snapshot.
// This job does not infer physical movements or enable outbound writes.
export async function observeSellerConnections(tenant){
 const accounts=(await inventoryPool().query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND settings->>'observationEnabled'='true' AND platform IN ('amazon','amazon_fba','flipkart','snapdeal','zoho_pos')",[tenant])).rows;
 const summary={checked:0,failed:0};
 for(const account of accounts){try{
  const fields=await currentCredentials(account),result=await probeConnection(account.platform,fields),safe=await safeAccountDiagnostic(tenant,account.id,result.raw);
  await inventoryPool().query("UPDATE ci_channel_account SET verification=$3,connection_state='verified',verified_at=now(),settings=settings||jsonb_build_object('lastObservationAt',now()),updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,account.id,JSON.stringify({raw:safe,locations:result.locations,checkedAt:new Date().toISOString()})]);
  await tryLogSyncAttempt({tenantId:tenant,accountId:account.id,direction:'read',operation:'scheduled_provider_observation',skuCount:result.skuCount});summary.checked++;
 }catch(error){summary.failed++;await inventoryPool().query('UPDATE ci_channel_account SET connection_state=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,account.id,safeProviderStatus(error)===401?'token_expired':'error']);const failure=await safeAccountFailure(tenant,account.id,error);await tryLogSyncAttempt({tenantId:tenant,accountId:account.id,direction:'read',operation:'scheduled_provider_observation',status:'failed',diagnostic:failure});}}
 return summary;
}
