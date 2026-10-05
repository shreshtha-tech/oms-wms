import { createHash } from 'node:crypto';
import { parsePartnerReport as parseMeeshoOrderReport } from './report-parser.js';
export { parsePartnerReport as parseMeeshoOrderReport } from './report-parser.js';
import { transaction } from './db.js';
import { recordIncomingOrder } from './unified-orders.js';
import { tryLogSyncAttempt } from './sync-attempts.js';

const text=value=>String(value??'').trim();

export async function importMeeshoOrders({tenantId,account,fileName,bytes,sheetName,headerRow,mapping,reportAsOf}){
 if(account.platform!=='meesho')throw Object.assign(new Error('This report belongs to a Meesho connection'),{status:400});
 const parsed=await parseMeeshoOrderReport({fileName,bytes,sheetName,headerRow});
 const required=['subOrderId','sku','quantity','status'];
 if(!mapping||required.some(key=>!parsed.headers.includes(mapping[key])))throw Object.assign(new Error('Map Sub-order ID, Supplier SKU, Quantity and Status to actual report columns'),{status:400});
 if(mapping.orderedAt&&!parsed.headers.includes(mapping.orderedAt))throw Object.assign(new Error('Order date column was not found'),{status:400});
 if(mapping.title&&!parsed.headers.includes(mapping.title))throw Object.assign(new Error('Product title column was not found'),{status:400});
 if(new Set(required.map(key=>mapping[key])).size!==required.length)throw Object.assign(new Error('Each required field needs a distinct report column'),{status:400});
 const asOf=new Date(reportAsOf);
 if(!Number.isFinite(asOf.getTime())||asOf.getTime()>Date.now()+300_000||asOf.getTime()<Date.UTC(2010,0,1))throw Object.assign(new Error('Enter the actual report export time'),{status:400});
 const grouped=new Map(),seen=new Set();
 for(const [index,row] of parsed.rows.entries()){
  const subOrderId=text(row[mapping.subOrderId]),sku=text(row[mapping.sku]),quantity=Number(text(row[mapping.quantity])),status=text(row[mapping.status]);
  if(!subOrderId||subOrderId.length>120||!sku||sku.length>120||!Number.isSafeInteger(quantity)||quantity<=0||!status||status.length>60)throw Object.assign(new Error(`Invalid Meesho order identifier, SKU, quantity or status at data row ${index+1}`),{status:400});
  const key=JSON.stringify([subOrderId,sku]);if(seen.has(key))throw Object.assign(new Error(`Repeated SKU within Meesho sub-order ${subOrderId}`),{status:400});seen.add(key);
  const prior=grouped.get(subOrderId);
  const normalizedStatus=/^cancell?ed$/i.test(status)?'cancelled':status;
  if(prior&&prior.status!==normalizedStatus)throw Object.assign(new Error(`Conflicting statuses within Meesho sub-order ${subOrderId}`),{status:400});
  const orderedAt=mapping.orderedAt?text(row[mapping.orderedAt]):'';
  if(orderedAt&&Number.isNaN(Date.parse(orderedAt)))throw Object.assign(new Error(`Invalid order date at data row ${index+1}`),{status:400});
  const order=prior||{id:subOrderId,status:normalizedStatus,created_at:orderedAt||undefined,updated_at:asOf.toISOString(),currency:'INR',line_items:[]};
  order.line_items.push({id:createHash('sha256').update(subOrderId).update('\0').update(sku).digest('hex'),sku,quantity,title:mapping.title?text(row[mapping.title]):''});
  grouped.set(subOrderId,order);
 }
 const digest=createHash('sha256').update(bytes).update(JSON.stringify({mapping,reportAsOf:asOf.toISOString(),sheetName,headerRow})).digest('hex');
 const result=await transaction(async db=>{
  const reportSkus=[...new Set(parsed.rows.map(row=>text(row[mapping.sku])))];
  const valid=(await db.query(`SELECT sku AS external_sku FROM ci_master_sku WHERE tenant_id=$1 AND sku=ANY($3::text[])
   UNION SELECT external_sku FROM ci_channel_mapping WHERE tenant_id=$1 AND account_id=$2 AND external_sku=ANY($3::text[])`,[tenantId,account.id,reportSkus])).rows;
  const known=new Set(valid.map(row=>row.external_sku));
  const unknown=[...new Set(parsed.rows.map(row=>text(row[mapping.sku])))].filter(sku=>!known.has(sku));
  if(unknown.length)throw Object.assign(new Error(`Map these Meesho supplier SKUs to Master SKUs first: ${unknown.slice(0,5).join(', ')}`),{status:409});
  const ambiguous=(await db.query(`SELECT external_sku FROM ci_channel_mapping WHERE tenant_id=$1 AND account_id=$2 AND external_sku=ANY($3::text[])
   GROUP BY external_sku HAVING count(DISTINCT master_sku_id)>1 LIMIT 5`,[tenantId,account.id,reportSkus])).rows;
  if(ambiguous.length)throw Object.assign(new Error(`Resolve ambiguous Meesho SKU mappings first: ${ambiguous.map(row=>row.external_sku).join(', ')}`),{status:409});
  const receipt=await db.query('INSERT INTO ci_ingress(tenant_id,source,message_id,payload_hash) VALUES($1,$2,$3,$3) ON CONFLICT DO NOTHING RETURNING message_id',[tenantId,`meesho-report:${account.id}`,digest]);
  if(!receipt.rowCount)return {duplicate:true,orders:0,lines:0};
  let orders=0;
  for(const event of grouped.values())if(await recordIncomingOrder(db,{tenantId,accountId:account.id,platform:'meesho',event,topic:'report_observed',notify:false}))orders++;
  await db.query("UPDATE ci_channel_account SET connection_state='report_observed',settings=settings||jsonb_build_object('lastOrderReportAt',$3::timestamptz),updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,account.id,asOf.toISOString()]);
  return {duplicate:false,orders,lines:parsed.rows.length};
 });
 if(!result.duplicate)await tryLogSyncAttempt({tenantId,accountId:account.id,direction:'read',operation:'meesho_order_report',skuCount:result.lines,diagnostic:{orders:result.orders,lines:result.lines,reportAsOf:asOf.toISOString(),readOnly:true}});
 return result;
}
