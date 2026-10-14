import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { parse } from 'csv-parse/sync';

const source=await readFile(new URL('../src/lib/exporters.ts',import.meta.url),'utf8');
const compiled=await transform(source,{loader:'ts',format:'esm'});
const {buildBoundedCsv}=await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
const csv=buildBoundedCsv('User Enquiry',{columns:['User Name','=Injected Header','Normal'],rows:[['=HYPERLINK("https://fixture.invalid")',' \t+SUM(1,1)','Last, "First"\nNext'],['-1+2','@cmd','plain']]});
const rows=parse(csv);
assert.deepEqual(rows[0],['User Name',"'=Injected Header",'Normal']);
assert.deepEqual(rows[1],["'=HYPERLINK(\"https://fixture.invalid\")","' \t+SUM(1,1)",'Last, "First"\nNext']);
assert.deepEqual(rows[2],["'-1+2","'@cmd",'plain']);
for(const row of rows)for(const value of row)assert.equal(/^\s*[=+\-@]/u.test(value),false);
for(const data of [
 {columns:['x'],rows:Array.from({length:1001},()=>['x'])},
 {columns:Array.from({length:65},(_,i)=>`C${i}`),rows:[]},
 {columns:['x'],rows:[['ø'.repeat(524288)]]},
])assert.throws(()=>buildBoundedCsv('Fixture',data),/supported CSV size/);
for(const path of ['../src/eretail/admin/AdminModule.tsx','../src/eretail/admin/RecordedAdminWorkflows.tsx','../src/eretail/masters/PricingEvents.tsx','../src/eretail/wms/BinEnquiry.tsx','../src/eretail/wms/ReceiptValidation.tsx','../src/eretail/wms/PutawayRules.tsx','../src/eretail/wms/WmsZone.tsx']){
 const text=await readFile(new URL(path,import.meta.url),'utf8');
 assert.match(text,/buildBoundedCsv\(/,`${path} browser export must use the shared safe builder`);
}
const zoneSource=await readFile(new URL('../src/eretail/wms/WmsZone.tsx',import.meta.url),'utf8');
assert.match(zoneSource,/links\.length >= 1000/,'nested zone-picker rows must be bounded before CSV construction');
console.log('PASS browser CSV boundary: actual TypeScript serializer guards formulas, quotes/newlines and UTF-8/row/column size; seven inspected exports integrate it.');
