import { randomBytes } from 'node:crypto';
import { sendDatabaseUnavailable, cors, find, findOne, insert, update, updateAdminIfVersion, remove } from './mongo.js';
import { currentUser } from './auth-session.js';
import { locations } from './catalogs.js';
import { safeCsv, csvExportLimit } from './csv-safe.js';
import { adminApiKeyView } from './admin-api-key-view.js';

const logTypes = new Set(['accounting-log','tax-integration-log','device-tracking-log','external-apps-logs','pos-integration-log','repush-log']);
const text = value => String(value ?? '');
const apiKeyView = adminApiKeyView;
const parseDate = value => { const m=text(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`) : new Date(value); };
const filterRows = (rows,filters={}) => rows.filter(row => Object.entries(filters).every(([key,value]) => {
  if(!value || value==='-1')return true;
  if(/Date|date/.test(key) && text(value).includes(' - ')) { const [start,end]=text(value).split(' - ').map(parseDate);const date=parseDate(row[key]);end.setHours(23,59,59,999);return date>=start&&date<=end; }
  return text(row[key]).toLowerCase().includes(text(value).toLowerCase());
}));
const report = async (name, rows, keys) => insert('generic_records',{module:'pending-report',code:`EXP-${randomBytes(6).toString('hex')}`,name,status:'SUCCESS',created_date:new Date().toISOString(),completed_date:new Date().toISOString(),link:true,forceProcess:'N',content:safeCsv(rows,keys)});
const searchLogs = async body => {
  if(!logTypes.has(body.screen))throw new Error('Unknown log screen');
  const rows=await find('admin_records',{type:body.screen},{sort:{id:-1}});
  return filterRows(rows.filter(row=>(!body.tab||!row.tab||row.tab===body.tab)&&(!body.financialClient||!row.financialClient||row.financialClient===body.financialClient)),body.filters);
};
export default async function handler(req,res) {
  if(cors(req,res))return;
  try {
    const b=req.method==='GET'?req.query:req.body||{};
    if(req.method==='GET') {
      if(b.action==='log-catalog') {
        const [parties,apps]=await Promise.all([find('generic_records',{module:'bill-party'}),find('generic_records',{module:'external-app'})]);
        const companies=parties.map(row=>({text:row.name,value:text(row.code)}));
        return res.json({billPartyCode:companies,billPartyCodeTL:companies,channelCode:apps.map(row=>({text:row.name,value:text(row.code)}))});
      }
      if(b.action==='language-search') {
        const rows=await find('generic_records',{module:'language-property'});
        const filtered=filterRows(rows,{propertyType:b.propertyType,propertyKey:b.propertyKey}).map(row=>({...row,langValue:row.translations?.[b.languageId]??row.defaultValue??''})).filter(row=>!b.propertyValue||text(row.langValue).toLowerCase().includes(text(b.propertyValue).toLowerCase()));
        const size=Math.min(200,Math.max(1,Number(b.size)||20)),page=Math.max(1,Number(b.page)||1);
        return res.json({rows:filtered.slice((page-1)*size,page*size),total:filtered.length,page});
      }
      if(b.action==='api-catalog') {
        const [keys,billParties,locs]=await Promise.all([find('admin_records',{type:'api-key'}),find('generic_records',{module:'bill-party'}),locations()]);
        return res.json({keys:keys.map(apiKeyView),billParties:billParties.map(row=>({text:row.name,value:text(row.code)})),locations:locs.map(row=>({text:row.name,value:text(row.code)}))});
      }
      if(b.action==='api-metrics') {
        const all=await find('admin_records',{type:'api-request'});
        const rows=all.filter(row=>(!b.apiKey||text(row.apiKeyId)===b.apiKey)&&(!b.apiName||row.apiName===b.apiName)&&(!b.httpCode||text(row.statusCode).startsWith(text(b.httpCode)[0]))&&(!b.from||new Date(row.at)>=new Date(b.from))&&(!b.to||new Date(row.at)<=new Date(b.to)));
        const times=rows.map(row=>Number(row.durationMs)||0),counts=[0,0,0,0,0];
        times.forEach(ms=>counts[ms<=500?0:ms<=1000?1:ms<=5000?2:ms<=10000?3:4]++);
        const group=key=>Object.entries(rows.reduce((sum,row)=>{const value=text(row[key]);sum[value]=(sum[value]||0)+1;return sum;},{})).map(([name,count])=>({name,count}));
        return res.json({min:times.length?Math.min(...times):0,max:times.length?Math.max(...times):0,avg:times.length?Math.round(times.reduce((a,c)=>a+c,0)/times.length):0,counts,total:rows.length,topApis:group('apiName'),servers:group('server'),hits:rows.map(row=>({at:row.at,durationMs:row.durationMs})),apiNames:[...new Set(all.map(row=>row.apiName).filter(Boolean))]});
      }
      if(b.action==='webhooks')return res.json(await find('admin_records',{type:'api-webhook'}));
      return res.status(400).json({error:'Unknown Admin request'});
    }
    if(req.method==='PUT'&&b.action==='language-save') {
      const row=await findOne('generic_records',{id:Number(b.id),module:'language-property'});
      if(!row)return res.status(404).json({error:'Language property not found'});
      if(text(b.overrideValue).trim().toUpperCase()===text(row.defaultValue).trim().toUpperCase())return res.status(422).json({error:'Overrided Text is should not be same as Default Text'});
      const saved=await update('generic_records',row.id,{translations:{...row.translations,[b.languageId]:text(b.overrideValue)}});
      return res.json({...saved[0],langValue:text(b.overrideValue)});
    }
    if(req.method==='DELETE'&&b.action==='webhook-delete') {
      const row=await findOne('admin_records',{id:Number(b.id),type:'api-webhook'});
      if(!row)return res.status(404).json({error:'Webhook not found'});
      const count=(await find('admin_records',{type:'api-webhook'})).length;
      if(count===1)return res.status(422).json({error:'Unable to delele Last Api Name'});
      await remove('admin_records',row.id);
      return res.json({ok:true});
    }
    if(req.method==='POST') {
      if(b.action==='search-logs') {const rows=await searchLogs(b),size=Math.min(200,Math.max(1,Number(b.size)||20)),page=Math.max(1,Number(b.page)||1);return res.json({rows:rows.slice((page-1)*size,page*size),total:rows.length,page});}
      if(b.action==='export-logs') {
        const rows=await searchLogs(b),keySet=new Set();
        if(rows.length>1000)throw csvExportLimit();
        for(const row of rows)for(const key of Object.keys(row))if(!['id','type'].includes(key)){keySet.add(key);if(keySet.size>64)throw csvExportLimit();}
        const keys=[...keySet];const saved=await report(b.screen,rows,keys.length?keys:['Document Number','Status']);return res.json({reportId:saved.id});
      }
      if(b.action==='audit-export') {
        if(!b.fromDate||!b.toDate||!b.logType||b.logType==='-1')return res.status(422).json({error:'Please fill all mandatory fields'});
        const from=parseDate(b.fromDate),to=parseDate(b.toDate),today=new Date();today.setHours(0,0,0,0);
        if(!Number.isFinite(+from)||!Number.isFinite(+to))return res.status(422).json({error:'Please fill all mandatory fields'});
        if(from>to)return res.status(422).json({error:'From date should be greater than To date'});
        if(from>today)return res.status(422).json({error:'From date should be greater than today'});
        if(to>today)return res.status(422).json({error:'To date should be greater than today'});
        const anniversary=new Date(from);anniversary.setFullYear(from.getFullYear()+1);if(to>anniversary)return res.status(422).json({error:'Date Range Should Be an Year '});
        to.setHours(23,59,59,999);
        const rows=(await find('admin_records',{type:'audit'})).filter(row=>new Date(row.at)>=from&&new Date(row.at)<=to&&(row.logType===b.logType||(b.logType==='Role'&&row.entity==='role')||(['User','UserLogs'].includes(b.logType)&&row.entity==='user')||(b.logType==='Login'&&row.event==='Login')));
        const saved=await report(`User Audit Logs - ${b.logType}`,rows,['at','actor','event','entity','entityId']);return res.json({reportId:saved.id});
      }
      if(b.action==='log-action')return res.status(501).json({error:'This action requires the configured integration service.'});
      if(b.action==='api-save') {
        if(b.id && (!Number.isSafeInteger(b.version)||b.version<0))return res.status(422).json({error:'A valid record version is required. Refresh and try again.'});
        const prior=b.id?await findOne('admin_records',{id:Number(b.id),type:'api-key'}):null;
        if(b.id&&!prior)return res.status(404).json({error:'API key not found'});
        const values={billToParty:b.billToParty||'-1',timezone:b.timezone||'-1',maskStatus:b.maskStatus||[],isMonitor:!!b.isMonitor,allowedIps:text(b.allowedIps),permissions:Array.isArray(b.permissions)?b.permissions:[],keyForVinLister:!!b.keyForVinLister};
        if(prior && b.version!==(prior.version??0))return res.status(409).json({error:'Record was changed by another user. Refresh and try again.'});
        const saved=prior?await updateAdminIfVersion(prior.id,prior.version,values):await insert('admin_records',{type:'api-key',...values,apiKey:randomBytes(24).toString('hex'),owner:currentUser(req)?.username||'',status:'Active',createdAt:new Date().toISOString(),expiryDate:'',version:1});
        if(!saved)return res.status(409).json({error:'Record was changed by another user. Refresh and try again.'});
        return res.json(apiKeyView(saved));
      }
      if(b.action==='webhook-save') {
        if(!b.apiCategory||b.apiCategory==='-1')return res.status(422).json({error:'API Category is mandatory'});
        if(!b.url)return res.status(422).json({error:'Webhook URL is mandatory'});
        try {const url=new URL(b.url);if(!['http:','https:'].includes(url.protocol))throw Error();}catch{return res.status(422).json({error:'Invalid Webhook URL'});}
        const values={source:b.source,payloadType:b.payloadType,apiCategory:b.apiCategory,apiName:b.apiName,version:b.version,url:b.url,headers:text(b.headers),active:!!b.active};
        if(b.id){const prior=await findOne('admin_records',{id:Number(b.id),type:'api-webhook'});if(!prior)return res.status(404).json({error:'Webhook not found'});return res.json((await update('admin_records',prior.id,values))[0]);}
        return res.json(await insert('admin_records',{type:'api-webhook',...values}));
      }
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){
    if(error?.code==='CSV_EXPORT_LIMIT')return res.status(413).json({error:'CSV_EXPORT_LIMIT',message:'Export exceeds the supported CSV size. Narrow the date range or filters.'});
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Admin parity API unexpected failure');
    return res.status(500).json({error:'Unexpected Admin API error'});}
}
