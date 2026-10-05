import { sendDatabaseError } from '../reliability/api-errors.js';
import express from 'express';
import { previewWorkbook,commitWorkbook } from './workbook.js';
import { inventoryTemplate,inventoryExportData,inventoryXlsx,inventoryPdf } from './exports.js';
export const inventoryFilesApi=express.Router();
const fail=(res,error)=>sendDatabaseError(res,error)||res.status(error.status||400).json({error:error.message||'Inventory operation failed'});
inventoryFilesApi.post('/imports/preview',async(req,res)=>{
  try{
    const {fileName,base64,mode,locationId}=req.body||{};
    if(typeof base64!=='string'||base64.length>9800000||!base64.match(/^[A-Za-z0-9+/]*={0,2}$/))throw new Error('Invalid workbook upload (maximum 7 MB)');
    res.json(await previewWorkbook({tenantId:req.inventoryTenantId,fileName,bytes:Buffer.from(base64,'base64'),mode,locationId}));
  }catch(error){fail(res,error);}
});
inventoryFilesApi.post('/imports/:id/commit',async(req,res)=>{try{res.json(await commitWorkbook(req.inventoryTenantId,req.params.id));}catch(error){fail(res,error);}});
inventoryFilesApi.get('/template',async(req,res)=>{try{res.attachment('inventory-upload-template.xlsx').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await inventoryTemplate()));}catch(error){fail(res,error);}});
inventoryFilesApi.post('/export',async(req,res)=>{
  try{
    const {format,skuIds}=req.body||{};if(!['xlsx','pdf'].includes(format))throw new Error('Choose Excel or PDF');
    const data=await inventoryExportData(req.inventoryTenantId,skuIds);
    const bytes=format==='xlsx'?await inventoryXlsx(data):await inventoryPdf(data);
    res.attachment(`central-inventory-${new Date().toISOString().slice(0,10)}.${format}`).type(format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/pdf').send(Buffer.from(bytes));
  }catch(error){fail(res,error);}
});
