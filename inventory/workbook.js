import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { inventoryPool, transaction } from './db.js';
import { applyInventoryEventInTransaction, InventoryConflict } from './ledger.js';
import { upsertMaster } from './sku-service.js';
import { normalizeSkuCode } from './sku-parser.mjs';

const MAX_ROWS=50000;
const normalize=value=>String(value||'').trim().toLowerCase().replace(/[_\s]+/g,' ');
const isFormula=cell=>cell.type===ExcelJS.ValueType.Formula;
const text=cell=>{if(isFormula(cell))throw new Error('Formula cells are not accepted; paste values first');return cell.text.trim();};
const number=cell=>{const raw=text(cell);if(!raw)return null;if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new Error('Quantity must be a nonnegative whole number');return Number(raw);};

function mappingColumn(mapping,name){
  const value=mapping?.[name];
  if(!value||!Number.isSafeInteger(value.column)||value.column<1||typeof value.header!=='string'||!value.header.trim()||value.header.length>120)throw new Error(`Choose the exact ${name} column number and header`);
  return value;
}

function mappedQuantity(cell,format){
  if(isFormula(cell))throw new Error('Formula cells are not accepted; paste values first');
  const value=cell.value;
  if(typeof value==='number'){
    if(!Number.isSafeInteger(value)||value<0)throw new Error('Quantity must be a nonnegative safe whole number');
    return value;
  }
  const raw=cell.text.trim();
  if(!raw)throw new Error('Physical count requires a quantity for every SKU row');
  const pattern=format==='integer_grouped'?/^(?:\d{1,3}(?:,\d{3})+|\d+)$/:/^\d+$/;
  if(!pattern.test(raw))throw new Error('Quantity must match the selected whole-number format');
  const valueNumber=Number(format==='integer_grouped'?raw.replaceAll(',',''):raw);
  if(!Number.isSafeInteger(valueNumber))throw new Error('Quantity exceeds the safe whole-number range');
  return valueNumber;
}

async function parseMappedCounts(workbook,mapping){
  if(typeof mapping?.sheet!=='string'||!mapping.sheet.trim()||mapping.sheet.length>120||!Number.isSafeInteger(mapping.headerRow)||mapping.headerRow<1||mapping.headerRow>100)throw new Error('Choose an exact visible worksheet and header row');
  const sku=mappingColumn(mapping,'sku'),quantity=mappingColumn(mapping,'quantity');
  const location=mapping.location===undefined||mapping.location===null?null:mappingColumn(mapping,'location');
  if(!['integer_plain','integer_grouped'].includes(quantity.format))throw new Error('Choose the exact whole-number quantity format');
  const columnNumbers=[sku.column,quantity.column,...(location?[location.column]:[])];
  if(new Set(columnNumbers).size!==columnNumbers.length)throw new Error('SKU, quantity, and location columns must differ');
  const sheet=workbook.getWorksheet(mapping.sheet);
  if(!sheet||sheet.state!=='visible')throw new Error('Mapped worksheet must exist and be visible');
  if(sheet.rowCount-mapping.headerRow>MAX_ROWS)throw new Error('Maximum 50,000 rows per import');
  const header=sheet.getRow(mapping.headerRow), specs=[['SKU',sku],['quantity',quantity],...(location?[['location',location]]:[])];
  for(const [name,spec] of specs){
    if(header.getCell(spec.column).text.trim()!==spec.header.trim())throw new Error(`Mapped ${name} header does not match the selected worksheet cell`);
    let matches=0;header.eachCell(cell=>{if(cell.text.trim()===spec.header.trim())matches++;});
    if(matches!==1)throw new Error(`Mapped ${name} header must occur exactly once`);
  }
  const rows=[],errors=[],seen=new Set(),mappingSha=createHash('sha256').update(JSON.stringify({sheet:mapping.sheet,headerRow:mapping.headerRow,sku:{column:sku.column,header:sku.header.trim()},quantity:{column:quantity.column,header:quantity.header.trim(),format:quantity.format},location:location?{column:location.column,header:location.header.trim(),transform:'trim'}:null})).digest('hex');
  for(let rowNumber=mapping.headerRow+1;rowNumber<=sheet.rowCount;rowNumber++){
    const row=sheet.getRow(rowNumber);if(!row.hasValues)continue;
    try{
      const skuCell=row.getCell(sku.column),quantityCell=row.getCell(quantity.column),locationCell=location?row.getCell(location.column):null;
      if([skuCell,quantityCell,...(locationCell?[locationCell]:[])].some(cell=>cell.isMerged))throw new Error('Mapped cells cannot be merged');
      if(skuCell.type!==ExcelJS.ValueType.String)throw new Error('SKU must be stored as text to preserve its exact identifier');
      const skuValue=text(skuCell);if(!skuValue||skuValue.length>120)throw new Error('SKU is required and must be at most 120 characters');
      const locationValue=locationCell?text(locationCell):'';
      if(locationCell&&!locationValue)throw new Error('Mapped location is blank; do not fall back to the default location');
      const stock=mappedQuantity(quantityCell,quantity.format);
      const key=`${skuValue}\u0000${locationValue}`;if(seen.has(key))throw new Error(`Duplicate SKU${location?' and location':''}: ${skuValue}`);seen.add(key);
      rows.push({sheet:sheet.name,row:rowNumber,sku:skuValue,productName:skuValue,stock,location:locationValue,mappingSha256:mappingSha});
      if(rows.length>MAX_ROWS)throw new Error('Maximum 50,000 rows per import');
    }catch(error){errors.push({sheet:sheet.name,row:rowNumber,message:error.message});}
  }
  if(!rows.length&&!errors.length)errors.push({sheet:sheet.name,row:mapping.headerRow+1,message:'Mapped worksheet contains no data rows'});
  return {rows,errors};
}

