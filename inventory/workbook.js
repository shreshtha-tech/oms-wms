import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { inventoryPool, transaction } from './db.js';
import { applyInventoryEventInTransaction, InventoryConflict } from './ledger.js';

const MAX_ROWS=10000;
const normalize=value=>String(value||'').trim().toLowerCase().replace(/[_\s]+/g,' ');
const isFormula=cell=>cell.type===ExcelJS.ValueType.Formula;
const text=cell=>{if(isFormula(cell))throw new Error('Formula cells are not accepted; paste values first');return cell.text.trim();};
const number=cell=>{const raw=text(cell);if(!raw)return null;if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new Error('Quantity must be a nonnegative whole number');return Number(raw);};

export async function parseInventoryWorkbook(bytes,mode){
  if(!['catalog','counts'].includes(mode))throw new Error('Choose catalog or physical counts');
  if(!bytes.length||bytes.length>7*1024*1024)throw new Error('Upload an .xlsx workbook up to 7 MB');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
  const dedicated=workbook.getWorksheet(mode==='catalog'?'Catalog':'Physical counts');
  const sheets=dedicated?[dedicated]:workbook.worksheets;
  const rows=[],errors=[],seen=new Set();
  for(const sheet of sheets){
    if(sheet.rowCount>MAX_ROWS+1)throw new Error('Maximum 10,000 rows per import');
    const headers=sheet.getRow(1).values.map(normalize);
    const col=(...aliases)=>headers.findIndex(h=>aliases.includes(h));
    const skuCol=col('sku','seller sku id','master sku','seller sku');
    // The supplied Thread Sutra reference includes a named, headerless SKU-only sheet.
    const listOnly=sheet.name==='Sheet2'&&skuCol<1&&sheet.columnCount===1&&mode==='catalog';
    if(skuCol<1&&!listOnly){if(sheet.actualRowCount)errors.push({sheet:sheet.name,row:1,message:'Missing SKU / Seller SKU ID column'});continue;}
    const nameCol=col('product name','product'),stockCol=col('on hand','stock','quantity'),packCol=col('pack of','pack size'),locationCol=col('location','location code');
    for(let n=listOnly?1:2;n<=sheet.rowCount;n++){
      const row=sheet.getRow(n);if(!row.hasValues)continue;
      try{
        const sku=text(row.getCell(listOnly?1:skuCol));if(!sku||sku.length>120)throw new Error('SKU is required and must be at most 120 characters');
        const productName=nameCol>0?text(row.getCell(nameCol)):sku;
        if(productName.length>250)throw new Error('Product name exceeds 250 characters');
        const location=locationCol>0?text(row.getCell(locationCol)):'';
        const key=mode==='counts'?`${sku}\u0000${location}`:sku;
        if(seen.has(key))throw new Error(`Duplicate SKU${mode==='counts'?' and location':''}: ${sku}`);seen.add(key);
        const stock=stockCol>0?number(row.getCell(stockCol)):null;
        if(mode==='counts'&&stock===null)throw new Error('Physical count requires On hand / Stock for every row');
        const packSize=packCol>0?number(row.getCell(packCol)):null;
        if(packSize===0)throw new Error('Pack size must be positive');
        rows.push({sheet:sheet.name,row:n,sku,productName:productName||sku,stock,packSize,location});
        if(rows.length>MAX_ROWS)throw new Error('Maximum 10,000 rows per import');
      }catch(error){errors.push({sheet:sheet.name,row:n,message:error.message});}
    }
  }
  if(!rows.length&&!errors.length)errors.push({sheet:'',row:0,message:'Workbook has no SKU rows'});
  if(rows.length>MAX_ROWS)throw new Error('Maximum 10,000 rows per import');
  return {rows,errors};
}

