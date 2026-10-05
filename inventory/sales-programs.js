import express from 'express';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inventoryPool, transaction } from './db.js';
import { parsePartnerReport } from './report-parser.js';

export const salesPrograms=JSON.parse(readFileSync(new URL('./sales-program-catalog.json',import.meta.url),'utf8'));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function programAccount(db,tenantId,accountId,key){
 const config=salesPrograms.find(item=>item.key===key);
 if(!config||!uuid.test(accountId||''))throw fail('Choose a supported programme and seller account');
 const account=(await db.query('SELECT id,platform,external_account_id FROM ci_channel_account WHERE tenant_id=$1 AND id=$2',[tenantId,accountId])).rows[0];
 if(!account)throw fail('Seller account not found',404);
 if(!config.parents.includes(account.platform))throw fail(`${config.name} must use a compatible parent seller account`);
 return {config,account};
}

// Reports classify existing orders and observe stock. They never call the ledger,
// create a seller order, enqueue stock publication, or change provider status.
export async function importProgramReport({tenantId,accountId,programKey,kind,fileName,bytes,headerRow,sheetName,mapping,reportAsOf,programOnly}){
 if(!['orders','stock'].includes(kind)||programOnly!==true)throw fail('Confirm this report contains only the selected programme');
 const parsed=await parsePartnerReport({fileName,bytes,headerRow,sheetName});
 if(!parsed.rows.length||parsed.rows.length>2000)throw fail('Programme reports must contain 1–2,000 rows; split larger exports');
 const required=kind==='orders'?['orderId']:['sku','location','quantity'];
 if(!mapping||required.some(key=>!parsed.headers.includes(mapping[key]))||new Set(required.map(key=>mapping[key])).size!==required.length)throw fail('Map each required field to a distinct actual report column');
 const asOf=new Date(reportAsOf);
 if(!Number.isFinite(asOf.getTime())||asOf.getTime()<Date.UTC(2010,0,1)||asOf.getTime()>Date.now()+300000)throw fail('Enter the actual report export time');
 const digest=createHash('sha256').update(bytes).update(JSON.stringify({kind,mapping,headerRow,sheetName,asOf:asOf.toISOString()})).digest('hex');
 return transaction(async db=>{
  await programAccount(db,tenantId,accountId,programKey);
  const setup=(await db.query('SELECT * FROM ci_sales_program WHERE tenant_id=$1 AND account_id=$2 AND program_key=$3 FOR UPDATE',[tenantId,accountId,programKey])).rows[0];
  if(!setup||!setup.reference)throw fail('Save the programme enrollment/report reference first',409);
  if(kind==='stock'&&setup.stock_mode==='unverified')throw fail('Declare the stock ownership from your supplier contract before importing stock',409);
  const receipt=await db.query('INSERT INTO ci_ingress(tenant_id,source,message_id,payload_hash) VALUES($1,$2,$3,$3) ON CONFLICT DO NOTHING RETURNING message_id',[tenantId,`program-report:${accountId}:${programKey}`,digest]);
  if(!receipt.rowCount)return {duplicate:true,count:0,stale:0};
  let count=0,stale=0;
  if(kind==='orders'){
   const ids=[...new Set(parsed.rows.map(row=>String(row[mapping.orderId]||'').trim()))];
   if(ids.some(id=>!id||id.length>120))throw fail('Every row needs the exact parent-platform order ID');
   const found=(await db.query(`SELECT o.id,o.external_order_id,p.program_key FROM ci_unified_order o
    LEFT JOIN ci_program_order p ON p.tenant_id=o.tenant_id AND p.order_id=o.id
    WHERE o.tenant_id=$1 AND o.account_id=$2 AND o.external_order_id=ANY($3::text[]) FOR UPDATE OF o`,[tenantId,accountId,ids])).rows;
   const missing=ids.filter(id=>!found.some(row=>row.external_order_id===id));
   if(missing.length)throw fail(`Orders must first arrive through the parent account. Not found: ${missing.slice(0,5).join(', ')}`,409);
   if(found.some(row=>row.program_key&&row.program_key!==programKey))throw fail('An order is already assigned to a different programme; resolve it before importing',409);
   const result=await db.query(`INSERT INTO ci_program_order(tenant_id,account_id,program_key,order_id,reference,observed_at)
   SELECT $1,$2,$3,unnest($4::uuid[]),$5,$6::timestamptz
    ON CONFLICT(tenant_id,order_id) DO UPDATE SET reference=EXCLUDED.reference,observed_at=EXCLUDED.observed_at
    WHERE EXCLUDED.program_key=ci_program_order.program_key AND EXCLUDED.observed_at>ci_program_order.observed_at RETURNING order_id`,[tenantId,accountId,programKey,found.map(row=>row.id),digest,asOf.toISOString()]);
   const assignedElsewhere=(await db.query('SELECT DISTINCT program_key FROM ci_program_order WHERE tenant_id=$1 AND order_id=ANY($2::uuid[]) AND program_key<>$3',[tenantId,found.map(row=>row.id),programKey])).rows;
   if(assignedElsewhere.length)throw fail('An order was assigned to a different programme concurrently; refresh and resolve it',409);
   for(const row of result.rows)await db.query(`INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail)
    VALUES($1,$2,$3,'programme_report_observed',$4) ON CONFLICT(tenant_id,event_key) DO NOTHING`,
    [tenantId,row.order_id,`programme:${programKey}:${row.order_id}:${asOf.toISOString()}`,JSON.stringify({program:programKey,source:'authorized_parent_order_report'})]);
   count=result.rowCount;stale=ids.length-count;
  }else{
   const seen=new Set();
   const rows=parsed.rows.map((row,index)=>{
    const sku=String(row[mapping.sku]||'').trim(),location=String(row[mapping.location]||'').trim(),raw=String(row[mapping.quantity]||'').trim(),quantity=Number(raw);
    if(!sku||sku.length>120||!location||location.length>120||!/^\d+$/.test(raw)||!Number.isSafeInteger(quantity))throw fail(`Invalid SKU, facility or nonnegative whole quantity at data row ${index+1}`);
    const key=JSON.stringify([sku,location]);if(seen.has(key))throw fail(`Duplicate SKU/facility at data row ${index+1}`);seen.add(key);
    return {sku,location,quantity};
   });
   const matches=(await db.query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($3::jsonb) AS r(sku text,location text))
    SELECT r.sku,r.location,s.id AS master_sku_id FROM incoming r JOIN ci_master_sku s ON s.tenant_id=$1 AND s.sku=r.sku
    UNION SELECT r.sku,r.location,m.master_sku_id FROM incoming r JOIN ci_channel_mapping m ON m.tenant_id=$1 AND m.account_id=$2 AND m.external_sku=r.sku AND m.external_location_id=r.location`,[tenantId,accountId,JSON.stringify(rows)])).rows;
   for(const row of rows){
    const ids=[...new Set(matches.filter(m=>m.sku===row.sku&&m.location===row.location).map(m=>m.master_sku_id))];
    if(ids.length!==1)throw fail(`SKU ${row.sku} at ${row.location} needs one exact Master SKU mapping`,409);
    row.master_sku_id=ids[0];
   }
   const conflict=await db.query(`SELECT 1 FROM ci_program_stock s JOIN jsonb_to_recordset($4::jsonb) AS r(sku text,location text,quantity bigint,master_sku_id uuid)
    ON s.external_sku=r.sku AND s.external_location_id=r.location WHERE s.tenant_id=$1 AND s.account_id=$2 AND s.program_key=$3 AND s.observed_at=$5::timestamptz AND (s.observed_quantity<>r.quantity OR s.master_sku_id<>r.master_sku_id) LIMIT 1`,[tenantId,accountId,programKey,JSON.stringify(rows),asOf.toISOString()]);
   if(conflict.rowCount)throw fail('A different quantity or mapping already exists for this report time; resolve the source discrepancy',409);
   const result=await db.query(`INSERT INTO ci_program_stock(tenant_id,account_id,program_key,external_sku,external_location_id,master_sku_id,observed_quantity,observed_at)
    SELECT $1,$2,$3,r.sku,r.location,r.master_sku_id,r.quantity,$5::timestamptz FROM jsonb_to_recordset($4::jsonb) AS r(sku text,location text,quantity bigint,master_sku_id uuid)
    ON CONFLICT(tenant_id,account_id,program_key,external_sku,external_location_id) DO UPDATE SET master_sku_id=EXCLUDED.master_sku_id,observed_quantity=EXCLUDED.observed_quantity,observed_at=EXCLUDED.observed_at
    WHERE EXCLUDED.observed_at>ci_program_stock.observed_at RETURNING external_sku`,[tenantId,accountId,programKey,JSON.stringify(rows),asOf.toISOString()]);
   count=result.rowCount;stale=rows.length-count;
  }
  await db.query('UPDATE ci_sales_program SET last_report_at=greatest(last_report_at,$4::timestamptz),updated_at=now() WHERE tenant_id=$1 AND account_id=$2 AND program_key=$3',[tenantId,accountId,programKey,asOf.toISOString()]);
  await db.query("INSERT INTO ci_sync_attempt(tenant_id,account_id,direction,operation,sku_count,status,diagnostic,completed_at) VALUES($1,$2,'read',$3,$4,'success',$5,now())",[tenantId,accountId,`program_${kind}_report`,kind==='stock'?count:0,JSON.stringify({program:programKey,orders:kind==='orders'?count:undefined,count,stale,readOnly:true})]);
  return {duplicate:false,count,stale};
 });
}

export const salesProgramsApi=express.Router();
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error.status||500).json({error:error.status?error.message:'Programme operation unavailable; check database readiness'});}};
salesProgramsApi.get('/',wrap(async(req,res)=>{
 const [accounts,setups]=await Promise.all([
  inventoryPool().query(`SELECT id,platform,external_account_id,status,connection_state,verified_at,
   coalesce(settings->>'orderObservationEnabled'='true',false) AS order_observation_enabled,
   coalesce(settings->>'webhooksReady'='true',false) AS webhooks_ready
   FROM ci_channel_account WHERE tenant_id=$1 ORDER BY platform,external_account_id`,[req.inventoryTenantId]),
  inventoryPool().query(`SELECT p.*, (SELECT count(*)::integer FROM ci_program_order o WHERE o.tenant_id=p.tenant_id AND o.account_id=p.account_id AND o.program_key=p.program_key) AS orders,
   (SELECT count(*)::integer FROM ci_program_stock s WHERE s.tenant_id=p.tenant_id AND s.account_id=p.account_id AND s.program_key=p.program_key) AS stock_rows
   FROM ci_sales_program p WHERE p.tenant_id=$1 ORDER BY p.program_key,p.account_id`,[req.inventoryTenantId])
 ]);
 res.json({programs:salesPrograms,accounts:accounts.rows,setups:setups.rows,liveSyncAvailable:false});
}));
salesProgramsApi.post('/:key/:accountId/setup',wrap(async(req,res)=>{
 await programAccount(inventoryPool(),req.inventoryTenantId,req.params.accountId,req.params.key);
 const mode=req.body.stockMode,reference=String(req.body.reference||'').trim();
 if(!['unverified','shared','dedicated','custody'].includes(mode)||!reference||reference.length>250)throw fail('Select stock ownership and enter a supplier enrollment/report reference (up to 250 characters)');
 await transaction(async db=>{
  const existing=(await db.query('SELECT stock_mode FROM ci_sales_program WHERE tenant_id=$1 AND account_id=$2 AND program_key=$3 FOR UPDATE',[req.inventoryTenantId,req.params.accountId,req.params.key])).rows[0];
  if(existing&&existing.stock_mode!==mode){const stock=await db.query('SELECT 1 FROM ci_program_stock WHERE tenant_id=$1 AND account_id=$2 AND program_key=$3 LIMIT 1',[req.inventoryTenantId,req.params.accountId,req.params.key]);if(stock.rowCount)throw fail('Stock ownership cannot change after observations exist; reconcile the facility ownership first',409);}
  await db.query(`INSERT INTO ci_sales_program(tenant_id,account_id,program_key,stock_mode,reference) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(tenant_id,account_id,program_key) DO UPDATE SET stock_mode=EXCLUDED.stock_mode,reference=EXCLUDED.reference,updated_at=now()`,[req.inventoryTenantId,req.params.accountId,req.params.key,mode,reference]);
 });res.json({saved:true,liveSyncAvailable:false});
}));
salesProgramsApi.post('/:key/:accountId/inspect',wrap(async(req,res)=>{
 await programAccount(inventoryPool(),req.inventoryTenantId,req.params.accountId,req.params.key);
 const report=await parsePartnerReport({fileName:req.body.fileName,bytes:Buffer.from(String(req.body.base64||''),'base64'),headerRow:Number(req.body.headerRow??1),sheetName:req.body.sheetName});
 res.json({headers:report.headers,rows:report.rows.length,sheet:report.sheet});
}));
salesProgramsApi.post('/:key/:accountId/import',wrap(async(req,res)=>res.json(await importProgramReport({tenantId:req.inventoryTenantId,accountId:req.params.accountId,programKey:req.params.key,...Object.fromEntries(['kind','fileName','mapping','reportAsOf','programOnly','sheetName'].map(key=>[key,req.body[key]])),headerRow:Number(req.body.headerRow??1),bytes:Buffer.from(String(req.body.base64||''),'base64')}))));
salesProgramsApi.get('/:key/:accountId/stock',wrap(async(req,res)=>{
 await programAccount(inventoryPool(),req.inventoryTenantId,req.params.accountId,req.params.key);
 const page=Math.max(1,Math.min(100000,Number.parseInt(String(req.query.page||'1'),10)||1));
 const params=[req.inventoryTenantId,req.params.accountId,req.params.key];
 const [count,result]=await Promise.all([
  inventoryPool().query('SELECT count(*)::integer AS total FROM ci_program_stock WHERE tenant_id=$1 AND account_id=$2 AND program_key=$3',params),
  inventoryPool().query('SELECT external_sku,external_location_id,observed_quantity,observed_at FROM ci_program_stock WHERE tenant_id=$1 AND account_id=$2 AND program_key=$3 ORDER BY external_sku,external_location_id LIMIT 25 OFFSET $4',[...params,(page-1)*25])
 ]);res.json({rows:result.rows,total:count.rows[0].total,page});
}));
