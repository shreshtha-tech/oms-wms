import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
import { safeCsv } from '../api/csv-safe.js';

const columns=['=HEADER','normal','leading','tab','negative','at','quoted'];
const values={'=HEADER':'=HYPERLINK("https://fixture.invalid","open")',normal:'Plain',leading:' =HYPERLINK("https://fixture.invalid","open")',tab:'\t+SUM(1,1)',negative:'-1+2',at:'@cmd',quoted:'safe "quoted", text\nnext'};
const parsed=parse(safeCsv([values],columns),{columns:false,skip_empty_lines:false});
assert.deepEqual(parsed[0],["'=HEADER",...columns.slice(1)]);
assert.deepEqual(parsed[1],["'=HYPERLINK(\"https://fixture.invalid\",\"open\")",'Plain',"' =HYPERLINK(\"https://fixture.invalid\",\"open\")","'\t+SUM(1,1)","'-1+2","'@cmd",'safe "quoted", text\nnext']);
for(const row of parsed)for(const cell of row)assert.equal(/^\s*[=+\-@]/u.test(cell),false,'Parsed cells must not begin as spreadsheet formulas');
for(const [rows,keys] of [[Array.from({length:1001},()=>({value:'x'})),['value']],[[],Array.from({length:65},(_,i)=>`field${i}`)],[[{value:'ø'.repeat(524288)}],['value']]]){
 assert.throws(()=>safeCsv(rows,keys),error=>error.code==='CSV_EXPORT_LIMIT'&&error.status===413);
}

delete process.env.MONGODB_URI;delete process.env.MONGODB_DB;
process.env.NODE_ENV='test';process.env.DMILLS_REQUIRE_PERSISTENCE='false';
const [{default:handler},{insert,findOne}]=await Promise.all([import('../api/admin-parity.js'),import('../api/mongo.js')]);
await insert('admin_records',{type:'accounting-log',actor:'=HYPERLINK("https://fixture.invalid")',note:'\t+SUM(1,1)',normal:'safe'});
const res={statusCode:200,status(code){this.statusCode=code;return this;},setHeader(){},json(value){this.body=value;return this;},end(){}};
await handler({method:'POST',query:{},body:{action:'export-logs',screen:'accounting-log'},headers:{},user:{username:'fixture'}},res);
assert.equal(res.statusCode,200);
const report=await findOne('generic_records',{id:res.body.reportId});
assert.equal(report.module,'pending-report');
const exported=parse(report.content,{columns:true});
assert.equal(exported.length,1);assert.equal(exported[0].actor,'\'=HYPERLINK("https://fixture.invalid")');
assert.equal(exported[0].note,"'\t+SUM(1,1)");
await insert('admin_records',{type:'accounting-log',note:'x'.repeat(1024*1024)});
const denied={statusCode:200,status(code){this.statusCode=code;return this;},setHeader(){},json(value){this.body=value;return this;},end(){}};
await handler({method:'POST',query:{},body:{action:'export-logs',screen:'accounting-log'},headers:{},user:{username:'fixture'}},denied);
assert.equal(denied.statusCode,413);assert.equal(denied.body.error,'CSV_EXPORT_LIMIT');
console.log('PASS Admin CSV boundary: formula-leading values and headers are inert after CSV parsing; quotes/newlines round-trip through the report handler.');
