import '../env.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { inventoryPool, migrateInventory, transaction } from '../inventory/db.js';

const path=process.argv[2],tenant=process.env.INVENTORY_ALLOWED_TENANT_ID;
if(!path||!tenant)throw new Error('Workbook path and inventory tenant required');
const bytes=await readFile(path),fileSha256=createHash('sha256').update(bytes).digest('hex');
const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
const records=[],seen=new Map();
for(const sheet of workbook.worksheets){
  const headings=sheet.getRow(1).values.map(x=>String(x??'').trim());
  const listOnly=sheet.name==='Sheet2',skuCol=listOnly?1:headings.indexOf('Seller SKU ID');
  if(skuCol<1)throw new Error(`Seller SKU ID missing from ${sheet.name}`);
  const nameCol=headings.indexOf('Product Name'),stockCol=headings.indexOf('Stock'),packCol=headings.indexOf('Pack of'),statusCol=headings.indexOf('Listing Status'),shipCol=headings.indexOf('Shipping provider');
  for(let rowNo=listOnly?1:2;rowNo<=sheet.rowCount;rowNo++){
    const row=sheet.getRow(rowNo),sku=String(row.getCell(skuCol).text||'').trim();if(!sku)continue;
    if(sku.length>120)throw new Error(`SKU too long at ${sheet.name}:${rowNo}`);
    if(seen.has(sku))throw new Error(`Duplicate SKU ${sku} at ${seen.get(sku)} and ${sheet.name}:${rowNo}`);
    seen.set(sku,`${sheet.name}:${rowNo}`);
    const productName=nameCol>0?String(row.getCell(nameCol).text||'').trim()||null:null;
    const rawStock=stockCol>0?row.getCell(stockCol).value:null,listedStock=rawStock===null||rawStock===undefined||rawStock===''?null:Number(rawStock);
    const rawPack=packCol>0?row.getCell(packCol).value:null,packSize=rawPack===null||rawPack===undefined||rawPack===''?null:Number(rawPack);
    if(listedStock!==null&&(!Number.isSafeInteger(listedStock)||listedStock<0))throw new Error(`Invalid listed stock at ${sheet.name}:${rowNo}`);
    if(packSize!==null&&(!Number.isSafeInteger(packSize)||packSize<=0))throw new Error(`Invalid pack size at ${sheet.name}:${rowNo}`);
    const status=statusCol>0?String(row.getCell(statusCol).text||'').trim()||null:null;
    const shipping=shipCol>0?String(row.getCell(shipCol).text||'').trim():'';
    records.push({sheet:sheet.name,rowNo,sku,productName,listedStock,packSize,status,channelHint:shipping==='Flipkart'?'flipkart':null});
  }
}
await migrateInventory();
let created=0,sourceRows=0;
await transaction(async db=>{
  for(const item of records){
    const inserted=await db.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,$2,$3) ON CONFLICT(tenant_id,sku) DO NOTHING RETURNING id',[tenant,item.sku,item.productName||item.sku]);
    created+=inserted.rowCount;
    const source=await db.query('INSERT INTO ci_catalog_source_row(tenant_id,file_sha256,file_name,sheet_name,row_number,sku,product_name,listed_stock,pack_size,listing_status,channel_hint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING sku',[tenant,fileSha256,basename(path),item.sheet,item.rowNo,item.sku,item.productName,item.listedStock,item.packSize,item.status,item.channelHint]);
    sourceRows+=source.rowCount;
  }
});
console.log(JSON.stringify({file:basename(path),workbookSkuCount:records.length,newMasterSkus:created,newSourceRows:sourceRows,sourceOnlyNoStock:records.filter(x=>x.listedStock===null).length,packTwoOrMore:records.filter(x=>Number(x.packSize)>1).length,physicalBalancesCreated:0,channelMappingsActivated:0},null,2));
await inventoryPool().end();