export async function previewWorkbook({tenantId,fileName,bytes,mode,locationId}){
  if(!/\.xlsx$/i.test(fileName||''))throw new Error('Only .xlsx workbooks are supported');
  const {rows,errors}=await parseInventoryWorkbook(bytes,mode);
  const db=inventoryPool();
  const [skus,locations,balances]=await Promise.all([
    db.query('SELECT id,sku FROM ci_master_sku WHERE tenant_id=$1',[tenantId]),
    db.query("SELECT id,code FROM ci_location WHERE tenant_id=$1 AND location_type IN ('warehouse','store')",[tenantId]),
    db.query('SELECT *,reserved_order+reserved_cart+damaged+quarantined+safety_stock AS encumbered FROM ci_inventory_balance WHERE tenant_id=$1',[tenantId]),
  ]);
  const bySku=new Map(skus.rows.map(s=>[s.sku,s.id])),byBalance=new Map(balances.rows.map(b=>[`${b.master_sku_id}:${b.location_id}`,b]));
  const seenTargets=new Set();
  for(const row of rows){
    row.masterSkuId=bySku.get(row.sku)||null;
    if(mode==='counts'){
      const location=row.location?locations.rows.find(l=>l.code===row.location):locations.rows.find(l=>l.id===locationId);
      if(!location){errors.push({sheet:row.sheet,row:row.row,message:'Choose an existing warehouse/store or supply its exact Location code'});continue;}
      row.locationId=location.id;row.location=location.code;
      const key=`${row.sku}:${location.id}`;
      if(seenTargets.has(key))errors.push({sheet:row.sheet,row:row.row,message:'Duplicate SKU/location after resolving locations'});
      seenTargets.add(key);
      const balance=byBalance.get(`${row.masterSkuId}:${location.id}`);
      row.expectedVersion=balance?.version??null;row.previousOnHand=balance?Number(balance.on_hand):null;
      if(balance&&row.stock<Number(balance.encumbered))errors.push({sheet:row.sheet,row:row.row,message:'Count is below reserved/unavailable units; resolve those quantities first'});
    }
  }
  const summary={rows:rows.length,newSkus:new Set(rows.filter(r=>!r.masterSkuId).map(r=>r.sku)).size,stockChanges:mode==='counts'?rows.filter(r=>r.previousOnHand!==r.stock).length:0,packListings:rows.filter(r=>r.packSize>1).length,errors:errors.length};
  if(errors.length)return {id:null,summary,rows:rows.slice(0,100),errors:errors.slice(0,100)};
  const result=await db.query('INSERT INTO ci_import_batch(tenant_id,mode,file_name,file_sha256,rows,summary) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at',[tenantId,mode,String(fileName).split(/[\\/]/).pop().slice(0,200),createHash('sha256').update(bytes).digest('hex'),JSON.stringify(rows),summary]);
  return {...result.rows[0],summary,rows:rows.slice(0,100),errors:[]};
}

export async function commitWorkbook(tenantId,id){
  return transaction(async db=>{
    const batch=(await db.query('SELECT * FROM ci_import_batch WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,id])).rows[0];
    if(!batch)throw new Error('Import preview not found');
    if(batch.status==='committed')return {...batch.result,duplicate:true};
    if(Date.now()-new Date(batch.created_at).getTime()>30*60*1000)throw new InventoryConflict('Preview expired; upload again to compare current stock');
    let created=0,events=0;
    // Stable lock order for overlapping imports. All rows commit or roll back together.
    for(const row of batch.rows.sort((a,b)=>`${a.sku}:${a.locationId||''}`.localeCompare(`${b.sku}:${b.locationId||''}`))){
      const inserted=await db.query('INSERT INTO ci_master_sku(tenant_id,sku,product_name) VALUES($1,$2,$3) ON CONFLICT(tenant_id,sku) DO NOTHING RETURNING id',[tenantId,row.sku,row.productName]);
      created+=inserted.rowCount;
      const skuId=inserted.rows[0]?.id||(await db.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND sku=$2',[tenantId,row.sku])).rows[0].id;
      await db.query('INSERT INTO ci_catalog_source_row(tenant_id,file_sha256,file_name,sheet_name,row_number,sku,product_name,listed_stock,pack_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',[tenantId,batch.file_sha256,batch.file_name,row.sheet,row.row,row.sku,row.productName,row.stock,row.packSize]);
      if(batch.mode==='counts'){
        // Lock the identity even if no balance exists yet, preventing concurrent opening counts.
        await db.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,skuId]);
        const balance=(await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3 FOR UPDATE',[tenantId,skuId,row.locationId])).rows[0];
        if((balance?.version??null)!==row.expectedVersion)throw new InventoryConflict(`Stock changed after preview for ${row.sku}; upload again`);
        await applyInventoryEventInTransaction(db,{tenantId,masterSkuId:skuId,locationId:row.locationId,eventKey:`workbook:${id}:${row.sheet}:${row.row}`,eventType:'physical_count',source:'workbook',externalReference:JSON.stringify({file:batch.file_name,sha256:batch.file_sha256,sheet:row.sheet,row:row.row}),delta_on_hand:row.stock-Number(balance?.on_hand||0)});
        events++;
      }
    }
    const result={rows:batch.rows.length,newSkus:created,stockEvents:events,mode:batch.mode};
    await db.query("UPDATE ci_import_batch SET status='committed',committed_at=now(),result=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,id,result]);
    return result;
  });
}
