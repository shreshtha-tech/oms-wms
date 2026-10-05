import '../env.js';
import ExcelJS from 'exceljs';
import { inventoryPool } from '../inventory/db.js';

const path=process.argv[2];
if(!path)throw new Error('Workbook path required');
const workbook=new ExcelJS.Workbook();
await workbook.xlsx.readFile(path);
const rows=[],bySheet=[],allSkus=new Map();
for(const sheet of workbook.worksheets){
  const header=sheet.getRow(1).values.map(x=>String(x??'').trim());
  const isList=sheet.name==='Sheet2';
  const skuCol=isList?1:header.indexOf('Seller SKU ID');
  const stockCol=header.indexOf('Stock'),statusCol=header.indexOf('Listing Status'),packCol=header.indexOf('Pack of');
  if(!skuCol)throw new Error(`SKU column missing on ${sheet.name}`);
  const sheetRows=[];
  for(let rowNo=isList?1:2;rowNo<=sheet.rowCount;rowNo++){
    const row=sheet.getRow(rowNo),sku=String(row.getCell(skuCol).text||'').trim();
    if(!sku)continue;
    const stock=stockCol>0?Number(row.getCell(stockCol).value):null;
    const entry={sheet:sheet.name,row:rowNo,sku,stock:Number.isSafeInteger(stock)?stock:null,status:statusCol>0?String(row.getCell(statusCol).text||'').trim():null,pack:packCol>0?String(row.getCell(packCol).text||'').trim():null};
    sheetRows.push(entry);rows.push(entry);
    const matched=allSkus.get(sku)||[];matched.push(entry);allSkus.set(sku,matched);
  }
  const stocks=sheetRows.map(x=>x.stock).filter(x=>x!==null);
  bySheet.push({sheet:sheet.name,skuRows:sheetRows.length,uniqueSku:new Set(sheetRows.map(x=>x.sku)).size,stockCount:stocks.length,stockRange:stocks.length?[Math.min(...stocks),Math.max(...stocks)]:null,zeroStock:stocks.filter(x=>x===0).length,packValues:[...new Set(sheetRows.map(x=>x.pack).filter(Boolean))].slice(0,15),active:sheetRows.filter(x=>x.status==='Active').length});
}
const duplicates=[...allSkus].filter(([,entries])=>entries.length>1).map(([sku,entries])=>({sku,where:entries.map(x=>`${x.sheet}:${x.row}`)}));
const db=inventoryPool(),tenant=process.env.INVENTORY_ALLOWED_TENANT_ID;
const shopify=await db.query("SELECT s.sku FROM ci_master_sku s JOIN ci_channel_mapping m ON m.tenant_id=s.tenant_id AND m.master_sku_id=s.id JOIN ci_channel_account a ON a.tenant_id=m.tenant_id AND a.id=m.account_id WHERE s.tenant_id=$1 AND a.platform='shopify' AND a.external_account_id='jxz0p8-sj.myshopify.com' GROUP BY s.sku",[tenant]);
const staged=new Set(shopify.rows.map(x=>x.sku));
const workbookSkus=new Set(rows.map(x=>x.sku));
const overlap=[...workbookSkus].filter(sku=>staged.has(sku));
const overlapPackCounts={};for(const sku of overlap){const pack=allSkus.get(sku)[0].pack||'unspecified';overlapPackCounts[pack]=(overlapPackCounts[pack]||0)+1;}
const multiPackExamples=overlap.filter(sku=>Number(allSkus.get(sku)[0].pack)>1).slice(0,10).map(sku=>({sku,pack:allSkus.get(sku)[0].pack}));
const stockConflictExamples=duplicates.filter(x=>new Set(allSkus.get(x.sku).map(y=>y.stock)).size>1).slice(0,10);
console.log(JSON.stringify({sheets:bySheet,workbookUniqueSku:workbookSkus.size,crossSheetDuplicateSkuCount:duplicates.length,crossSheetDuplicateExamples:duplicates.slice(0,10),conflictingStockExamples:stockConflictExamples,shopifyStagedSkuCount:staged.size,exactShopifyOverlap:overlap.length,overlapPackCounts,multiPackExamples,overlapExamples:overlap.slice(0,15),workbookOnly:workbookSkus.size-overlap.length,shopifyOnly:staged.size-overlap.length},null,2));
await db.end();
