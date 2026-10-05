import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

const MAX_BYTES=5_000_000,MAX_ROWS=10_000;
const text=value=>String(value??'').trim();
const simpleCell=value=>{
 if(value==null)return '';
 if(value instanceof Date)return value.toISOString();
 if(typeof value==='object')throw Object.assign(new Error('Formulas and rich cells are not accepted in order reports'),{status:400});
 return text(value);
};

export async function parsePartnerReport({fileName,bytes,sheetName,headerRow=1}){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)throw Object.assign(new Error('Choose a CSV or XLSX order report under 5 MB'),{status:400});
 if(!Number.isSafeInteger(headerRow)||headerRow<1||headerRow>20)throw Object.assign(new Error('Header row must be between 1 and 20'),{status:400});
 const extension=text(fileName).toLowerCase().split('.').pop();
 let records,sheet='CSV';
 if(extension==='csv'){
  records=parseCsv(bytes,{bom:true,skip_empty_lines:true,relax_column_count:false});
 }else if(extension==='xlsx'){
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
  const selected=sheetName?workbook.worksheets.find(item=>item.name===sheetName):workbook.worksheets[0];
  if(!selected)throw Object.assign(new Error('Choose a worksheet in this report'),{status:400});
  if(selected.rowCount>MAX_ROWS+20)throw Object.assign(new Error('Partner report has too many rows'),{status:400});
  sheet=selected.name;records=[];
  for(let rowNumber=1;rowNumber<=selected.rowCount;rowNumber++){
   const row=selected.getRow(rowNumber);
   const width=Math.max(row.cellCount,selected.getRow(headerRow).cellCount);
   records.push(Array.from({length:width},(_,index)=>simpleCell(row.getCell(index+1).value)));
  }
 }else throw Object.assign(new Error('Partner report must be CSV or XLSX'),{status:400});
 if(records.length<headerRow+1||records.length>MAX_ROWS+headerRow)throw Object.assign(new Error('Report needs 1–10,000 data rows after the selected header'),{status:400});
 const headers=records[headerRow-1]?.map(simpleCell)||[];
 if(!headers.length||headers.some(value=>!value||value.length>120)||new Set(headers.map(value=>value.toLowerCase())).size!==headers.length)throw Object.assign(new Error('Order report needs nonempty unique column headings'),{status:400});
 const rows=records.slice(headerRow).filter(row=>row.some(value=>text(value)));
 if(rows.some(row=>row.length>headers.length&&row.slice(headers.length).some(text)))throw Object.assign(new Error('Report has data outside its header columns'),{status:400});
 return {sheet,headers,rows:rows.map(row=>Object.fromEntries(headers.map((header,index)=>[header,text(row[index])])))};
}

