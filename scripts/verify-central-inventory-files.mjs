import '../env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import ExcelJS from 'exceljs';
import { mkdir,writeFile } from 'node:fs/promises';
import { inventoryPool,migrateInventory,transaction } from '../inventory/db.js';
import { applyInventoryEventInTransaction } from '../inventory/ledger.js';
import { inventoryPrivate } from '../inventory/http.js';
import { parseInventoryWorkbook } from '../inventory/workbook.js';

const testDatabase=new URL(process.env.INVENTORY_DATABASE_URL||'');
if(!['localhost','127.0.0.1','::1'].includes(testDatabase.hostname)||!/^\/codexqa_test_files_/.test(testDatabase.pathname))throw new Error('Use scripts/run-isolated-inventory-files.mjs');
const tenant=`files-test-${randomUUID()}`;process.env.INVENTORY_ALLOWED_TENANT_ID=tenant;
await migrateInventory();const app=express();app.use(express.json({limit:'10mb'}));
const allPermissions=['central_inventory.catalog.write','central_inventory.master_data.write','central_inventory.stock_count.write','central_inventory.stock_adjustment.write','central_inventory.alerts.manage','central_inventory.opening_stock.read','central_inventory.opening_stock.stage','central_inventory.opening_stock.request_approval','central_inventory.opening_stock.approve','central_inventory.opening_stock.post'];
app.use((req,_res,next)=>{if(req.get('x-fixture-role')!=='unauthenticated')req.user={username:req.get('x-fixture-actor')||'files-fixture',permissions:req.get('x-fixture-role')==='none'?[]:allPermissions};next();});app.use('/inventory',inventoryPrivate);
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/inventory/central`;
const request=async(path,body,role='all')=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-fixture-role':role},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
async function workbook(rows,headers=['SKU','Product Name','Stock']){const wb=new ExcelJS.Workbook();for(const name of ['Physical counts','Catalog']){const ws=wb.addWorksheet(name);ws.addRow(headers);rows.forEach(row=>ws.addRow(row));}return Buffer.from(await wb.xlsx.writeBuffer());}
async function mappedWorkbook(sku='REAL-STYLE-32B',quantity=145){const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Marketplace export');ws.addRow(['Generated report']);ws.addRow([]);ws.addRow(['Seller SKU ID','Description','Stock']);ws.addRow([sku,'Mapped physical count',quantity]);return Buffer.from(await wb.xlsx.writeBuffer());}
async function preview(bytes,mode,locationId){return request('/imports/preview',{fileName:'stock.xlsx',base64:bytes.toString('base64'),mode,locationId});}
try{
  const guardedEventsBefore=(await request('/events')).data.length,guardedBatch='00000000-0000-4000-8000-000000000001';
  for(const [path,body] of [['/products',{sku:'DENIED',productName:'No write'}],['/locations',{code:'DENIED',locationType:'warehouse'}],['/adjustments',{masterSkuId:randomUUID(),locationId:randomUUID(),mode:'set',quantity:10,reason:'permission fixture',requestId:randomUUID()}],['/alert-rules',{masterSkuIds:[randomUUID()],threshold:1}],['/imports/opening-stock',{fileName:'empty.xlsx',base64:'AA=='}],['/imports/opening-stock/'+guardedBatch+'/request-approval',{}],['/imports/opening-stock/'+guardedBatch+'/approve',{}],['/imports/opening-stock/'+guardedBatch+'/post',{}]])assert.equal((await request(path,body,'none')).status,403,`Missing permission must block ${path}`);
  assert.equal((await request('/imports/opening-stock/'+guardedBatch,undefined,'none')).status,403,'Missing read permission must block batch details');
  assert.equal((await request('/imports/opening-stock',{fileName:'empty.xlsx',base64:'AA=='},'unauthenticated')).status,401,'Unauthenticated staging is rejected');
  assert.equal((await request('/events')).data.length,guardedEventsBefore,'Denied mutation routes leave the ledger unchanged');
  let result=await request('/locations',{code:'WH-FILES',locationType:'warehouse'});assert.equal(result.status,201);const locationId=result.data.id;
  const bytes=await workbook([['REAL-STYLE-32B','Reference style',500],['PACK-2','Pack SKU',0]]);
  result=await preview(bytes,'catalog');assert.equal(result.data.summary.rows,2);assert.equal(result.data.summary.stockChanges,0);const catalogId=result.data.id;
  assert.equal((await request(`/imports/${catalogId}/commit`,{})).data.newSkus,2);
  assert.equal((await request(`/imports/${catalogId}/commit`,{})).data.duplicate,true);
  let overview=(await request('/overview')).data;assert.ok(overview.products.every(p=>p.counted_locations===0));
  const masterSkuId=overview.products.find(p=>p.sku==='REAL-STYLE-32B').id;
  await request('/alert-rules',{masterSkuIds:[masterSkuId],threshold:100});assert.equal((await request('/overview')).data.alerts.length,0,'Uncounted stock must not trigger false alerts');
  result=await preview(bytes,'counts',locationId);assert.equal(result.data.id,null,'An ordinary count cannot create opening stock');assert.match(result.data.errors[0].message,/controlled opening-stock approval workflow/);
  await transaction(async db=>{for(const product of overview.products){const quantity=product.sku==='REAL-STYLE-32B'?150:4;await applyInventoryEventInTransaction(db,{tenantId:tenant,masterSkuId:product.id,locationId,eventKey:`fixture-opening:${product.id}`,eventType:'opening_stock',source:'synthetic_test_fixture',externalReference:'isolated test basis only',delta_on_hand:quantity});}});
  const mappedBytes=await mappedWorkbook(),mapping={sheet:'Marketplace export',headerRow:3,sku:{column:1,header:'Seller SKU ID'},quantity:{column:3,header:'Stock',format:'integer_plain'}};
  const mappedBefore=(await request('/events')).data.length;
  result=await request('/imports/preview',{fileName:'source-export.xlsx',base64:mappedBytes.toString('base64'),mode:'counts',locationId,mapping});
  assert.equal(result.data.summary.errors,0);assert.equal(result.data.summary.stockChanges,1);assert.equal(result.data.rows[0].sku,'REAL-STYLE-32B');assert.equal(result.data.rows[0].location,'WH-FILES');
  assert.equal((await request(`/imports/${result.data.id}/commit`,{},'none')).status,403);assert.equal((await request('/events')).data.length,mappedBefore,'Unprivileged mapped count cannot write stock');
  assert.equal((await request(`/imports/${result.data.id}/commit`,{})).data.stockEvents,1);
  assert.equal(Number((await request('/overview')).data.products.find(product=>product.sku==='REAL-STYLE-32B').on_hand),145,'Mapped source row updates the exact matched SKU balance');
  const mappingEvidence=(await inventoryPool().query("SELECT external_reference FROM ci_inventory_event WHERE tenant_id=$1 AND source='workbook' ORDER BY id DESC LIMIT 1",[tenant])).rows[0].external_reference;
  assert.match(mappingEvidence,/mappingSha256/,'Count ledger event records the exact source mapping digest');
  const unknownMapped=await request('/imports/preview',{fileName:'source-export.xlsx',base64:(await mappedWorkbook('NOT-A-CI-SKU',12)).toString('base64'),mode:'counts',locationId,mapping});
  assert.equal(unknownMapped.data.id,null);assert.equal(unknownMapped.data.summary.errors,1);assert.match(unknownMapped.data.errors[0].message,/does not exactly match a Central Inventory master SKU/);
  result=await preview(bytes,'counts',locationId);assert.equal(result.data.summary.errors,0);const countsId=result.data.id;
  const eventsBeforeDeniedCommit=(await request('/events')).data.length;assert.equal((await request(`/imports/${countsId}/commit`,{},'none')).status,403);assert.equal((await request('/events')).data.length,eventsBeforeDeniedCommit,'Missing count permission cannot write stock');
  assert.equal((await request(`/imports/${countsId}/commit`,{})).data.stockEvents,2);
  assert.equal((await request(`/imports/${countsId}/commit`,{})).data.duplicate,true);
  result=await request('/adjustments',{masterSkuId,locationId,mode:'delta',quantity:-405,reason:'Offline sale',requestId:'sale',alertThreshold:100});assert.equal(result.status,201);
  overview=(await request('/overview')).data;assert.equal(Number(overview.products.find(p=>p.id===masterSkuId).sellable),95);assert.equal(overview.alerts.length,1);
  const oldPreview=(await preview(bytes,'counts',locationId)).data;
  await request('/adjustments',{masterSkuId,locationId,mode:'delta',quantity:10,reason:'Receipt',requestId:'receipt'});
  assert.equal((await request(`/imports/${oldPreview.id}/commit`,{})).status,409,'Changed stock must reject stale count preview');
  assert.equal((await request('/overview')).data.alerts.length,0);
  const invalid=await preview(await workbook([['DUP','Duplicate',5],['DUP','Duplicate',7]]),'counts',locationId);assert.equal(invalid.data.id,null);assert.ok(invalid.data.summary.errors>0);
  const unknownCount=await preview(await workbook([['UNKNOWN-COUNT-SKU','Must not create master SKU',9]]),'counts',locationId);assert.equal(unknownCount.data.id,null);assert.equal(unknownCount.data.summary.newSkus,0);assert.match(unknownCount.data.errors[0].message,/does not exactly match a Central Inventory master SKU/);
  const negative=await preview(await workbook([['BAD','Invalid',-1]]),'counts',locationId);assert.equal(negative.data.id,null);
  const formula=await parseInventoryWorkbook(await workbook([['FORMULA','Formula',{formula:'1+1',result:2}]]),'counts');assert.ok(formula.errors.some(e=>e.message.includes('Formula')));
  const before=(await request('/events')).data.length;
  const foreign=await request('/imports/preview',{fileName:'x.xlsx',base64:bytes.toString('base64'),mode:'counts',locationId,tenantId:'another-tenant'});assert.equal(foreign.status,403);
  const template=await fetch(base+'/template');assert.equal(template.status,200);const templateWb=new ExcelJS.Workbook();await templateWb.xlsx.load(Buffer.from(await template.arrayBuffer()));assert.equal(templateWb.worksheets[0].name,'Physical counts');assert.ok(templateWb.getWorksheet('Catalog'));const instructions=templateWb.getWorksheet('Instructions');assert.ok(instructions);const instructionText=Array.from({length:instructions.rowCount},(_,index)=>instructions.getCell(index+1,2).text).join(' ');assert.match(instructionText,/50,000 data rows/);assert.match(instructionText,/mapped count workflow/);
  await mkdir('artifacts/central-inventory',{recursive:true});
  for(const format of ['xlsx','pdf']){
    const response=await fetch(base+'/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format})});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());await writeFile(`artifacts/central-inventory/verified-export.${format}`,bytes);
    if(format==='xlsx'){
      const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);const ws=wb.getWorksheet('Physical counts');assert.equal(ws.rowCount,3);assert.equal(ws.getRow(3).getCell(4).value,105);
      const parsed=await parseInventoryWorkbook(bytes,'counts');assert.equal(parsed.errors.length,0);assert.equal(parsed.rows.length,2);
    }else assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  }
  assert.equal((await request('/events')).data.length,before,'Exports must not change ledger');
  const summary=(await request('/summary')).data;assert.equal(summary.countedSkus,2);assert.equal(summary.sellable,105);
  const concurrentPreviews=await Promise.all([preview(bytes,'counts',locationId),preview(bytes,'counts',locationId)]);
  assert.ok(concurrentPreviews.every(p=>p.data.id));
  const competing=await Promise.all(concurrentPreviews.map(p=>request(`/imports/${p.data.id}/commit`,{})));
  assert.deepEqual(competing.map(r=>r.status).sort(),[200,409],'Two previews of the same balance version must yield one commit and one stale conflict');
  const replayPreview=(await preview(bytes,'counts',locationId)).data;
  const eventsBeforeReplay=(await request('/events')).data.length;
  const sameBatch=await Promise.all([request(`/imports/${replayPreview.id}/commit`,{}),request(`/imports/${replayPreview.id}/commit`,{})]);
  assert.ok(sameBatch.every(r=>r.status===200));assert.equal(sameBatch.filter(r=>r.data.duplicate===true).length,1);
  assert.equal((await request('/events')).data.length,eventsBeforeReplay+2,'Concurrent same-batch replay must create one event per input row');
  const newCountSku=await preview(await workbook([['AAA-ROLLBACK','Must roll back',7]]),'catalog');assert.ok(newCountSku.data.id);await request(`/imports/${newCountSku.data.id}/commit`,{});
  const rollbackSku=(await inventoryPool().query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND sku=$2',[tenant,'AAA-ROLLBACK'])).rows[0].id;
  await transaction(db=>applyInventoryEventInTransaction(db,{tenantId:tenant,masterSkuId:rollbackSku,locationId,eventKey:'fixture-opening:AAA-ROLLBACK',eventType:'opening_stock',source:'synthetic_test_fixture',externalReference:'isolated test basis only',delta_on_hand:7}));
  const rollbackBytes=await workbook([['AAA-ROLLBACK','Must roll back',7],['REAL-STYLE-32B','Reference style',500]]);
  const rollbackPreview=(await preview(rollbackBytes,'counts',locationId)).data;assert.ok(rollbackPreview.id);
  await request('/adjustments',{masterSkuId,locationId,mode:'delta',quantity:1,reason:'Invalidate later row',requestId:'rollback-race'});
  const eventsBeforeRollback=(await request('/events')).data.length;
  assert.equal((await request(`/imports/${rollbackPreview.id}/commit`,{})).status,409);
  assert.equal((await request('/events')).data.length,eventsBeforeRollback,'Later-row conflict must roll back earlier-row count events');
  assert.equal(Number((await request('/overview')).data.products.find(p=>p.sku==='AAA-ROLLBACK').on_hand),7,'Later-row conflict must preserve the prior verified on-hand balance');
  assert.equal((await inventoryPool().query("SELECT count(*) FROM ci_inventory_event WHERE tenant_id=$1 AND master_sku_id=$2 AND event_type='physical_count' AND source='workbook'",[tenant,rollbackSku])).rows[0].count,'0','Later-row conflict must roll back earlier-row stock count event');
  assert.equal((await inventoryPool().query('SELECT status FROM ci_import_batch WHERE tenant_id=$1 AND id=$2',[tenant,rollbackPreview.id])).rows[0].status,'preview');
  console.log('PASS template and mapped-workbook SKU counts, exact SKU update, mapping digest, permission enforcement, idempotency, stale preview rejection, duplicate/negative/formula rejection, tenant isolation, alert lifecycle, Excel roundtrip, PDF and dashboard totals');
}finally{await new Promise(r=>server.close(r));await inventoryPool().end();}
