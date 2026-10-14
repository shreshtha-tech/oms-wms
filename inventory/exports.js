import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { transaction } from './db.js';
import { readInventoryOverview } from './read-model.js';

function sheet(workbook,name,headers,rows){
  const ws=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});
  ws.addRow(headers);rows.forEach(r=>ws.addRow(r));
  ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF16324F'}};
  ws.getRow(1).height=30;
  ws.columns.forEach((c,i)=>{c.width=/sku|product|location|source|shop|item/i.test(headers[i])?34:21;c.alignment={vertical:'middle',wrapText:true};});
  for(let n=2;n<=ws.rowCount;n++){
    let lines=1;
    ws.getRow(n).eachCell((c,column)=>{lines=Math.max(lines,...String(c.value??'').split('\n').map(line=>Math.ceil(line.length/Math.max(8,Number(ws.getColumn(column).width)-3))));});
    ws.getRow(n).height=Math.max(30,lines*14+8);
    ws.getRow(n).eachCell(c=>{if(typeof c.value==='number')c.numFmt='#,##0';});
  }
  ws.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,ws.rowCount),column:headers.length}};
  return ws;
}
export async function inventoryTemplate(){
  const wb=new ExcelJS.Workbook();
  sheet(wb,'Physical counts',['SKU','Product Name','Location','On hand'],[]);
  sheet(wb,'Catalog',['SKU','Product Name','Pack of'],[]);
  sheet(wb,'Instructions',['Field','Meaning'],[
    ['Upload limit','Up to 50,000 data rows per import; the .xlsx file must be 7 MB or smaller.'],
    ['Import purpose','For stock updates, choose Verified physical counts and fill the Physical counts worksheet. The Catalog worksheet is ignored in this mode.'],
    ['SKU','Keep the SKU as text and match an existing Central Inventory SKU exactly. No case, prefix, or pack conversion is applied. Add new SKUs using Catalog mode first.'],
    ['Catalog','Use catalog mode to add SKU identities; catalog imports never change physical stock.'],
    ['Physical counts','Each SKU/location pair must be unique. Whole-unit counts replace on-hand quantities for an existing SKU/location balance. Initial opening stock requires separate approval.'],
    ['Location','Exact existing warehouse/store code; or leave empty and choose one location on upload.'],
    ['On hand','Nonnegative whole units for this exact SKU. A pack SKU is counted in packs, not loose pieces.'],
    ['Pack of','Informational pack size. No component conversion or channel mapping is activated.'],
    ['Source workbook','If its sheet or headers differ from this template, inspect it and enter the exact sheet, header row and SKU/quantity columns in the mapped count workflow.'],
    ['Preview','Review exact SKU/location matches and proposed changes. A count commit requires the stock-count permission and writes only to the Central Inventory ledger.'],
  ]);
  return wb.xlsx.writeBuffer();
}
export async function inventoryExportData(tenantId,skuIds){
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const data=await readInventoryOverview(tenantId,db);
    if(skuIds!==undefined){
      if(!Array.isArray(skuIds)||!skuIds.length||skuIds.length>10000)throw new Error('Select 1–10,000 SKUs');
      const selected=new Set(skuIds);
      if(data.products.filter(p=>selected.has(p.id)).length!==selected.size)throw new Error('Unknown SKU in export');
      data.products=data.products.filter(p=>selected.has(p.id));
    }
    const ids=new Set(data.products.map(p=>p.id));
    const rows=await db.query(`SELECT b.*,s.sku,s.product_name,l.code AS location,l.location_type,
      GREATEST(0,b.on_hand-b.reserved_order-b.reserved_cart-b.damaged-b.quarantined-b.safety_stock) AS sellable
      FROM ci_inventory_balance b JOIN ci_master_sku s ON s.tenant_id=b.tenant_id AND s.id=b.master_sku_id
      JOIN ci_location l ON l.tenant_id=b.tenant_id AND l.id=b.location_id WHERE b.tenant_id=$1 ORDER BY s.sku,l.code`,[tenantId]);
    data.balances=rows.rows.filter(b=>ids.has(b.master_sku_id));
    return data;
  });
}
export async function inventoryXlsx(data){
  const wb=new ExcelJS.Workbook();wb.creator='D-Mills Central Inventory';wb.created=new Date(data.generatedAt);
  sheet(wb,'Catalog',['SKU','Product Name','Pack of'],data.products.map(p=>[p.sku,p.product_name,p.pack_size]));
  sheet(wb,'Inventory summary',['SKU','Product Name','Stock state','On hand','Reserved','Sellable','Alert below','Workbook listed (unverified)'],data.products.map(p=>[p.sku,p.product_name,p.counted_locations?'Counted':'Not counted',p.counted_locations?Number(p.on_hand):null,p.counted_locations?Number(p.reserved):null,p.counted_locations?Number(p.sellable):null,p.alert_enabled?Number(p.threshold):null,p.workbook_listed_stock===null?null:Number(p.workbook_listed_stock)]));
  sheet(wb,'Physical counts',['SKU','Product Name','Location','On hand','Reserved orders','Reserved carts','Damaged','Quarantined','Safety stock','Sellable'],data.balances.filter(b=>['warehouse','store'].includes(b.location_type)).map(b=>[b.sku,b.product_name,b.location,...['on_hand','reserved_order','reserved_cart','damaged','quarantined','safety_stock','sellable'].map(k=>Number(b[k]))]));
  sheet(wb,'Report notes',['Field','Value'],[['Generated at (UTC)',data.generatedAt],['Summary','Central physical stock only. Not counted means no physical balance has been recorded.'],['Reimport','Choose Catalog for identities or Physical counts for verified location counts. Exported counts become stale as sales occur.'],['Workbook listed','Source listing quantities may be uncertain; they are not ledger stock.']]);
  return wb.xlsx.writeBuffer();
}
export async function inventoryPdf(data){
  const doc=new PDFDocument({size:'A4',layout:'landscape',margin:32,bufferPages:true,info:{Title:'Central Inventory Stock Report'}});
  const chunks=[];const result=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const columns=[{title:'SKU',width:165},{title:'Product',width:170},{title:'State',width:90},{title:'On hand',width:65},{title:'Reserved',width:65},{title:'Sellable',width:65},{title:'Alert below',width:75},{title:'Listed*',width:80}];
  const header=()=>{
    doc.font('Helvetica-Bold').fontSize(17).fillColor('#16324f').text('Central Inventory | Stock report',32,30);
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`Generated ${data.generatedAt} | ${data.products.length} SKUs`,32,54);
    doc.text('Uncounted is not zero. *Listed = workbook source quantity (unverified). Shopify observations follow separately.',32,69);
    let x=32;columns.forEach(c=>{doc.rect(x,92,c.width,24).fill('#16324f');doc.fillColor('white').fontSize(9).text(c.title,x+5,100,{width:c.width-10,lineBreak:false});x+=c.width;});
  };
  header();let y=116;
  for(const p of data.products){
    doc.font('Helvetica').fontSize(9);
    const height=Math.max(25,doc.heightOfString(p.sku,{width:155})+12,doc.heightOfString(p.product_name,{width:160})+12);
    if(y+height>doc.page.height-45){doc.addPage();header();y=116;}
    const values=[p.sku,p.product_name,p.counted_locations?'Counted':'Not counted',...['on_hand','reserved','sellable'].map(k=>p.counted_locations?String(p[k]):'--'),p.alert_enabled?String(p.threshold):'Off',p.workbook_listed_stock===null?'--':String(p.workbook_listed_stock)];
    let x=32;values.forEach((v,i)=>{doc.fillColor('#1e293b').text(v,x+5,y+6,{width:columns[i].width-10});x+=columns[i].width;});
    doc.moveTo(32,y+height).lineTo(807,y+height).strokeColor('#e2e8f0').stroke();y+=height;
  }
  const range=doc.bufferedPageRange();for(let n=0;n<range.count;n++){doc.switchToPage(n);doc.fontSize(8).fillColor('#64748b').text(`Page ${n+1} of ${range.count}`,32,doc.page.height-28,{lineBreak:false});}
  doc.end();return result;
}
