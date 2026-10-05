import { requirePublicInventoryTenant } from './public-tenant-boundary.js';
import { sendDatabaseError } from '../reliability/api-errors.js';
import express from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { inventoryPool, transaction } from './db.js';
import { sealCredential, openCredential } from './credentials.js';
import { tryLogSyncAttempt } from './sync-attempts.js';

export const tallyPrivate=express.Router(),tallyPublic=express.Router();
tallyPublic.use(requirePublicInventoryTenant);
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(res,e)=>{if(sendDatabaseError(res,e))return;res.status(400).json({error:e.code?'Tally bridge operation unavailable':e.message});};
const collect=(node,key,result=[])=>{if(!node||typeof node!=='object')return result;for(const [k,v]of Object.entries(node)){if(k===key)result.push(...(Array.isArray(v)?v:[v]));else if(typeof v==='object'){if(Array.isArray(v))v.forEach(n=>collect(n,key,result));else collect(v,key,result);}}return result;};
export function readTallyCatalog(xml){
 if(typeof xml!=='string'||!xml.length||Buffer.byteLength(xml,'utf8')>3_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Invalid Tally XML export');
 let depth=0,tags=0,roots=0;
 const markup=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:"[^"]*"|'[^']*'|[^'">])*?>/g;
 for(const match of xml.matchAll(markup)){
  const tag=match[0];if(tag.startsWith('<!--')||tag.startsWith('<![CDATA[')||tag.startsWith('<?'))continue;
  if(++tags>100000)throw new Error('Tally XML exceeds structural limits');
  if(tag.startsWith('</'))depth--;else {if(depth===0&&++roots>1)throw new Error('Invalid Tally XML export');if(!/\/\s*>$/.test(tag))depth++;}
  if(depth>128||depth<0)throw new Error('Tally XML exceeds structural limits');
 }
 if(depth!==0||XMLValidator.validate(xml)!==true)throw new Error('Invalid Tally XML export');
 const tree=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:false}).parse(xml);
 if(!tree.ENVELOPE)throw new Error('Tally export has no response envelope');
 if(collect(tree,'LINEERROR').length)throw new Error('Tally returned an export error');
 return {companies:collect(tree,'COMPANY').map(row=>String(row.NAME||row['@_NAME']||'')).filter(Boolean),locations:collect(tree,'GODOWN').map(row=>({id:String(row.GUID||row.NAME||row['@_NAME']),name:String(row.NAME||row['@_NAME']||'')})),items:collect(tree,'STOCKITEM').map(row=>({id:String(row.GUID||row.NAME||row['@_NAME']),name:String(row.NAME||row['@_NAME']||''),unit:row.BASEUNITS})),voucherCount:collect(tree,'VOUCHER').length};
}
tallyPrivate.post('/pairing',async(req,res)=>{try{
 const name=String(req.body.fields?.accountId||'').trim();if(!name||name.length>120)throw new Error('A stable store/bridge name is required');
 const {rows}=await inventoryPool().query("INSERT INTO ci_channel_account(tenant_id,platform,external_account_id,connection_state) VALUES($1,'tally',$2,'pending_approval') ON CONFLICT(tenant_id,platform,external_account_id) DO UPDATE SET updated_at=now() RETURNING *",[req.inventoryTenantId,name]);
 const account=rows[0],code=randomBytes(16).toString('hex');
 await inventoryPool().query("INSERT INTO ci_agent_pairing(code_hash,tenant_id,account_id,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",[hash(code),req.inventoryTenantId,account.id]);
 res.json({code,connection:{id:account.id,platform:'tally',externalAccountId:name,label:'Local bridge pairing required',state:'pending_approval',active:false,fields:{accountId:name},masked:{},verification:account.verification,settings:account.settings}});
 }catch(e){fail(res,e);}});