export async function parseInventoryWorkbook(bytes,mode,mapping){
  if(!['catalog','counts'].includes(mode))throw new Error('Choose catalog or physical counts');
  if(!bytes.length||bytes.length>7*1024*1024)throw new Error('Upload an .xlsx workbook up to 7 MB');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
  if(mode==='counts'&&mapping)return parseMappedCounts(workbook,mapping);
  const dedicated=workbook.getWorksheet(mode==='catalog'?'Catalog':'Physical counts');
  if(mode==='counts'&&!dedicated)return {rows:[],errors:[{sheet:'Physical counts',row:1,message:'Physical stock updates require a Physical counts worksheet. Use the upload template and enter verified on-hand units there; Catalog or marketplace stock columns cannot be used as physical counts.'}]};
  const sheets=dedicated?[dedicated]:workbook.worksheets;
  const rows=[],errors=[],seen=new Set();
  for(const sheet of sheets){
    if(sheet.rowCount>MAX_ROWS+1)throw new Error('Maximum 50,000 rows per import');
    const headers=sheet.getRow(1).values.map(normalize);
    const col=(...aliases)=>headers.findIndex(h=>aliases.includes(h));
    const skuCol=col('sku','seller sku id','master sku','seller sku');
    // The supplied Thread Sutra reference includes a named, headerless SKU-only sheet.
    const listOnly=sheet.name==='Sheet2'&&skuCol<1&&sheet.columnCount===1&&mode==='catalog';
    if(skuCol<1&&!listOnly){if(sheet.actualRowCount)errors.push({sheet:sheet.name,row:1,message:'Missing SKU / Seller SKU ID column'});continue;}
    const nameCol=col('product name','product'),stockCol=col('on hand','stock','quantity'),packCol=col('pack of','pack size'),locationCol=col('location','location code');
    if(mode==='counts'&&stockCol<1){errors.push({sheet:sheet.name,row:1,message:'Physical counts requires an On hand / Stock / Quantity column with verified on-hand units'});continue;}
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
        if(rows.length>MAX_ROWS)throw new Error('Maximum 50,000 rows per import');
      }catch(error){errors.push({sheet:sheet.name,row:n,message:error.message});}
    }
  }
  if(!rows.length&&!errors.length){
    if(mode==='counts'&&dedicated)errors.push({sheet:dedicated.name,row:2,message:'The Physical counts worksheet is empty. Enter verified counts there; the Catalog worksheet does not update stock.'});
    else errors.push({sheet:'',row:0,message:'Workbook has no SKU rows'});
  }
  if(rows.length>MAX_ROWS)throw new Error('Maximum 50,000 rows per import');
  return {rows,errors};
}

