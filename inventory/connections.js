import { requirePublicInventoryTenant } from './public-tenant-boundary.js';
import { sendDatabaseError } from '../reliability/api-errors.js';
import express from 'express';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { inventoryPool, transaction } from './db.js';
import { sealCredential, openCredential } from './credentials.js';
import { connectionCatalog, getConnectionConfig, validateConnectionFields } from './connection-catalog.js';
import { probeConnection, shopifyClient } from './connection-provider.js';
import { redact, httpsOrigin, providerFetch, jsonResponse } from './connection-security.js';
import { logSyncAttempt, tryLogSyncAttempt, safeAccountDiagnostic, safeAccountFailure, safeProviderStatus } from './sync-attempts.js';
import { discoverConnectionCatalog, provisionWebhooks, activateConnection } from './connection-setup.js';
import { parse as parseCsv } from 'csv-parse/sync';
import { tallyPrivate, tallyPublic } from './tally-bridge.js';
import { currentCredentials } from './connection-setup.js';
import { pollShopifyOrderObservations } from './shopify-orders.js';
import { flipkartHistoryStart } from './flipkart-order-observation.js';
import { parseMeeshoOrderReport, importMeeshoOrders } from './meesho-orders.js';
import { salesProgramsApi } from './sales-programs.js';
import { connectionReadiness } from './connection-readiness.js';
import { connectionRequestOriginAllowed } from './connection-origin.js';
import { currentUser, requirePermission } from '../api/auth-session.js';
import { normalizeSkuCode } from './sku-parser.mjs';

