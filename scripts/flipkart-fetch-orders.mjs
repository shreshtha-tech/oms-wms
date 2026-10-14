import '../env.js';
import { inventoryPool } from '../inventory/db.js';
import { pollFlipkartOrderObservations, flipkartHistoryStart } from '../inventory/flipkart-order-observation.js';

let pool;
try {
 const args=process.argv.slice(2);let accountId,from=flipkartHistoryStart,resume=false;
 for(let i=0;i<args.length;i++) {
  if(args[i]==='--from')from=args[++i];
  else if(args[i]==='--resume')resume=true;
  else if(!accountId && /^[a-f0-9-]{36}$/i.test(args[i]))accountId=args[i];
  else throw new Error('arguments');
 }
 accountId ||= process.env.INVENTORY_FLIPKART_ACCOUNT_ID;
 const tenant=process.env.INVENTORY_ALLOWED_TENANT_ID;
 if(!tenant||!Number.isFinite(Date.parse(from))||Date.parse(from)<0||Date.parse(from)>Date.now())throw new Error('configuration');
 pool=inventoryPool();
 const accounts=(await pool.query("SELECT id,settings FROM ci_channel_account WHERE tenant_id=$1 AND platform='flipkart' AND ($2::uuid IS NULL OR id=$2::uuid) LIMIT 2",[tenant,accountId||null])).rows;
 if(accounts.length!==1)throw new Error('account_selection');
 accountId=accounts[0].id;
 if(!resume)await pool.query('UPDATE ci_channel_account SET settings=settings||$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,accountId,JSON.stringify({orderObservationEnabled:true,flipkartHistoryFrom:new Date(from).toISOString(),flipkartBackfillBefore:new Date().toISOString(),flipkartHistoryCompletedAt:null,flipkartCancellationBackfillBefore:new Date().toISOString(),flipkartCancellationHistoryCompletedAt:null,flipkartOrderError:null,flipkartOrderRetryAt:null})]);
 let completed=false;
 while(!completed) {
  const result=await pollFlipkartOrderObservations(tenant,{accountId});
  const settings=(await pool.query('SELECT settings FROM ci_channel_account WHERE tenant_id=$1 AND id=$2',[tenant,accountId])).rows[0]?.settings;
  process.stdout.write(`${JSON.stringify({kind:'flipkart_order_history',...result,historyFrom:settings?.flipkartHistoryFrom,orderDateBefore:settings?.flipkartBackfillBefore,cancellationDateBefore:settings?.flipkartCancellationBackfillBefore,orderDateCompletedAt:settings?.flipkartHistoryCompletedAt||null,cancellationDateCompletedAt:settings?.flipkartCancellationHistoryCompletedAt||null,readOnly:true})}\n`);
  if(result.errors.length||!result.accounts) {process.exitCode=1;break;}
  completed=Boolean(settings?.flipkartHistoryCompletedAt&&settings?.flipkartCancellationHistoryCompletedAt);
 }
} catch {
 process.stderr.write('Flipkart history retrieval failed. Check saved account/configuration and use --resume after resolving the safe error code. No complete-history claim.\n');process.exitCode=1;
} finally {if(pool)await pool.end();}
