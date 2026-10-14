import { sendDatabaseError } from '../reliability/api-errors.js';
import express from 'express';
import { previewWorkbook,commitWorkbook } from './workbook.js';
import { inspectInventoryWorkbook } from './workbook-inspector.js';
import { validateOpeningStockWorkbook } from './opening-stock-validation.js';
import { inventoryPool } from './db.js';
import { hasPermission, requirePermission } from '../api/auth-session.js';
import { approveOpeningStock, postApprovedOpeningStock, readOpeningStockBatch, requestOpeningStockApproval, stageOpeningStockDraft } from './opening-stock-service.js';
import { inventoryTemplate,inventoryExportData,inventoryXlsx,inventoryPdf } from './exports.js';
export const inventoryFilesApi=express.Router();
const fail=(res,error)=>sendDatabaseError(res,error)||res.status(error.status||400).json({error:error.message||'Inventory operation failed'});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function decodeWorkbookUpload({fileName,base64}={}){
  if(typeof fileName!=='string'||!/\.xlsx$/i.test(fileName)||typeof base64!=='string'||base64.length>9800000||!base64.match(/^[A-Za-z0-9+/]*={0,2}$/))throw new Error('Invalid .xlsx workbook upload (maximum 7 MB)');
  const bytes=Buffer.from(base64,'base64');
  if(!bytes.length||bytes.length>7*1024*1024)throw new Error('Workbook must be at most 7 MB');
  return bytes;
}
inventoryFilesApi.post('/imports/inspect',async(req,res)=>{
  try{
    const {fileName,base64}=req.body||{};
    if(typeof fileName!=='string'||!/\.xlsx$/i.test(fileName)||typeof base64!=='string'||base64.length>9800000||!base64.match(/^[A-Za-z0-9+/]*={0,2}$/))throw new Error('Invalid .xlsx workbook upload (maximum 7 MB)');
    const bytes=Buffer.from(base64,'base64');
    if(!bytes.length||bytes.length>7*1024*1024)throw new Error('Workbook must be at most 7 MB');
    res.set('Cache-Control','no-store').json(await inspectInventoryWorkbook(bytes,fileName));
  }catch(error){fail(res,error);}
});
inventoryFilesApi.post('/imports/opening-stock/dry-run',async(req,res)=>{
  try{
    const {fileName,base64,mapping}=req.body||{};
    if(typeof fileName!=='string'||!/\.xlsx$/i.test(fileName)||typeof base64!=='string'||base64.length>9800000||!base64.match(/^[A-Za-z0-9+/]*={0,2}$/))throw new Error('Invalid .xlsx workbook upload (maximum 7 MB)');
    const bytes=Buffer.from(base64,'base64');
    if(!bytes.length||bytes.length>7*1024*1024)throw new Error('Workbook must be at most 7 MB');
    const tenantId=req.inventoryTenantId;
    if(typeof tenantId!=='string'||!tenantId)throw new Error('Inventory tenant is not configured');
    const db=inventoryPool();
    const [skuRows,locationRows]=await Promise.all([
      db.query('SELECT id,tenant_id,sku,uom,opening_stock_active AS active FROM ci_master_sku WHERE tenant_id=$1',[tenantId]),
      db.query('SELECT id,tenant_id,code,location_type AS type,opening_stock_active AS active FROM ci_location WHERE tenant_id=$1',[tenantId]),
    ]);
    const report=await validateOpeningStockWorkbook({bytes,tenantId,mapping,
      skus:skuRows.rows.map(row=>({...row,tenantId:row.tenant_id})),
      locations:locationRows.rows.map(row=>({...row,tenantId:row.tenant_id})),
    });
    const {rows,...summary}=report;
    res.set('Cache-Control','no-store').json({...summary,rejectedRows:rows.filter(row=>row.status!=='VALID').slice(0,100).map(row=>({sheet:row.sheet,row:row.row,status:row.status,issues:row.issues}))});
  }catch(error){fail(res,error);}
});
inventoryFilesApi.post('/imports/opening-stock',requirePermission('central_inventory.opening_stock.stage'),async(req,res)=>{
  try{
    const bytes=decodeWorkbookUpload(req.body||{});
    const result=await stageOpeningStockDraft({...req.body,tenantId:req.inventoryTenantId,bytes,actor:req.user.username});
    res.status(result.duplicate?200:201).set('Cache-Control','no-store').json(result);
  }catch(error){fail(res,error);}
});
inventoryFilesApi.get('/imports/opening-stock/:id',requirePermission('central_inventory.opening_stock.read'),async(req,res)=>{
  try{
    if(!uuid(req.params.id))return res.status(400).json({error:'Invalid opening-stock batch ID'});
    const result=await readOpeningStockBatch({tenantId:req.inventoryTenantId,batchId:req.params.id});
    if(!result)return res.status(404).json({error:'Opening-stock batch not found'});
    res.set('Cache-Control','no-store').json(result);
  }catch(error){fail(res,error);}
});
inventoryFilesApi.post('/imports/opening-stock/:id/request-approval',requirePermission('central_inventory.opening_stock.request_approval'),async(req,res)=>{
  try{
    if(!uuid(req.params.id))return res.status(400).json({error:'Invalid opening-stock batch ID'});
    res.set('Cache-Control','no-store').json(await requestOpeningStockApproval({tenantId:req.inventoryTenantId,batchId:req.params.id,actor:req.user.username}));
  }catch(error){fail(res,error);}
});
inventoryFilesApi.post('/imports/opening-stock/:id/approve',requirePermission('central_inventory.opening_stock.approve'),async(req,res)=>{
  try{
    if(!uuid(req.params.id))return res.status(400).json({error:'Invalid opening-stock batch ID'});
    res.set('Cache-Control','no-store').json(await approveOpeningStock({tenantId:req.inventoryTenantId,batchId:req.params.id,actor:req.user.username}));
  }catch(error){fail(res,error);}
});
inventoryFilesApi.post('/imports/opening-stock/:id/post',requirePermission('central_inventory.opening_stock.post'),async(req,res)=>{
  try{
    if(!uuid(req.params.id))return res.status(400).json({error:'Invalid opening-stock batch ID'});
    res.set('Cache-Control','no-store').json(await postApprovedOpeningStock({tenantId:req.inventoryTenantId,batchId:req.params.id,actor:req.user.username}));
  }catch(error){fail(res,error);}
});
inventoryFilesApi.post('/imports/preview',async(req,res)=>{
  try{
    const {fileName,base64,mode,locationId,mapping}=req.body||{};
    if(typeof base64!=='string'||base64.length>9800000||!base64.match(/^[A-Za-z0-9+/]*={0,2}$/))throw new Error('Invalid workbook upload (maximum 7 MB)');
    res.json(await previewWorkbook({tenantId:req.inventoryTenantId,fileName,bytes:Buffer.from(base64,'base64'),mode,locationId,mapping}));
  }catch(error){fail(res,error);}
});
inventoryFilesApi.post('/imports/:id/commit',async(req,res)=>{
  try{
    const batch=(await inventoryPool().query('SELECT mode FROM ci_import_batch WHERE tenant_id=$1 AND id=$2',[req.inventoryTenantId,req.params.id])).rows[0];
    if(!batch)return res.status(404).json({error:'Import preview not found'});
    const permission=batch.mode==='counts'?'central_inventory.stock_count.write':'central_inventory.catalog.write';
    if(!hasPermission(req.user,permission))return res.status(403).json({error:'Permission required.',code:'PERMISSION_REQUIRED'});
    res.json(await commitWorkbook(req.inventoryTenantId,req.params.id));
  }catch(error){fail(res,error);}
});
inventoryFilesApi.get('/template',async(req,res)=>{try{res.attachment('inventory-upload-template.xlsx').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await inventoryTemplate()));}catch(error){fail(res,error);}});
inventoryFilesApi.post('/export',async(req,res)=>{
  try{
    const {format,skuIds}=req.body||{};if(!['xlsx','pdf'].includes(format))throw new Error('Choose Excel or PDF');
    const data=await inventoryExportData(req.inventoryTenantId,skuIds);
    const bytes=format==='xlsx'?await inventoryXlsx(data):await inventoryPdf(data);
    res.attachment(`central-inventory-${new Date().toISOString().slice(0,10)}.${format}`).type(format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/pdf').send(Buffer.from(bytes));
  }catch(error){fail(res,error);}
});