export const sellerConnectionsApi=express.Router(),sellerOAuthApi=express.Router();
sellerOAuthApi.use('/agent',tallyPublic);
const hash=value=>createHash('sha256').update(value).digest('hex');
const accountId=(platform,f)=>platform==='shopify'?f.shop:platform.startsWith('amazon')?`${f.sellerId}:${f.marketplaceId}`:platform==='woocommerce'?f.storeUrl:platform==='zoho_pos'?f.organizationId:f.accountId;
const mask=()=> '••••';
const endpoint='/api/inventory-sync/connections';
export function callbackOrigin(){return httpsOrigin(process.env.INVENTORY_PUBLIC_ORIGIN||'');}
export async function connectionAccount(tenant,id){const result=await inventoryPool().query('SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND id=$2',[tenant,id]);if(!result.rowCount)throw Object.assign(new Error('Connection not found'),{status:404});return result.rows[0];}
export function connectionView(account,runtime={}){
 const config=getConnectionConfig(account.platform),secret=account.encrypted_credentials?openCredential(account):{},fields={},masked={};
 for(const f of config.fields){if(secret[f.key]!==undefined){if(f.secret)masked[f.key]=mask(secret[f.key]);else fields[f.key]=secret[f.key];}}
 if(account.platform==='shopify'){fields.shop=account.external_account_id;fields.apiVersion||='2026-07';}
 const state=account.connection_state;
 let label=state==='pending_approval'?(config.auth==='agent'?'Local bridge pairing required':'Application details saved · not submitted'):state==='report_ready'?'Report workspace ready · live disconnected':state==='report_observed'?'Report observed · live disconnected':state==='token_expired'?'Token Expired':state==='error'?'Connected – Error':'Not Connected';
 if(account.status==='active')label=state==='token_expired'?'Token Expired':state==='error'?'Connection error · retest required':'Stock sync activated · check feed health';
 if(account.settings.observationEnabled&&state==='verified')label=account.settings.lastObservationAt?'Connected – Read-only':'Not Connected';
 if(account.settings.orderObservationEnabled&&state==='verified'&&account.status!=='active')label='Connected – Read-only orders';
 return {id:account.id,platform:account.platform,externalAccountId:account.external_account_id,label,state,active:account.status==='active',verifiedAt:account.verified_at,verification:account.verification,fields,masked,settings:redact(account.settings),readiness:connectionReadiness(account,runtime),mode:config.mode,updatedAt:account.updated_at};
}
export async function armReadOnlyOrderFeed(tenant,id){
 const account=await connectionAccount(tenant,id);
 if(!['shopify','woocommerce'].includes(account.platform))return {state:'not_available',detail:'This provider does not have an automatic order-feed setup path in the current project.'};
 await inventoryPool().query("UPDATE ci_channel_account SET settings=settings||jsonb_build_object('orderObservationEnabled',true,'orderFeedSetupError',NULL),updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,id]);
 try{
  const origin=callbackOrigin(),fresh=await connectionAccount(tenant,id);
  const registered=await provisionWebhooks(fresh,origin);
  return {state:'webhooks_ready',detail:`Order webhooks registered at the configured HTTPS endpoint (${registered.registered} subscriptions).`};
 }catch(error){
  const detail=!process.env.INVENTORY_PUBLIC_ORIGIN
   ?account.platform==='shopify'?'Public HTTPS callback is not configured; Shopify order polling will start when the managed worker is running.':'Public HTTPS callback is not configured, so WooCommerce cannot deliver live order webhooks.'
   :'The provider rejected webhook registration. Retest the credentials and inspect the connection activity for the provider error.';
  await inventoryPool().query('UPDATE ci_channel_account SET settings=settings||$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,id,JSON.stringify({orderFeedSetupError:detail})]);
  await tryLogSyncAttempt({tenantId:tenant,accountId:id,direction:'setup',operation:'order_feed_setup',status:'failed',diagnostic:{stage:process.env.INVENTORY_PUBLIC_ORIGIN?'provider_webhook_registration':'missing_public_https_origin'}});
  return {state:account.platform==='shopify'?'polling_fallback':'setup_required',detail};
 }
}
async function saveAccount(tenant,platform,fields,{id,verification,scopes=[],state='verified',settings={}}={}){
 const sealed=sealCredential(fields),identity=accountId(platform,fields);
 if(!identity)throw new Error('An account identity is required');
 if(id){const previous=await connectionAccount(tenant,id);if(previous.platform!==platform||previous.external_account_id!==identity)throw new Error('Create another connection to change seller identity');}
 const result=await inventoryPool().query(`INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,encrypted_credentials,credential_iv,credential_tag,scopes,connection_state,verification,verified_at,settings)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(tenant_id,platform,external_account_id) DO UPDATE SET encrypted_credentials=EXCLUDED.encrypted_credentials,credential_iv=EXCLUDED.credential_iv,credential_tag=EXCLUDED.credential_tag,scopes=EXCLUDED.scopes,status='inactive',connection_state=EXCLUDED.connection_state,verification=EXCLUDED.verification,verified_at=EXCLUDED.verified_at,settings=ci_channel_account.settings||EXCLUDED.settings,updated_at=now() RETURNING *`,
 [tenant,platform,identity,sealed.encrypted,sealed.iv,sealed.tag,scopes,state,JSON.stringify(verification||{}),state==='verified'?new Date():null,JSON.stringify(settings)]);
 return result.rows[0];
}
export async function verifyAndSave(tenant,platform,input,{id,fetcher=providerFetch}={}){
 const prior=id?await connectionAccount(tenant,id):null;
 if(prior&&prior.platform!==platform)throw new Error('Connection platform mismatch');
 const saved=prior?.encrypted_credentials?openCredential(prior):{};
 if(prior?.platform==='shopify'){saved.shop=prior.external_account_id;saved.apiVersion||='2026-07';}
 const combined={...saved,...Object.fromEntries(Object.entries(input||{}).filter(([,value])=>value!==''&&value!==undefined))};
 const fields={...saved,...validateConnectionFields(platform,combined)};
 if(platform==='woocommerce')fields.storeUrl=httpsOrigin(fields.storeUrl);
 if(platform==='shopify')fields.shop=fields.shop.toLowerCase();
 if(platform==='shopify'&&input.accessToken){delete fields.refreshToken;delete fields.expiresAt;delete fields.clientId;delete fields.clientSecret;}
 // A connect/rotation is not a stock publication operation.
 let result;
 try{result=await probeConnection(platform,fields,{fetcher});}
 catch(error){
  const providerStatus=safeProviderStatus(error);
  const state=providerStatus===401?'token_expired':'error';
  const row=prior||await saveAccount(tenant,platform,fields,{state,verification:{error:{message:'Provider credential test failed; diagnostic details unavailable',providerStatus}}});
  if(prior&&!Object.keys(input||{}).length)await inventoryPool().query('UPDATE ci_channel_account SET connection_state=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,row.id,state]);
  const failure=await safeAccountFailure(tenant,prior?.id,error);
  let diagnostic;
  try{diagnostic=redact({...failure,payload:error?.diagnostic},Object.values(fields));}
  catch{diagnostic={message:'Diagnostic withheld: provider error could not be safely formatted',providerStatus:failure.providerStatus};}
  await tryLogSyncAttempt({tenantId:tenant,accountId:row.id,direction:'read',operation:prior?'credential_retest':'connect_test',status:'failed',diagnostic});
  return {ok:false,connection:connectionView(await connectionAccount(tenant,row.id)),error:diagnostic};
 }
 const raw=redact(result.raw,Object.values(result.fields));
 const row=await saveAccount(tenant,platform,result.fields,{id,verification:{raw,locations:result.locations,checkedAt:new Date().toISOString()},scopes:result.scopes,settings:{webhooksReady:prior&&!Object.keys(input||{}).length?Boolean(prior.settings.webhooksReady):false}});
 if(prior?.status==='active'&&!Object.keys(input||{}).length){await inventoryPool().query("UPDATE ci_channel_account SET status='active' WHERE tenant_id=$1 AND id=$2",[tenant,row.id]);row.status='active';}
 await tryLogSyncAttempt({tenantId:tenant,accountId:row.id,direction:'read',operation:'connect_test',skuCount:result.skuCount,diagnostic:{locations:result.locations.length}});
 return {ok:true,connection:connectionView(row),raw};
}
const requireConnectionManagement=requirePermission('central_inventory.connections.manage');
sellerConnectionsApi.use((req,res,next)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='GET'&&!connectionRequestOriginAllowed(req))return res.status(403).json({error:'Connection request origin denied'});
 if(['POST','PUT','PATCH','DELETE'].includes(req.method))return requireConnectionManagement(req,res,next);
 next();
});
sellerConnectionsApi.use('/agent',tallyPrivate);
sellerConnectionsApi.use('/programs',salesProgramsApi);
const wrap=fn=>async(req,res)=>{
 try{await fn(req,res);}catch(error){
  let message='Connection operation failed',status=400,databaseError=false;
  try{const value=error?.status;if(Number.isInteger(value)&&value>=400&&value<=599)status=value;}catch{}
  try{databaseError=Boolean(error?.code);}catch{}
  try{const value=error?.message;if(typeof value==='string')message=redact(value,Object.values(req.body?.fields||{}));}catch{}
  if(req.params?.id){try{message=await safeAccountDiagnostic(req.inventoryTenantId,req.params.id,message);}catch{message='Connection operation failed';}}
  res.status(status).json({error:databaseError?'Connection database unavailable':message});
 }
};
export function connectionAuthorizationSetup(){
 let origin=null;
 try{origin=callbackOrigin();}catch{}
 return Object.fromEntries(connectionCatalog.filter(config=>config.auth.startsWith('oauth')).map(config=>{
  const missing=[];
  if(!origin)missing.push('Public HTTPS website URL (INVENTORY_PUBLIC_ORIGIN)');
  if(config.key==='shopify'&&!process.env.SHOPIFY_CLIENT_ID)missing.push('Shopify app Client ID');
  if(config.key==='shopify'&&!process.env.SHOPIFY_CLIENT_SECRET)missing.push('Shopify app Client secret');
  if(config.key.startsWith('amazon')&&!process.env.AMAZON_SP_API_APPLICATION_ID)missing.push('Amazon SP-API application ID');
  return [config.key,{available:missing.length===0,missing,callbackUrl:origin?`${origin}${endpoint}/oauth/${config.key}/callback`:null}];
 }));
}
sellerConnectionsApi.get('/catalog',wrap(async(_req,res)=>{
 const authorization=connectionAuthorizationSetup();
 res.json({platforms:connectionCatalog,authorization,oauth:Object.fromEntries(Object.entries(authorization).map(([key,value])=>[key,value.available]))});
}));
sellerConnectionsApi.get('/',wrap(async(req,res)=>{
 const {rows}=await inventoryPool().query(`SELECT a.*,
  coalesce((SELECT count(*)::integer FROM ci_channel_mapping m WHERE m.tenant_id=a.tenant_id AND m.account_id=a.id AND m.active),0) AS active_mappings,
  (SELECT max(s.started_at) FROM ci_sync_attempt s WHERE s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.operation='shopify_readback' AND s.status='success') AS last_inventory_read_at,
  (SELECT max(s.started_at) FROM ci_sync_attempt s WHERE s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.operation='publish_stock' AND s.status='success') AS last_inventory_write_at,
  (a.settings->>'lastOrderWebhookAt') AS last_webhook_at,
  coalesce((SELECT h.last_seen_at>now()-interval '2 minutes' FROM ci_service_heartbeat h WHERE h.tenant_id=a.tenant_id AND h.service='inventory-worker'),false) AS worker_healthy,
  (SELECT c.last_success_at FROM ci_sync_cursor c WHERE c.tenant_id=a.tenant_id AND c.account_id=a.id AND c.stream='shopify_order_observation') AS order_cursor_at,
  (SELECT max(s.started_at) FROM ci_sync_attempt s WHERE s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.operation='scheduled_provider_observation' AND s.status='success') AS last_observation_at
  FROM ci_channel_account a WHERE a.tenant_id=$1 ORDER BY a.platform,a.created_at`,[req.inventoryTenantId]);
 res.json(rows.filter(row=>connectionCatalog.some(c=>c.key===row.platform)).map(row=>connectionView(row,{activeMappings:row.active_mappings,workerHealthy:row.worker_healthy,orderCursorAt:row.order_cursor_at,lastWebhookAt:row.last_webhook_at,lastInventoryReadAt:row.last_inventory_read_at,lastInventoryWriteAt:row.last_inventory_write_at,lastObservationAt:row.last_observation_at})));
}));
sellerConnectionsApi.post('/test',wrap(async(req,res)=>{
 const recent=await inventoryPool().query("SELECT count(*) FROM ci_sync_attempt WHERE tenant_id=$1 AND operation IN ('connect_test','credential_retest') AND started_at>now()-interval '5 minutes'",[req.inventoryTenantId]);
 if(Number(recent.rows[0].count)>30)return res.status(429).json({error:'Too many connection tests; try again in five minutes'});
 const result=await verifyAndSave(req.inventoryTenantId,req.body.platform,req.body.fields||{},{id:req.body.id});
 if(result.ok&&['shopify','woocommerce'].includes(req.body.platform)){
  result.feedSetup=await armReadOnlyOrderFeed(req.inventoryTenantId,result.connection.id);
  result.connection=connectionView(await connectionAccount(req.inventoryTenantId,result.connection.id));
 }
 res.json(result);
}));
sellerConnectionsApi.post('/applications',wrap(async(req,res)=>{
 const config=getConnectionConfig(req.body.platform);if(config.auth!=='approval')throw new Error('This platform uses API authorization or agent pairing');
 const fields=validateConnectionFields(config.key,req.body.fields||{});
 const row=await saveAccount(req.inventoryTenantId,config.key,fields,{id:req.body.id,state:'pending_approval',settings:{applicationStatus:'details_recorded'}});
 await logSyncAttempt({tenantId:req.inventoryTenantId,accountId:row.id,direction:'setup',operation:'application_saved'});
 res.json(connectionView(row));
}));
sellerConnectionsApi.post('/report-accounts',wrap(async(req,res)=>{
 const config=getConnectionConfig(req.body.platform);
 if(config.auth!=='approval')throw new Error('This platform requires its API authorization or local agent');
 const fields=validateConnectionFields(config.key,req.body.fields||{});
 const prior=req.body.id?await connectionAccount(req.inventoryTenantId,req.body.id):null;
 const state=prior?.connection_state==='report_observed'?'report_observed':'report_ready';
 const row=await saveAccount(req.inventoryTenantId,config.key,fields,{id:req.body.id,state,settings:{reportWorkspace:true}});
 res.json(connectionView(row));
}));
sellerConnectionsApi.get('/attempts',wrap(async(req,res)=>{
 const page=Number(req.query.page);
 if(!Number.isSafeInteger(page)||page<1||page>100000)return res.status(400).json({error:'Page must be a positive integer'});
 const pageSize=8,offset=(page-1)*pageSize;
 const [count,result]=await Promise.all([
  inventoryPool().query('SELECT count(*)::integer AS total FROM ci_sync_attempt WHERE tenant_id=$1',[req.inventoryTenantId]),
  inventoryPool().query('SELECT s.id,s.started_at,s.direction,s.operation,s.sku_count,s.status,s.diagnostic,a.platform,a.external_account_id FROM ci_sync_attempt s JOIN ci_channel_account a ON a.tenant_id=s.tenant_id AND a.id=s.account_id WHERE s.tenant_id=$1 ORDER BY s.started_at DESC,s.id DESC LIMIT $2 OFFSET $3',[req.inventoryTenantId,pageSize,offset])
 ]);
 res.json({rows:result.rows,page,pageSize,total:count.rows[0].total});
}));
sellerConnectionsApi.get('/:id/mappings',wrap(async(req,res)=>{
 await connectionAccount(req.inventoryTenantId,req.params.id);
 const locations=await inventoryPool().query('SELECT external_location_id,internal_location_id FROM ci_connection_location WHERE tenant_id=$1 AND account_id=$2',[req.inventoryTenantId,req.params.id]);
 const mappings=await inventoryPool().query('SELECT m.id,m.external_sku,m.listing_id,m.external_location_id,m.internal_location_id,m.active,s.sku FROM ci_channel_mapping m JOIN ci_master_sku s ON s.tenant_id=m.tenant_id AND s.id=m.master_sku_id WHERE m.tenant_id=$1 AND m.account_id=$2 ORDER BY m.external_sku LIMIT 1000',[req.inventoryTenantId,req.params.id]);
 res.json({locations:locations.rows,mappings:mappings.rows});
}));
sellerConnectionsApi.post('/:id/locations',wrap(async(req,res)=>{
 const account=await connectionAccount(req.inventoryTenantId,req.params.id),{externalLocationId,internalLocationId}=req.body;
 if(!account.verification.locations?.some(location=>location.id===externalLocationId))throw new Error('Choose a location returned by provider verification');
 const physical=await inventoryPool().query('SELECT location_type FROM ci_location WHERE tenant_id=$1 AND id=$2',[req.inventoryTenantId,internalLocationId]);
 const allowed=getConnectionConfig(account.platform).custody?['marketplace_custody','qcommerce_darkstore']:['warehouse','store'];
 if(!allowed.includes(physical.rows[0]?.location_type))throw new Error('Choose a location with the correct physical/custody ownership');
 await transaction(async db=>{
  await db.query('INSERT INTO ci_connection_location(tenant_id,account_id,external_location_id,internal_location_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,account_id,external_location_id) DO UPDATE SET internal_location_id=EXCLUDED.internal_location_id',[req.inventoryTenantId,account.id,externalLocationId,internalLocationId]);
  await db.query('UPDATE ci_channel_mapping SET internal_location_id=$4,active=false,approved_at=NULL WHERE tenant_id=$1 AND account_id=$2 AND external_location_id=$3',[req.inventoryTenantId,account.id,externalLocationId,internalLocationId]);
  await db.query("UPDATE ci_channel_account SET status='inactive',updated_at=now() WHERE tenant_id=$1 AND id=$2",[req.inventoryTenantId,account.id]);
 });res.json({ok:true});
}));
sellerConnectionsApi.post('/:id/pause',wrap(async(req,res)=>{await connectionAccount(req.inventoryTenantId,req.params.id);await inventoryPool().query("UPDATE ci_channel_account SET status='inactive',settings=settings||jsonb_build_object('observationEnabled',false),updated_at=now() WHERE tenant_id=$1 AND id=$2",[req.inventoryTenantId,req.params.id]);res.json({ok:true});}));
sellerConnectionsApi.post('/:id/provider-authority',requirePermission('central_inventory.provider_authority.manage'),wrap(async(req,res)=>{
 const enabled=req.body?.enabled,revision=req.body?.expectedRevision,reason=String(req.body?.reason||'').trim();
 if(typeof enabled!=='boolean'||!Number.isSafeInteger(revision)||revision<0||!reason||reason.length>250)throw Object.assign(new Error('Enabled, expected revision and audit reason are required'),{status:400});
 const actor=currentUser(req)?.username;
 if(!actor)throw Object.assign(new Error('Authenticated operator required'),{status:401});
 const result=await transaction(async db=>{
  const account=(await db.query('SELECT platform,settings,provider_authority_revision FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[req.inventoryTenantId,req.params.id])).rows[0];
  if(!account)throw Object.assign(new Error('Connection not found'),{status:404});
  if(enabled&&!['woocommerce','amazon'].includes(account.platform))throw Object.assign(new Error('Provider dispatch authority is unavailable for this platform'),{status:400});
  if(Number(account.provider_authority_revision)!==revision)throw Object.assign(new Error('Provider authority changed; reload before saving'),{status:409});
  const previous=account.settings?.providerAuthoritative===true;
  if(previous===enabled)return {enabled,revision};
  await db.query("UPDATE ci_channel_account SET settings=settings||jsonb_build_object('providerAuthoritative',$3::boolean),provider_authority_revision=provider_authority_revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",[req.inventoryTenantId,req.params.id,enabled]);
  await db.query('INSERT INTO ci_provider_authority_audit(tenant_id,account_id,previous_value,new_value,revision,actor,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[req.inventoryTenantId,req.params.id,previous,enabled,revision+1,actor,reason]);
  return {enabled,revision:revision+1};
 });
 res.json(result);
}));
sellerConnectionsApi.get('/:id/dispatch-reviews',wrap(async(req,res)=>{
 await connectionAccount(req.inventoryTenantId,req.params.id);
 const rows=await inventoryPool().query(`SELECT external_order_id,reason,status,first_observed_at,last_observed_at,
  extract(epoch FROM (now()-first_observed_at))::bigint AS age_seconds
  FROM ci_dispatch_review WHERE tenant_id=$1 AND account_id=$2 AND status='open'
  ORDER BY first_observed_at LIMIT 100`,[req.inventoryTenantId,req.params.id]);
 res.json({reviews:rows.rows});
}));
sellerConnectionsApi.post('/:id/observe',wrap(async(req,res)=>{const account=await connectionAccount(req.inventoryTenantId,req.params.id);if(!account.verified_at||!['amazon','amazon_fba','flipkart','snapdeal','zoho_pos'].includes(account.platform))throw new Error('A verified read-only API connection is required');await inventoryPool().query("UPDATE ci_channel_account SET settings=settings||jsonb_build_object('observationEnabled',true),updated_at=now() WHERE tenant_id=$1 AND id=$2",[req.inventoryTenantId,account.id]);res.json({scheduled:true,note:'The worker refreshes the verified sample/custody response every 15 minutes. This does not publish inventory.'});}));
sellerConnectionsApi.post('/:id/orders/observe',requirePermission('central_inventory.connections.manage'),wrap(async(req,res)=>{
 const selected=await connectionAccount(req.inventoryTenantId,req.params.id);
 if(selected.platform==='flipkart'){
  const requested=req.body?.from || flipkartHistoryStart;
  if(typeof requested!=='string'||!Number.isFinite(Date.parse(requested))||Date.parse(requested)<0||Date.parse(requested)>Date.now())throw Object.assign(new Error('Use a valid history start date between 1970 and today'),{status:400});
  const from=new Date(requested).toISOString();
  await inventoryPool().query("UPDATE ci_channel_account SET settings=settings||$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2",[req.inventoryTenantId,selected.id,JSON.stringify({orderObservationEnabled:true,flipkartHistoryFrom:from,flipkartBackfillBefore:new Date().toISOString(),flipkartHistoryCompletedAt:null,flipkartCancellationBackfillBefore:new Date().toISOString(),flipkartCancellationHistoryCompletedAt:null,flipkartOrderError:null,flipkartOrderRetryAt:null})]);
  return res.status(202).json({scheduled:true,readOnly:true,from,detail:'Flipkart historical retrieval queued. The inventory worker imports seller-fulfilled observations and reports progress; this response does not prove completion.'});
 }

 const account=await connectionAccount(req.inventoryTenantId,req.params.id);
 if(account.platform!=='shopify')throw new Error('Read-only order monitoring is currently available for Shopify');
 const fields=await currentCredentials(account),probe=await shopifyClient(fields).graphql('query{shop{myshopifyDomain}currentAppInstallation{accessScopes{handle}}orders(first:1){nodes{id}}}');
 if(probe.shop?.myshopifyDomain!==account.external_account_id||!probe.currentAppInstallation?.accessScopes?.some(scope=>scope.handle==='read_orders'))throw new Error('Shopify read_orders access or store identity is missing');
 await inventoryPool().query("UPDATE ci_channel_account SET settings=settings||jsonb_build_object('orderObservationEnabled',true),connection_state='verified',verified_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2",[req.inventoryTenantId,account.id]);
 const summary=await pollShopifyOrderObservations(req.inventoryTenantId);
 res.json({scheduled:true,readOnly:true,summary});
}));
sellerConnectionsApi.post('/:id/discover',wrap(async(req,res)=>res.json(await discoverConnectionCatalog(await connectionAccount(req.inventoryTenantId,req.params.id)))));
sellerConnectionsApi.post('/:id/webhooks',wrap(async(req,res)=>res.json(await provisionWebhooks(await connectionAccount(req.inventoryTenantId,req.params.id),callbackOrigin()))));
sellerConnectionsApi.post('/:id/activate',wrap(async(req,res)=>res.json(await activateConnection(await connectionAccount(req.inventoryTenantId,req.params.id),req.body.mappingIds))));
sellerConnectionsApi.post('/:id/snapshot',wrap(async(req,res)=>{
 const account=await connectionAccount(req.inventoryTenantId,req.params.id),config=getConnectionConfig(account.platform);
 if(config.auth!=='approval')throw new Error('Use the provider API or agent for this connection');
 const bytes=Buffer.from(String(req.body.base64||''),'base64');if(!bytes.length||bytes.length>5_000_000)throw new Error('Report must contain data and be under 5 MB');
 const fileName=String(req.body.fileName||''),rows=fileName.endsWith('.csv')?parseCsv(bytes,{columns:true,bom:true,trim:true,skip_empty_lines:true}):fileName.endsWith('.json')?JSON.parse(bytes.toString()):null;
 if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw new Error('Choose a CSV/JSON report with 1–10,000 rows');
 const seen=new Set();for(const row of rows){if(typeof row.external_sku!=='string'||!row.external_sku||typeof row.external_location_id!=='string'||!row.external_location_id||!/^\d+$/.test(String(row.available))||!Number.isSafeInteger(Number(row.available)))throw new Error('Report requires external_sku, external_location_id and a nonnegative whole available quantity');const key=JSON.stringify([row.external_sku,row.external_location_id]);if(seen.has(key))throw new Error('Duplicate SKU/location in report');seen.add(key);}
 const digest=hash(bytes);
 const result=await transaction(async db=>{
  const receipt=await db.query('INSERT INTO ci_ingress(tenant_id,source,message_id,payload_hash) VALUES($1,$2,$3,$3) ON CONFLICT DO NOTHING RETURNING message_id',[account.tenant_id,`file:${account.id}`,digest]);if(!receipt.rowCount)return {duplicate:true,count:0};
  for(const row of rows){const master=(await db.query(`SELECT s.id FROM ci_master_sku s WHERE s.tenant_id=$1 AND s.merged_into_id IS NULL AND s.id=coalesce(
    (SELECT a.master_sku_id FROM ci_sku_alias a WHERE a.tenant_id=$1 AND a.alias_sku=$2),
    (SELECT direct.id FROM ci_master_sku direct WHERE direct.tenant_id=$1 AND direct.sku=$3 AND direct.merged_into_id IS NULL))`,[account.tenant_id,normalizeSkuCode(row.external_sku),row.external_sku])).rows[0];if(!master)throw new Error(`Master SKU not found: ${row.external_sku}`);const mapping=(await db.query('INSERT INTO ci_channel_mapping(tenant_id,account_id,master_sku_id,external_sku,external_location_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,account_id,external_sku,external_location_id) DO UPDATE SET external_sku=EXCLUDED.external_sku RETURNING id,master_sku_id',[account.tenant_id,account.id,master.id,row.external_sku,row.external_location_id])).rows[0];if(mapping.master_sku_id!==master.id)throw new Error(`Existing mapping needs identity review: ${row.external_sku}`);await db.query("INSERT INTO ci_channel_stock(tenant_id,mapping_id,observed_quantity,observed_at,publish_state) VALUES($1,$2,$3,now(),'observed') ON CONFLICT(tenant_id,mapping_id) DO UPDATE SET observed_quantity=EXCLUDED.observed_quantity,observed_at=now()",[account.tenant_id,mapping.id,Number(row.available)]);}
  const locations=[...new Set(rows.map(row=>row.external_location_id))].map(id=>({id,name:id}));
  await db.query("UPDATE ci_channel_account SET connection_state='report_observed',verification=$3,updated_at=now(),settings=settings||jsonb_build_object('lastReportAt',now()) WHERE tenant_id=$1 AND id=$2",[account.tenant_id,account.id,JSON.stringify({raw:{fileName,count:rows.length,digest,sample:rows.slice(0,1)},locations})]);
  return {duplicate:false,count:rows.length};
 });await logSyncAttempt({tenantId:account.tenant_id,accountId:account.id,direction:'read',operation:'partner_report',skuCount:result.count,diagnostic:result});res.json(result);
}));
sellerConnectionsApi.post('/:id/meesho/orders/inspect',wrap(async(req,res)=>{
 const account=await connectionAccount(req.inventoryTenantId,req.params.id);
 if(account.platform!=='meesho')throw Object.assign(new Error('Choose a Meesho supplier account'),{status:400});
 const report=await parseMeeshoOrderReport({fileName:req.body.fileName,bytes:Buffer.from(String(req.body.base64||''),'base64'),sheetName:req.body.sheetName,headerRow:Number(req.body.headerRow||1)});
 res.json({sheet:report.sheet,headers:report.headers,rows:report.rows.length});
}));
sellerConnectionsApi.post('/:id/meesho/orders/import',wrap(async(req,res)=>{
 const account=await connectionAccount(req.inventoryTenantId,req.params.id);
 res.json(await importMeeshoOrders({tenantId:req.inventoryTenantId,account,fileName:req.body.fileName,bytes:Buffer.from(String(req.body.base64||''),'base64'),sheetName:req.body.sheetName,headerRow:Number(req.body.headerRow||1),mapping:req.body.mapping,reportAsOf:req.body.reportAsOf}));
}));

export function verifyShopifyCallback(query,secret){
 if(typeof query.hmac!=='string'||!/^[a-f0-9]{64}$/i.test(query.hmac))return false;
 if(Object.values(query).some(value=>typeof value!=='string'))return false;
 const message=Object.keys(query).filter(key=>key!=='hmac'&&key!=='signature').sort().map(key=>`${key}=${query[key]}`).join('&');
 const expected=createHmac('sha256',secret).update(message).digest(),actual=Buffer.from(query.hmac,'hex');
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
sellerConnectionsApi.post('/oauth/start',wrap(async(req,res)=>{
 const platform=req.body.platform,config=getConnectionConfig(platform);if(!config.auth.startsWith('oauth'))throw new Error('OAuth is not supported for this platform');
 let fields=validateConnectionFields(platform,req.body.fields||{},{oauth:true});
 if(platform==='shopify')fields={...fields,clientId:process.env.SHOPIFY_CLIENT_ID,clientSecret:process.env.SHOPIFY_CLIENT_SECRET};
 if(!fields.clientId||!fields.clientSecret)throw new Error('Register the OAuth app and configure its client credentials first');
 const state=randomBytes(32).toString('hex'),browser=randomBytes(32).toString('hex'),callback=`${callbackOrigin()}${endpoint}/oauth/${platform}/callback`;
 const sealed=sealCredential({fields,callback});
 await inventoryPool().query('INSERT INTO ci_connection_oauth(state_hash,tenant_id,platform,browser_hash,encrypted_credentials,credential_iv,credential_tag,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval \'10 minutes\')',[hash(state),req.inventoryTenantId,platform,hash(browser),sealed.encrypted,sealed.iv,sealed.tag]);
 res.cookie(`dmills_oauth_${state.slice(0,12)}`,browser,{httpOnly:true,secure:true,sameSite:'lax',maxAge:600000,path:`${endpoint}/oauth`});
 let url;
 if(platform==='shopify'){url=new URL(`https://${fields.shop}/admin/oauth/authorize`);url.search=new URLSearchParams({client_id:fields.clientId,scope:config.scopes.join(','),redirect_uri:callback,state}).toString();}
 else if(platform.startsWith('amazon')){if(!process.env.AMAZON_SP_API_APPLICATION_ID)throw new Error('AMAZON_SP_API_APPLICATION_ID is required');url=new URL('https://sellercentral.amazon.in/apps/authorize/consent');url.search=new URLSearchParams({application_id:process.env.AMAZON_SP_API_APPLICATION_ID,state,redirect_uri:callback}).toString();}
 else if(platform==='flipkart'){url=new URL('https://api.flipkart.net/oauth-service/oauth/authorize');url.search=new URLSearchParams({client_id:fields.clientId,redirect_uri:callback,response_type:'code',scope:'Seller_Api',state}).toString();}
 else {url=new URL(`https://accounts.zoho.${fields.region}/oauth/v2/auth`);url.search=new URLSearchParams({client_id:fields.clientId,redirect_uri:callback,response_type:'code',scope:config.scopes.join(','),access_type:'offline',prompt:'consent',state}).toString();}
 res.json({url:url.href});
}));
sellerOAuthApi.use('/oauth',requirePublicInventoryTenant);
sellerOAuthApi.get('/oauth/:platform/callback',async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
  const state=String(req.query.state||'');if(!/^[a-f0-9]{64}$/.test(state))throw new Error('Invalid OAuth state');
  if(req.query.error)throw new Error('Provider authorization was declined');
  const code=String(req.query.code||req.query.spapi_oauth_code||'');if(!code||code.length>4096)throw new Error('Missing OAuth authorization code');
  const cookie=String(req.headers.cookie||'').split(';').map(item=>item.trim()).find(item=>item.startsWith(`dmills_oauth_${state.slice(0,12)}=`))?.split('=')[1];
  const oauth=await transaction(async db=>{const result=await db.query('SELECT * FROM ci_connection_oauth WHERE tenant_id=$3 AND state_hash=$1 AND platform=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',[hash(state),req.params.platform,req.inventoryTenantId]);const row=result.rows[0];if(!row||!cookie||hash(cookie)!==row.browser_hash)throw new Error('OAuth session expired or belongs to a different browser');const payload=openCredential(row);if(row.platform.startsWith('amazon')&&req.query.selling_partner_id!==payload.fields.sellerId)throw new Error('Amazon authorized a different seller');if(row.platform==='shopify'&&(!verifyShopifyCallback(req.query,payload.fields.clientSecret)||req.query.shop!==payload.fields.shop))throw new Error('Invalid Shopify callback signature or shop');await db.query('UPDATE ci_connection_oauth SET consumed_at=now() WHERE state_hash=$1',[hash(state)]);return {...row,...payload};});
  const f=oauth.fields,platform=oauth.platform;
  const tokenUrl=platform==='shopify'?`https://${f.shop}/admin/oauth/access_token`:platform.startsWith('amazon')?'https://api.amazon.com/auth/o2/token':platform==='flipkart'?'https://api.flipkart.net/oauth-service/oauth/token':`https://accounts.zoho.${f.region}/oauth/v2/token`;
  const headers={'Content-Type':'application/x-www-form-urlencoded'};
  if(platform==='flipkart')headers.Authorization=`Basic ${Buffer.from(`${f.clientId}:${f.clientSecret}`).toString('base64')}`;
  const body={client_id:f.clientId,client_secret:f.clientSecret,grant_type:'authorization_code',code,redirect_uri:oauth.callback,...(platform==='shopify'?{expiring:'1'}:{})};
  const data=await jsonResponse(await providerFetch(tokenUrl,{method:'POST',headers,body:new URLSearchParams(body).toString()}),platform);
  if(!data.access_token)throw new Error('Provider did not issue an access token');
  const fields={...f,accessToken:data.access_token,refreshToken:data.refresh_token,expiresAt:data.expires_in?Date.now()+Number(data.expires_in)*1000:undefined};
  const probe=await probeConnection(platform,fields),raw=redact(probe.raw,Object.values(fields));
  const account=await saveAccount(oauth.tenant_id,platform,probe.fields,{verification:{raw,locations:probe.locations,checkedAt:new Date().toISOString()},scopes:probe.scopes});
  if(['shopify','woocommerce'].includes(platform))await armReadOnlyOrderFeed(oauth.tenant_id,account.id);
  await logSyncAttempt({tenantId:oauth.tenant_id,accountId:account.id,direction:'read',operation:'oauth_connect_test',skuCount:probe.skuCount});
  res.clearCookie(`dmills_oauth_${state.slice(0,12)}`,{path:`${endpoint}/oauth`});
  res.redirect(`${callbackOrigin()}/app/central-inventory?section=channels&connection=${account.id}`);
 }catch(error){if(sendDatabaseError(res,error))return;res.status(400).type('text/plain').send('Seller authorization could not be verified. Return to Channel connections and retry. No connection was activated.');}
});
