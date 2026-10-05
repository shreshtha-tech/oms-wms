import '../env.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import ExcelJS from 'exceljs';
import { mkdir,writeFile } from 'node:fs/promises';
import { inventoryPool,migrateInventory } from '../inventory/db.js';
import { inventoryPrivate } from '../inventory/http.js';
import { parseInventoryWorkbook } from '../inventory/workbook.js';

const testDatabase=new URL(process.env.INVENTORY_DATABASE_URL||'');
if(!['localhost','127.0.0.1','::1'].includes(testDatabase.hostname)||!/^\/codexqa_test_files_/.test(testDatabase.pathname))throw new Error('Use scripts/run-isolated-inventory-files.mjs');
const tenant=`files-test-${randomUUID()}`;process.env.INVENTORY_ALLOWED_TENANT_ID=tenant;
await migrateInventory();const app=express();app.use(express.json({limit:'10mb'}));app.use('/inventory',inventoryPrivate);
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/inventory/central`;
const request=async(path,body)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
async function workbook(rows,headers=['SKU','Product Name','Stock']){const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Catalog');ws.addRow(headers);rows.forEach(row=>ws.addRow(row));return Buffer.from(await wb.xlsx.writeBuffer());}
async function preview(bytes,mode,locationId){return request('/imports/preview',{fileName:'stock.xlsx',base64:bytes.toString('base64'),mode,locationId});}
try{
  let result=await request('/locations',{code:'WH-FILES',locationType:'warehouse'});assert.equal(result.status,201);const locationId=result.data.id;
  const bytes=await workbook([['REAL-STYLE-32B','Reference style',500],['PACK-2','Pack SKU',0]]);
  result=await preview(bytes,'catalog');assert.equal(result.data.summary.rows,2);assert.equal(result.data.summary.stockChanges,0);const catalogId=result.data.id;
  assert.equal((await request(`/imports/${catalogId}/commit`,{})).data.newSkus,2);
  assert.equal((await request(`/imports/${catalogId}/commit`,{})).data.duplicate,true);
  let overview=(await request('/overview')).data;assert.ok(overview.products.every(p=>p.counted_locations===0));
  const masterSkuId=overview.products.find(p=>p.sku==='REAL-STYLE-32B').id;
  await request('/alert-rules',{masterSkuIds:[masterSkuId],threshold:100});assert.equal((await request('/overview')).data.alerts.length,0,'Uncounted stock must not trigger false alerts');
  result=await preview(bytes,'counts',locationId);assert.equal(result.data.summary.errors,0);const countsId=result.data.id;
  assert.equal((await request(`/imports/${countsId}/commit`,{})).data.stockEvents,2);
  assert.equal((await request(`/imports/${countsId}/commit`,{})).data.duplicate,true);
  result=await request('/adjustments',{masterSkuId,locationId,mode:'delta',quantity:-405,reason:'Offline sale',requestId:'sale',alertThreshold:100});assert.equal(result.status,201);
  overview=(await request('/overview')).data;assert.equal(Number(overview.products.find(p=>p.id===masterSkuId).sellable),95);assert.equal(overview.alerts.length,1);
  const oldPreview=(await preview(bytes,'counts',locationId)).data;
  await request('/adjustments',{masterSkuId,locationId,mode:'delta',quantity:10,reason:'Receipt',requestId:'receipt'});
  assert.equal((await request(`/imports/${oldPreview.id}/commit`,{})).status,409,'Changed stock must reject stale count preview');
  assert.equal((await request('/overview')).data.alerts.length,0);
  const invalid=await preview(await workbook([['DUP','Duplicate',5],['DUP','Duplicate',7]]),'counts',locationId);assert.equal(invalid.data.id,null);assert.ok(invalid.data.summary.errors>0);
  const negative=await preview(await workbook([['BAD','Invalid',-1]]),'counts',locationId);assert.equal(negative.data.id,null);
  const formula=await parseInventoryWorkbook(await workbook([['FORMULA','Formula',{formula:'1+1',result:2}]]),'counts');assert.ok(formula.errors.some(e=>e.message.includes('Formula')));
  const before=(await request('/events')).data.length;
  const foreign=await request('/imports/preview',{fileName:'x.xlsx',base64:bytes.toString('base64'),mode:'counts',locationId,tenantId:'another-tenant'});assert.equal(foreign.status,403);
  const template=await fetch(base+'/template');assert.equal(template.status,200);const templateWb=new ExcelJS.Workbook();await templateWb.xlsx.load(Buffer.from(await template.arrayBuffer()));assert.ok(templateWb.getWorksheet('Physical counts'));
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
  const rollbackBytes=await workbook([['AAA-ROLLBACK','Must roll back',7],['REAL-STYLE-32B','Reference style',500]]);
  const rollbackPreview=(await preview(rollbackBytes,'counts',locationId)).data;assert.ok(rollbackPreview.id);
  await request('/adjustments',{masterSkuId,locationId,mode:'delta',quantity:1,reason:'Invalidate later row',requestId:'rollback-race'});
  const eventsBeforeRollback=(await request('/events')).data.length;
  assert.equal((await request(`/imports/${rollbackPreview.id}/commit`,{})).status,409);
  assert.equal((await request('/events')).data.length,eventsBeforeRollback,'Later-row conflict must roll back earlier-row count events');
  assert.equal((await request('/overview')).data.products.some(p=>p.sku==='AAA-ROLLBACK'),false,'Later-row conflict must roll back earlier-row master creation');
  assert.equal((await inventoryPool().query('SELECT status FROM ci_import_batch WHERE tenant_id=$1 AND id=$2',[tenant,rollbackPreview.id])).rows[0].status,'preview');
  console.log('PASS workbook catalog/count imports, idempotency, stale preview rejection, duplicate/negative/formula rejection, tenant isolation, alert lifecycle, Excel roundtrip, PDF and dashboard totals');
}finally{await new Promise(r=>server.close(r));await inventoryPool().end();}