tallyPrivate.get('/download',(_req,res)=>res.download(fileURLToPath(new URL('../scripts/tally-bridge.mjs',import.meta.url)),'dmills-tally-bridge.mjs'));
tallyPrivate.post('/:id/company',async(req,res)=>{try{const row=(await inventoryPool().query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 AND platform='tally'",[req.inventoryTenantId,req.params.id])).rows[0];if(!row?.verification.companies?.includes(req.body.company))throw new Error('Select a company discovered by the paired agent');await inventoryPool().query("UPDATE ci_channel_account SET settings=settings||$3::jsonb WHERE tenant_id=$1 AND id=$2",[req.inventoryTenantId,row.id,JSON.stringify({company:req.body.company})]);res.json({ok:true});}catch(e){fail(res,e);}});
tallyPublic.post('/pair',express.json({limit:'10kb'}),async(req,res)=>{try{
 const code=String(req.body.code||'');if(!/^[a-f0-9]{32}$/.test(code))throw new Error('Invalid pairing code');
 const result=await transaction(async db=>{const row=(await db.query('SELECT * FROM ci_agent_pairing WHERE tenant_id=$2 AND code_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',[hash(code),req.inventoryTenantId])).rows[0];if(!row)throw new Error('Pairing code expired or already used');const token=randomBytes(32).toString('hex'),sealed=sealCredential({agentToken:token});await db.query('UPDATE ci_channel_account SET encrypted_credentials=$3,credential_iv=$4,credential_tag=$5 WHERE tenant_id=$1 AND id=$2',[row.tenant_id,row.account_id,sealed.encrypted,sealed.iv,sealed.tag]);await db.query('UPDATE ci_agent_pairing SET consumed_at=now() WHERE code_hash=$1',[hash(code)]);return {accountId:row.account_id,token};});res.json(result);
 }catch(e){fail(res,e);}});
tallyPublic.post('/export',express.json({limit:'4mb'}),async(req,res)=>{try{
 const row=(await inventoryPool().query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 AND platform='tally'",[req.inventoryTenantId,req.body.accountId])).rows[0];if(!row?.encrypted_credentials)return res.status(401).json({error:'Unknown bridge'});
 const token=String(req.get('authorization')||'').replace(/^Bearer /,''),secret=openCredential(row).agentToken||'';
 if(!token||!secret||!timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(hash(secret),'hex')))return res.status(401).json({error:'Invalid bridge token'});
 const catalog=readTallyCatalog(req.body.xml),digest=hash(req.body.xml);
 await transaction(async db=>{
  const receipt=await db.query('INSERT INTO ci_ingress(tenant_id,source,message_id,payload_hash) VALUES($1,$2,$3,$3) ON CONFLICT DO NOTHING RETURNING message_id',[row.tenant_id,`tally:${row.id}`,digest]);
  // A previously accepted snapshot may arrive after a newer export. Its
  // receipt remains valid, but replay must not restore old catalog metadata.
  if(!receipt.rowCount)return;
  const verification={...row.verification,...(catalog.companies.length?{companies:catalog.companies}:{}),...(catalog.locations.length?{locations:catalog.locations}:{}),...(catalog.items.length?{items:catalog.items.slice(0,10000)}:{}),raw:{companyCount:catalog.companies.length,locationCount:catalog.locations.length,itemCount:catalog.items.length,voucherCount:catalog.voucherCount,digest},checkedAt:new Date().toISOString()};
  await db.query("UPDATE ci_channel_account SET verification=$3,connection_state='verified',verified_at=now(),settings=settings||jsonb_build_object('agentLastSeen',now()),updated_at=now() WHERE tenant_id=$1 AND id=$2",[row.tenant_id,row.id,JSON.stringify(verification)]);
  // Preserve exact source exports encrypted until an approved voucher mapping is available.
  if(receipt.rowCount&&catalog.voucherCount){const sealed=sealCredential({xml:req.body.xml});await db.query("INSERT INTO ci_outbox(tenant_id,account_id,task_type,payload,status) VALUES($1,$2,'tally_voucher_review',$3,'held')",[row.tenant_id,row.id,JSON.stringify({digest,encrypted:sealed.encrypted.toString('base64'),iv:sealed.iv.toString('base64'),tag:sealed.tag.toString('base64'),count:catalog.voucherCount})]);}
 });
 await tryLogSyncAttempt({tenantId:row.tenant_id,accountId:row.id,direction:'read',operation:'tally_export',skuCount:catalog.items.length,diagnostic:{voucherCount:catalog.voucherCount,heldForMapping:catalog.voucherCount>0}});
 res.json({accepted:true,company:row.settings.company||'',voucherProcessing:'Held until voucher/item/godown mapping is approved'});
 }catch(e){fail(res,e);}});
