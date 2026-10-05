import { transaction } from './db.js';

export async function acquireAccountQuota({tenantId,accountId,cost=1,rate,burst,maxWaitMs=30000}){
  if(!(cost>0&&rate>0&&burst>=cost))throw new TypeError('Invalid rate limit');
  const deadline = Date.now() + maxWaitMs;
  while(true){if(Date.now()>=deadline)throw Object.assign(new Error('Provider quota is temporarily exhausted'),{status:429,providerStatus:429});const wait=await transaction(async db=>{
    const result=await db.query('SELECT rate_state FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,accountId]);if(!result.rowCount)throw new Error('Channel account unavailable');
    const now=Date.now(),state=result.rows[0].rate_state||{},last=Number(state.last||now),tokens=Math.min(burst,Number(state.tokens??burst)+Math.max(0,now-last)/1000*rate);
    if(tokens<cost){await db.query('UPDATE ci_channel_account SET rate_state=$3 WHERE tenant_id=$1 AND id=$2',[tenantId,accountId,JSON.stringify({tokens,last:now})]);return Math.ceil((cost-tokens)/rate*1000);}
    await db.query('UPDATE ci_channel_account SET rate_state=$3 WHERE tenant_id=$1 AND id=$2',[tenantId,accountId,JSON.stringify({tokens:tokens-cost,last:now})]);return 0;
  });if(!wait)return;if(Date.now()+wait>deadline)throw Object.assign(new Error('Provider quota is temporarily exhausted'),{status:429,providerStatus:429});await new Promise(r=>setTimeout(r,wait));}
}