export async function previewWorkbook({tenantId,fileName,bytes,mode,locationId,mapping}){
  if(!/\.xlsx$/i.test(fileName||''))throw new Error('Only .xlsx workbooks are supported');
  const {rows,errors}=await parseInventoryWorkbook(bytes,mode,mapping);
  const db=inventoryPool();
  const [skus,aliases,locations,balances]=await Promise.all([
    db.query('SELECT id,sku FROM ci_master_sku WHERE tenant_id=$1',[tenantId]),
    db.query('SELECT alias_sku,master_sku_id FROM ci_sku_alias WHERE tenant_id=$1',[tenantId]),
    db.query("SELECT id,code FROM ci_location WHERE tenant_id=$1 AND location_type IN ('warehouse','store')",[tenantId]),
    db.query('SELECT *,reserved_order+reserved_cart+damaged+quarantined+safety_stock AS encumbered FROM ci_inventory_balance WHERE tenant_id=$1',[tenantId]),
  ]);
  const bySku=new Map(skus.rows.map(s=>[s.sku,s.id])),byAlias=new Map(aliases.rows.map(a=>[a.alias_sku,a.master_sku_id])),byBalance=new Map(balances.rows.map(b=>[`${b.master_sku_id}:${b.location_id}`,b]));
  const seenTargets=new Set();
  for(const row of rows){
    row.masterSkuId=byAlias.get(normalizeSkuCode(row.sku))||bySku.get(row.sku)||null;
    if(mode==='counts'){
      if(!row.masterSkuId){errors.push({sheet:row.sheet,row:row.row,message:`SKU does not exactly match a Central Inventory master SKU: ${row.sku}. Add or correct the SKU in Catalog first.`});continue;}
      const location=row.location?locations.rows.find(l=>l.code===row.location):locations.rows.find(l=>l.id===locationId);
      if(!location){errors.push({sheet:row.sheet,row:row.row,message:'Choose an existing warehouse/store or supply its exact Location code'});continue;}
      row.locationId=location.id;row.location=location.code;
      const key=`${row.masterSkuId}:${location.id}`;
      if(seenTargets.has(key))errors.push({sheet:row.sheet,row:row.row,message:'Duplicate SKU/location after resolving locations'});
      seenTargets.add(key);
      const balance=byBalance.get(`${row.masterSkuId}:${location.id}`);
      if(!balance){errors.push({sheet:row.sheet,row:row.row,message:'This SKU/location has no verified stock basis. Use the controlled opening-stock approval workflow before count updates.'});continue;}
      row.expectedVersion=balance.version;row.previousOnHand=Number(balance.on_hand);
      if(balance&&row.stock<Number(balance.encumbered))errors.push({sheet:row.sheet,row:row.row,message:'Count is below reserved/unavailable units; resolve those quantities first'});
    }
  }
  const summary={rows:rows.length,newSkus:mode==='catalog'?new Set(rows.filter(r=>!r.masterSkuId).map(r=>r.sku)).size:0,stockChanges:mode==='counts'?rows.filter(r=>r.masterSkuId&&r.previousOnHand!==r.stock).length:0,packListings:rows.filter(r=>r.packSize>1).length,errors:errors.length};
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
      let skuId;
      if(batch.mode==='counts'){
        const identity=(await db.query('SELECT s.id FROM ci_master_sku s LEFT JOIN ci_sku_alias a ON a.tenant_id=s.tenant_id AND a.master_sku_id=s.id AND a.alias_sku=$3 WHERE s.tenant_id=$1 AND s.id=$2 AND (s.sku=$4 OR a.alias_sku IS NOT NULL) FOR UPDATE OF s',[tenantId,row.masterSkuId,normalizeSkuCode(row.sku),row.sku])).rows[0];
        if(!identity)throw new InventoryConflict(`The approved SKU identity changed for ${row.sku}; preview the workbook again`);
        skuId=identity.id;
      }else{
        const master=await upsertMaster(db,{tenantId,sku:row.sku,productName:row.productName,source:'import'});
        created+=Number(master.created);
        skuId=master.id;
      }
      await db.query('INSERT INTO ci_catalog_source_row(tenant_id,file_sha256,file_name,sheet_name,row_number,sku,master_sku_id,product_name,listed_stock,pack_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING',[tenantId,batch.file_sha256,batch.file_name,row.sheet,row.row,row.sku,skuId,row.productName,row.stock,row.packSize]);
      if(batch.mode==='counts'){
        // Lock the exact SKU identity, then compare the existing balance version.
        await db.query('SELECT id FROM ci_master_sku WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,skuId]);
        const balance=(await db.query('SELECT * FROM ci_inventory_balance WHERE tenant_id=$1 AND master_sku_id=$2 AND location_id=$3 FOR UPDATE',[tenantId,skuId,row.locationId])).rows[0];
        if(!balance)throw new InventoryConflict('A missing SKU/location balance must use the controlled opening-stock approval workflow');
        if((balance?.version??null)!==row.expectedVersion)throw new InventoryConflict(`Stock changed after preview for ${row.sku}; upload again`);
        await applyInventoryEventInTransaction(db,{tenantId,masterSkuId:skuId,locationId:row.locationId,eventKey:`workbook:${id}:${row.sheet}:${row.row}`,eventType:'physical_count',source:'workbook',externalReference:JSON.stringify({file:batch.file_name,sha256:batch.file_sha256,sheet:row.sheet,row:row.row,...(row.mappingSha256?{mappingSha256:row.mappingSha256}:{})}),delta_on_hand:row.stock-Number(balance?.on_hand||0)});
        events++;
      }
    }
    const result={rows:batch.rows.length,newSkus:created,stockEvents:events,mode:batch.mode};
    await db.query("UPDATE ci_import_batch SET status='committed',committed_at=now(),result=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,id,result]);
    return result;
  });
}
