import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import express from 'express';
import { inventoryPool, migrateInventory } from '../inventory/db.js';
import { inventoryFilesApi } from '../inventory/files-api.js';
import { stageOpeningStockDraft, requestOpeningStockApproval, approveOpeningStock, postApprovedOpeningStock } from '../inventory/opening-stock-service.js';

const url = new URL(process.env.INVENTORY_DATABASE_URL || '');
if (!['127.0.0.1','localhost','::1'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Opening-stock verifier requires an owned loopback _test database');
await migrateInventory();
await migrateInventory();
const db = inventoryPool(), tenant = 'opening-stock-fixture';
let httpServer;
try {
  const sku = (await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,'FIXTURE-SKU','Fixture') RETURNING id,opening_stock_active",[tenant])).rows[0];
  const location = (await db.query("INSERT INTO ci_location(tenant_id,code,location_type) VALUES($1,'FIXTURE-WH','warehouse') RETURNING id,opening_stock_active",[tenant])).rows[0];
  assert.equal(sku.opening_stock_active,null,'Existing/default identity is unverified, not inferred active');
  assert.equal(location.opening_stock_active,null,'Existing/default location is unverified, not inferred active');
  await assert.rejects(db.query('UPDATE ci_master_sku SET opening_stock_active=true WHERE tenant_id=$1 AND id=$2',[tenant,sku.id]),{code:'23514'});
  await assert.rejects(db.query('UPDATE ci_location SET opening_stock_active=true WHERE tenant_id=$1 AND id=$2',[tenant,location.id]),{code:'23514'});
  const digest='a'.repeat(64);
  const batch=(await db.query(`INSERT INTO ci_opening_stock_batch
    (tenant_id,source_reference,file_sha256,file_name,file_bytes,source_date,mapping_version,mapping_sha256,row_digest,rows_read,rows_valid,validation_summary,created_by)
    VALUES($1,'fixture-reference',$2,'fixture.xlsx',100,'2026-01-01','fixture-v1',$2,$2,1,1,'{}','fixture-actor') RETURNING id,status`,[tenant,digest])).rows[0];
  assert.equal(batch.status,'DRAFT');
  await db.query('INSERT INTO ci_opening_stock_line(tenant_id,batch_id,sheet_name,source_row,master_sku_id,location_id,quantity,uom) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,batch.id,'Count',2,sku.id,location.id,7,'EA']);
  await assert.rejects(db.query('INSERT INTO ci_opening_stock_line(tenant_id,batch_id,sheet_name,source_row,master_sku_id,location_id,quantity,uom) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[tenant,batch.id,'Count',3,sku.id,location.id,8,'EA']),{code:'23505'});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ci_inventory_event WHERE tenant_id=$1',[tenant])).rows[0].n,0,'Draft metadata must not post stock');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ci_inventory_balance WHERE tenant_id=$1',[tenant])).rows[0].n,0,'Draft metadata must not create balance');
  await db.query("UPDATE ci_master_sku SET opening_stock_active=true,opening_stock_verified_at=now(),opening_stock_verified_by='fixture-verifier' WHERE tenant_id=$1 AND id=$2",[tenant,sku.id]);
  await db.query("UPDATE ci_location SET opening_stock_active=true,opening_stock_verified_at=now(),opening_stock_verified_by='fixture-verifier' WHERE tenant_id=$1 AND id=$2",[tenant,location.id]);
  const otherSku=(await db.query("INSERT INTO ci_master_sku(tenant_id,sku,product_name,opening_stock_active,opening_stock_verified_at,opening_stock_verified_by) VALUES($1,'FIXTURE-SECOND','Fixture second',true,now(),'fixture-verifier') RETURNING id",[tenant])).rows[0];
  const reverseSourceOrder=[{id:sku.id,code:'FIXTURE-SKU',quantity:7},{id:otherSku.id,code:'FIXTURE-SECOND',quantity:11}].sort((a,b)=>b.id.localeCompare(a.id));
  assert.ok(reverseSourceOrder[0].id.localeCompare(reverseSourceOrder[1].id)>0,'Fixture workbook must oppose UUID lock order');
  const mapping={version:'fixture-map-v1',sheet:'Counts',headerRow:1,
    sku:{column:1,header:'SKU',transform:'trim'},
    location:{mode:'column',column:2,header:'Facility',transform:'trim'},
    quantity:{column:3,header:'On hand',format:'integer_plain'},
    unitContract:'exact_sku_units',uom:'EA'};
  const workbook=async (quantity,includeSecond=false)=>{const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Counts');ws.addRow(['SKU','Facility','On hand']);for(const item of includeSecond?reverseSourceOrder:[{code:'FIXTURE-SKU',quantity}])ws.addRow([item.code,'FIXTURE-WH',item.code==='FIXTURE-SKU'?quantity:item.quantity]);return Buffer.from(await wb.xlsx.writeBuffer());};
  const input={tenantId:tenant,sourceReference:'approved-source-one',sourceDate:'2026-01-02',fileName:'fixture.xlsx',bytes:await workbook(7,true),mapping,actor:'fixture-creator'};
  const app=express();app.use(express.json({limit:'10mb'}));app.use((req,_res,next)=>{req.inventoryTenantId=tenant;next();});app.use(inventoryFilesApi);
  httpServer=app.listen(0,'127.0.0.1');await new Promise(resolve=>httpServer.once('listening',resolve));
  const dryRun=await fetch(`http://127.0.0.1:${httpServer.address().port}/imports/opening-stock/dry-run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fileName:'fixture.xlsx',base64:input.bytes.toString('base64'),mapping})});
  assert.equal(dryRun.status,200);
  const dryReport=await dryRun.json();
  assert.equal(dryReport.rowsRead,2);assert.equal(dryReport.rowsReadyForApproval,2);assert.equal(dryReport.rowsReadyToImport,0);assert.deepEqual(dryReport.rejectedRows,[]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ci_inventory_event WHERE tenant_id=$1',[tenant])).rows[0].n,0,'HTTP dry run must not post stock');
  const staged=await Promise.all([stageOpeningStockDraft(input),stageOpeningStockDraft(input)]);
  assert.equal(staged.filter(item=>item.duplicate).length,1,'Concurrent same-source staging must create one logical batch');
  const draft=staged.find(item=>!item.duplicate);assert.equal(draft.status,'VALIDATED');
  assert.equal((await stageOpeningStockDraft(input)).duplicate,true,'Exact source replay must return prior batch');
  await assert.rejects(stageOpeningStockDraft({...input,bytes:await workbook(8,true)}),/source identity was reused/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ci_inventory_event WHERE tenant_id=$1',[tenant])).rows[0].n,0,'Validation and staging must not post stock');
  await requestOpeningStockApproval({tenantId:tenant,batchId:draft.id,actor:'fixture-creator'});
  await assert.rejects(approveOpeningStock({tenantId:tenant,batchId:draft.id,actor:'fixture-creator'}),/Creator cannot approve/);
  await approveOpeningStock({tenantId:tenant,batchId:draft.id,actor:'fixture-approver'});
  await assert.rejects(postApprovedOpeningStock({tenantId:tenant,batchId:draft.id,actor:'fixture-approver'}),/separate creator, approver and poster/);
  const attempts=await Promise.all([
    postApprovedOpeningStock({tenantId:tenant,batchId:draft.id,actor:'fixture-poster'}),
    postApprovedOpeningStock({tenantId:tenant,batchId:draft.id,actor:'fixture-poster'}),
  ]);
  assert.equal(attempts.filter(item=>item.duplicate).length,1,'Concurrent same-batch replay posts once');
  const posted=attempts.find(item=>!item.duplicate);
  assert.equal(posted.rows,2);
  const event=(await db.query("SELECT * FROM ci_inventory_event WHERE tenant_id=$1 AND source='controlled_opening_import'",[tenant])).rows;
  assert.equal(event.length,2);
  assert.deepEqual(event.map(item=>Number(item.delta_on_hand)).sort((a,b)=>a-b),[7,11]);
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,sku.id,location.id])).rows[0].on_hand),7);
  assert.equal(Number((await db.query('SELECT on_hand FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3',[tenant,otherSku.id,location.id])).rows[0].on_hand),11);
  assert.equal((await db.query('SELECT status FROM ci_opening_stock_batch WHERE tenant_id=$1 AND id=$2',[tenant,draft.id])).rows[0].status,'RECONCILED');
  const second=await stageOpeningStockDraft({...input,sourceReference:'approved-source-two',sourceDate:'2026-01-03',bytes:await workbook(8)});
  await requestOpeningStockApproval({tenantId:tenant,batchId:second.id,actor:'fixture-creator'});
  await approveOpeningStock({tenantId:tenant,batchId:second.id,actor:'fixture-approver'});
  await assert.rejects(postApprovedOpeningStock({tenantId:tenant,batchId:second.id,actor:'fixture-poster'}),/unused SKU\/location balance/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM ci_inventory_event WHERE tenant_id=$1 AND source='controlled_opening_import'",[tenant])).rows[0].n,2);
  console.log('PASS isolated opening-stock migration, multi-SKU source order, exact replay/conflict, dual control, ledger posting and readback');
} finally { if(httpServer)await new Promise(resolve=>httpServer.close(resolve));await db.end(); }
