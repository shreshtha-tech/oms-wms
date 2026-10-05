import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';
import { readFileSync } from 'node:fs';
import { openCredential, sealCredential } from '../inventory/credentials.js';

const COLLECTION = 'external_apps';
const BASE_FIELDS=new Set(['id','extsubid','extappType','extappTypeLabel','extappid','extappdesc','extappdesc1','status','clientId','billToParty','forceUpdate','forceUpdateId']);
const TYPE_LABELS={EDC:'Digital Payment',F:'Accounting',G:'Gift Card',SME:'SMS/Email',P:'Payment Gateway',DT:'Device Tracking',R:'Reward',POS:'Point of Sale',W:'Wallet',RI:'Robotics Integration',PCK:'Packaging Video',GC:'Geocoding',CA:'Custom App',TS:'E-Filling',CRM:'CRM'};
const CONFIG_ALIASES={user:'username',userpassword:'password',apiuser:'apiusername',userId:'userids',locationcode:'locationtype',minCrdVal:'mincrdval',maxCrdVal:'maxcrdval',MaxCrdAlwSell:'maxcrdalwsell',MaxCrdAlwRedeem:'maxcrdalwredeem'};
const STORED_SECRET='[stored]';
const isSensitiveKey=key=>/(?:password|secret|token|api.?key|credential\d+)/i.test(String(key));
function containsSensitiveKey(value){
  if(Array.isArray(value))return value.some(containsSensitiveKey);
  if(value&&typeof value==='object')return Object.entries(value).some(([key,item])=>isSensitiveKey(key)||containsSensitiveKey(item));
  return false;
}
const hasCredentialKey=()=>/^[0-9a-f]{64}$/i.test(process.env.INVENTORY_CREDENTIAL_KEY||'');
function openStoredConfigSecrets(row){
  if(!row?.secret_config_encrypted)return {};
  if(!hasCredentialKey())throw Object.assign(new Error('INVENTORY_CREDENTIAL_KEY is required to read saved External Apps credentials.'),{statusCode:503});
  try{return openCredential({encrypted_credentials:Buffer.from(row.secret_config_encrypted,'base64'),credential_iv:Buffer.from(row.secret_config_iv,'base64'),credential_tag:Buffer.from(row.secret_config_tag,'base64')});}
  catch{throw Object.assign(new Error('Saved External Apps credentials could not be decrypted; restore the configured credential key.'),{statusCode:503});}
}
function configForUpdate(row){return {...(row?.config&&typeof row.config==='object'?row.config:{}),...openStoredConfigSecrets(row)};}
function sealConfig(config){
  const publicConfig={},secretConfig={};
  for(const [key,value] of Object.entries(config||{})){if(['__proto__','constructor','prototype'].includes(key))continue;(isSensitiveKey(key)||containsSensitiveKey(value)?secretConfig:publicConfig)[key]=value;}
  if(!Object.keys(secretConfig).length)return {config:publicConfig,secret_config_encrypted:null,secret_config_iv:null,secret_config_tag:null,secret_config_keys:[]};
  if(!hasCredentialKey())throw Object.assign(new Error('Configure INVENTORY_CREDENTIAL_KEY before saving External Apps credentials.'),{statusCode:503});
  const sealed=sealCredential(secretConfig);
  return {config:publicConfig,secret_config_encrypted:sealed.encrypted.toString('base64'),secret_config_iv:sealed.iv.toString('base64'),secret_config_tag:sealed.tag.toString('base64'),secret_config_keys:Object.keys(secretConfig)};
}
function configForView(row){
  const config={...(row?.config&&typeof row.config==='object'?row.config:{})};
  let stored={};
  if(row?.secret_config_encrypted){
    try{stored=openStoredConfigSecrets(row);}
    catch{for(const key of row.secret_config_keys||[])config[key]=STORED_SECRET;}
  }
  for(const [key,value] of Object.entries(stored))config[key]=value;
  return config;
}
function maskConfig(value,key=''){
  if(isSensitiveKey(key))return value==null||value===''?value:STORED_SECRET;
  if(Array.isArray(value))return value.map(item=>maskConfig(item));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([name])=>!['__proto__','constructor','prototype'].includes(name)).map(([name,item])=>[name,maskConfig(item,name)]));
  return value;
}
const externalAppView=row=>{
  if(!row||typeof row!=='object')return row;
  const {secret_config_encrypted,secret_config_iv,secret_config_tag,secret_config_keys,...visible}=row;
  return {...visible,config:maskConfig(configForView(row))};
};
const text = (value) => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
let templateMatrix=[];
try{templateMatrix=JSON.parse(readFileSync(new URL('../docs/live-exploration/external-apps-dependent-controls-audit.json',import.meta.url),'utf8')).matrix||[]}catch(error){console.warn('External Apps template evidence unavailable:',error.message)}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.path?.includes('checkTaxIntConfigured')) {
      const body=req.body||{};
      const existing=(await find(COLLECTION)).find((row)=>row.ext_app_type===text(body.extappType)&&row.ext_app_id===text(body.extappid)&&row.bill_to_party===text(body.billToParty)&&row.client_id===text(body.clientId||'0')&&text(row.config?.model)===text(body.model)&&row.id!==Number(body.extAppSubId));
      return res.status(200).json({customMap:existing?{extAppSubId:existing.id}:{}});
    }
    if ((req.method === 'GET' && String(req.query?.meta) === 'true') || req.path?.includes('getRewardMasterDataForExtAppId')) {
      const appId=req.body?.extappid ?? req.query?.extappid;
      const app=templateMatrix.flatMap((type)=>type.apps||[]).find((item)=>String(item.value)===String(appId));
      const [locations,channels,partners]=await Promise.all([find('generic_records',{module:'location'}),find('channels'),find('partners')]);
      const locationOptions=locations.map((item)=>({text:`${item.name||item.location_name||item.code}-${item.code||item.location_code||''}`,value:text(item.code||item.location_code||item.id)}));
      const channelOptions=channels.map((item)=>({text:text(item.channel_name||item.name),value:text(item.channel_code||item.id)}));
      const billToPartyOptions=partners.map((item)=>({text:text(item.name||item.partner_name||item.code),value:text(item.code||item.partner_code||item.id)}));
      const observedOptions={};
      const panels={};
      const defaults={};
      const fields=[],controlTypes={},controlLabels={};
      for(const control of app?.controls||[]){const key=text(control.id).toLowerCase();if(!key||!Array.isArray(control.options))continue;const options=control.options.map((option)=>({text:text(option.text),value:text(option.value)}));if(options.length>(observedOptions[key]?.length||0))observedOptions[key]=options}
      for(const control of app?.controls||[]){const key=text(control.id).toLowerCase();if(key&&text(control.panel))panels[key]=text(control.panel)}
      for(const control of app?.controls||[]){const key=text(control.id).toLowerCase(),panel=text(control.panel);if(!key||!['Configurations','Additional Configuration','Transaction Type'].includes(panel)||!['INPUT','SELECT','TEXTAREA'].includes(control.tag))continue;if(!fields.includes(key))fields.push(key);controlTypes[key]=control.tag==='SELECT'?'dropdown':control.type||'text';if(text(control.label))controlLabels[key]=text(control.label)}
      for(const control of app?.controls||[]){const key=text(control.id).toLowerCase();if(!key||defaults[key]!=null)continue;if(control.tag==='SELECT'&&text(control.value)&&control.value!=='-1')defaults[key]=text(control.value);else if(control.type==='checkbox'&&control.checked)defaults[key]=true}
      const options={...observedOptions,billToParty:billToPartyOptions};
      if(locationOptions.length){options.locationtype=locationOptions;options.location=locationOptions;options.excludelocation=locationOptions}
      if(channelOptions.length){options.saleschannel=channelOptions;options.b2bchannel=channelOptions}
      return res.status(200).json({ authFields: app?.authFields || [], options, panels, defaults, fields, controlTypes, controlLabels, instructions:app?.instructions||[] });
    }
    if (req.method === 'GET') return res.status(200).json({ rows: (await find(COLLECTION, {}, { sort: { id: -1 } })).map(externalAppView) });
    if (req.method === 'POST' && req.body?.REQ_SEARCH_FLAG) {
      const body = req.body;
      let rows = (await find(COLLECTION)).filter((row) => has(row.ext_app_type, body.extapptype) && has(row.ext_app_id, body.extid) && has(row.ext_app_desc, body.desc) && has(row.client_id, body.clientId));
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const records = rows.length;
      const total = Math.ceil(records / size);
      rows = rows.slice((page - 1) * size, page * size);
      rows=rows.map(externalAppView);
      return res.status(200).json({ rows, gridModel: rows, page, total, records });
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = req.body || {};
      if (!text(body.extappType) || body.extappType === '-1') return res.status(400).json({ error: 'Select ExtApps Type' });
      if (!text(body.extappid) || body.extappid === '-1') return res.status(400).json({ error: 'Select ExtApps Name' });
      if (!text(body.extappdesc1)) return res.status(400).json({ error: 'Fill ExtApps Desc' });
      if (!['0', '1'].includes(text(body.status))) return res.status(400).json({ error: 'Please Select Status' });
      const directId=Number(body.extsubid||body.id);
      const forced=body.forceUpdate==='1'?(await find(COLLECTION)).find((row)=>row.ext_app_type===text(body.extappType)&&row.ext_app_id===text(body.extappid)&&row.bill_to_party===text(body.billToParty)&&row.client_id===text(body.clientId||'0')&&text(row.config?.model)===text(body.model)):null;
      const current = directId ? await findOne(COLLECTION,{id:directId}) : forced||null;
      if (req.method === 'PUT' && !current) return res.status(404).json({ error: 'External App not found' });
      const now = new Date().toISOString();
      const config=configForUpdate(current);
      for(const [key,value] of Object.entries(body).filter(([key])=>!BASE_FIELDS.has(key)&&!['credential0','config','__proto__','constructor','prototype'].includes(key))){
        const storageKey=CONFIG_ALIASES[key]||key;
        if(isSensitiveKey(storageKey)&&(value===STORED_SECRET||value==null||String(value).trim()===''))continue;
        config[storageKey]=value;
      }
      const sealedConfig=sealConfig(config);
      const document = {
        ext_app_type: text(body.extappType), ext_app_type_label: text(body.extappTypeLabel||TYPE_LABELS[body.extappType]),
        ext_app_id: text(body.extappid), ext_app_name: text(body.extappdesc), ext_app_desc: text(body.extappdesc1),
        status: body.status === '1' ? 'Active' : 'InActive', client_id: text(body.clientId || '0'),
        bill_to_party: text(body.billToParty), ...sealedConfig,
        registration_date: current?.registration_date || now, created_date: current?.created_date || now, created_by: current?.created_by || 'super admin', modified_date: now, modified_by: 'super admin', updated_date: now,
      };
      const saved = current ? (await update(COLLECTION, current.id, document))[0] : await insert(COLLECTION, document);
      return res.status(current ? 200 : 201).json({ rewardMaintDTO: { ...externalAppView(saved), extAppSubId: saved.id, saveStatus: '1' } });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('external apps request failed:', error.statusCode||error.name||'Error');
    return res.status(error.statusCode||500).json({ error:error.statusCode===503?error.message:'External Apps request failed' });
  }
}
