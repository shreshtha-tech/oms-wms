import { useCallback, useEffect, useState } from 'react';
import { apiGetLocal, apiSend } from '../lib/api';
import catalog from '../../inventory/sales-program-catalog.json';

export const programName=(key:string|null|undefined)=>catalog.find(item=>item.key===key)?.name||key||'';
type Program=typeof catalog[number];
type Account={id:string;platform:string;external_account_id:string;status:string;connection_state:string;verified_at:string|null;order_observation_enabled:boolean;webhooks_ready:boolean};
type Setup={account_id:string;program_key:string;stock_mode:string;reference:string;last_report_at:string|null;orders:number;stock_rows:number};
type Data={programs:Program[];accounts:Account[];setups:Setup[]};
type StockPage={rows:{external_sku:string;external_location_id:string;observed_quantity:string;observed_at:string}[];total:number;page:number};
type ConnectParent=(platform:string,accountId?:string)=>void|Promise<void>;
const base='/api/inventory-sync/connections/programs';
const when=(value:string|null)=>value?new Date(value).toLocaleString('en-IN'):'No report';
const encode=async(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read the report'));reader.readAsDataURL(file);});
const parentName=(platform:string)=>({myntra:'Myntra PPMP',amazon:'Amazon MFN',amazon_fba:'Amazon FBA',flipkart:'Flipkart',bigbasket:'bigbasket'} as Record<string,string>)[platform]||platform;
const accountConnectionLabel=(account:Account|undefined)=>{
 if(!account)return 'Parent account not connected';
 if(account.connection_state==='pending_approval')return 'Application details saved · not submitted';
 if(account.connection_state==='report_observed')return 'Report imported · API disconnected';
 if(account.connection_state==='token_expired')return 'Authorization expired';
 if(account.connection_state==='error')return 'Provider verification failed';
 if(account.connection_state==='verified'&&account.verified_at)return `Parent API verified${account.order_observation_enabled?' · order read enabled':''}`;
 return 'Authorization not verified';
};

export default function SalesPrograms({compact=false,onConnectParent}:{compact?:boolean;onConnectParent?:ConnectParent}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState(catalog[0].key);
 const load=useCallback(async()=>{try{setData(await apiGetLocal<Data>(base));setError('');}catch(e){setData(null);setError(e instanceof Error?e.message:'Programme status unavailable');}},[]);
 useEffect(()=>{void load();const update=()=>void load();const timer=setInterval(update,60000);window.addEventListener('inventory-live-changed',update);return()=>{clearInterval(timer);window.removeEventListener('inventory-live-changed',update);};},[load]);
 const programs=data?.programs||catalog;
 const program=programs.find(item=>item.key===selected)||programs[0];
 return <section className="ci-card"><div className="ci-toolbar"><h2>Marketplace programmes</h2><button onClick={()=>void load()}>Refresh programmes</button></div>
  <p>M-Now, Amazon Now, Minutes and other programmes use a parent seller account. A parent connection does not confirm programme access. Programme reports remain separate from central physical stock.</p>
  {error&&<p role="alert" className="ci-message ci-error">{error}</p>}
  <div className="ci-table-scroll"><table><thead><tr><th>Programme</th><th>Parent account</th><th>Parent connection</th><th>Programme status</th><th>Last report</th><th>Orders / stock rows</th>{!compact&&<th>Setup</th>}</tr></thead><tbody>{programs.flatMap(item=>{
   const setups=data?.setups.filter(setup=>setup.program_key===item.key)||[];
   return (setups.length?setups:[undefined]).map(setup=>{
    const linked=setup?data?.accounts.find(account=>account.id===setup.account_id):undefined;
    const candidates=data?.accounts.filter(account=>item.parents.includes(account.platform))||[];
    const account=linked||(candidates.length===1?candidates[0]:undefined);
    const programmeStatus=setup?.last_report_at?'Report only · automatic sync unavailable':setup?'Setup saved · programme access unverified':account?.connection_state==='pending_approval'?'Parent details saved · access unverified':account?.connection_state==='verified'&&account.verified_at?'Parent connected · programme access unverified':candidates.length>1?'Choose parent account':'Not configured';
    return <tr key={`${item.key}:${setup?.account_id||'none'}`}><td>{item.name}</td><td>{account?`${parentName(account.platform)} · ${account.external_account_id}`:candidates.length>1?'Choose in Manage':'Choose parent account'}</td><td>{accountConnectionLabel(account)}</td><td>{programmeStatus}</td><td>{when(setup?.last_report_at||null)}</td><td>{setup?`${setup.orders} / ${setup.stock_rows}`:'—'}</td>{!compact&&<td><button onClick={()=>setSelected(item.key)}>Manage {item.name}</button></td>}</tr>;
   });
  })}</tbody></table></div>
  {!compact&&data&&<ProgramEditor key={program.key} program={program} data={data} onChange={load} onConnectParent={onConnectParent}/>}
 </section>;
}

function ProgramEditor({program,data,onChange,onConnectParent}:{program:Program;data:Data;onChange:()=>Promise<void>;onConnectParent?:ConnectParent}){
 const accounts=data.accounts.filter(account=>program.parents.includes(account.platform));
 const [accountId,setAccountId]=useState(accounts[0]?.id||'');
 const [parentPlatform,setParentPlatform]=useState(program.parents[0]);
 const account=accounts.find(item=>item.id===accountId);
 const accountPlatform=account?.platform||parentPlatform;
 return <section className="sc-setup"><h3>{program.name}</h3>
  <p>{program.access}</p><p><strong>Order identity:</strong> {program.identity}</p><p><strong>Stock ownership:</strong> {program.stock}</p>
  <p><a href={program.source} target="_blank" rel="noreferrer">Official programme information ↗</a> · <a href={program.apiSource} target="_blank" rel="noreferrer">Parent integration reference ↗</a></p>
  <div className="ci-form"><label>Parent platform<select aria-label={`${program.name} parent platform`} value={accountPlatform} onChange={event=>{setParentPlatform(event.target.value);setAccountId('');}}>{program.parents.map(platform=><option key={platform} value={platform}>{parentName(platform)}</option>)}</select></label>
   {accounts.length>0&&<label>Parent seller account<select aria-label={`${program.name} parent seller account`} value={accountId} onChange={event=>{setAccountId(event.target.value);const chosen=accounts.find(item=>item.id===event.target.value);if(chosen)setParentPlatform(chosen.platform);}}><option value="">Choose an existing account</option>{accounts.map(item=><option key={item.id} value={item.id}>{parentName(item.platform)} · {item.external_account_id} · {accountConnectionLabel(item)}</option>)}</select></label>}
  </div>
  <div className="ci-toolbar"><span>{accountConnectionLabel(account)}. Programme access still requires separate partner confirmation.</span>
   <button disabled={!onConnectParent} onClick={()=>void onConnectParent?.(accountPlatform,account?.id)}>{account?`Open ${parentName(accountPlatform)} connection`:`Connect ${parentName(accountPlatform)}`}</button>
   <button disabled={!onConnectParent} onClick={()=>void onConnectParent?.(accountPlatform)}>Add another {parentName(accountPlatform)} account</button>
  </div>
  {account&&<ProgramAccount key={account.id} program={program} account={account} setup={data.setups.find(item=>item.program_key===program.key&&item.account_id===account.id)} onChange={onChange}/>}
  {!account&&<p>Connect a parent seller account above. This authorizes the parent platform only; it does not prove M-Now, Minutes, Fresh, Shopsy or bbnow enrollment.</p>}
 </section>;
}

function ProgramAccount({program,account,setup,onChange}:{program:Program;account:Account;setup?:Setup;onChange:()=>Promise<void>}){
 const [mode,setMode]=useState(setup?.stock_mode||'unverified'),[reference,setReference]=useState(setup?.reference||'');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [kind,setKind]=useState('stock'),[file,setFile]=useState<File|null>(null),[headerRow,setHeaderRow]=useState(1),[sheetName,setSheetName]=useState('');
 const [headers,setHeaders]=useState<string[]>([]),[encoded,setEncoded]=useState(''),[mapping,setMapping]=useState<Record<string,string>>({}),[asOf,setAsOf]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [page,setPage]=useState(1),[stocks,setStocks]=useState<StockPage|null>(null);
 const path=`${base}/${program.key}/${account.id}`;
 const resetReport=()=>{setHeaders([]);setEncoded('');setMapping({});setConfirmed(false);};
 const loadStocks=useCallback(async()=>{try{setStocks(await apiGetLocal<StockPage>(`${path}/stock?page=${page}`));}catch(e){setStocks(null);setError(e instanceof Error?e.message:'Programme stock unavailable');}},[path,page]);
 useEffect(()=>{void loadStocks();const update=()=>void loadStocks();window.addEventListener('inventory-live-changed',update);return()=>window.removeEventListener('inventory-live-changed',update);},[loadStocks]);
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await action();await onChange();await loadStocks();}catch(e){setError(e instanceof Error?e.message:'Programme action failed');}finally{setBusy(false);}};
 const fields=kind==='orders'?[['orderId','Exact parent-platform order ID']]:[['sku','Seller SKU'],['location','Facility / stock context ID'],['quantity','Available units']];
 return <div className="sc-setup">
  {error&&<p role="alert" className="ci-message ci-error">{error}</p>}{notice&&<p role="status" className="ci-message">{notice}</p>}
  <p>These settings document the provider arrangement. Live order intake and stock publishing remain unavailable until the approved connector contract is implemented and verified.</p>
  <div className="ci-form"><label>Stock ownership declared by supplier<select value={mode} disabled={busy||Boolean(setup?.stock_rows)} onChange={event=>setMode(event.target.value)}><option value="unverified">Not confirmed yet</option><option value="shared">Shared parent stock pool</option><option value="dedicated">Dedicated seller stock allocation</option><option value="custody">Partner / fulfillment-centre custody</option></select></label><label>Enrollment / report authorization reference<input value={reference} maxLength={250} onChange={event=>setReference(event.target.value)} placeholder="Supplier ticket or approved report reference"/></label></div>
  <button disabled={busy||!reference.trim()} onClick={()=>void run(async()=>{await apiSend(`${path}/setup`,'POST',{stockMode:mode,reference});setNotice('Programme reference saved. Automatic order and stock synchronization still requires a verified provider contract.');})}>Save programme setup</button>
  {setup&&<><h4>Import programme evidence</h4><p>Stock reports record observed quantities without changing the ledger. Order reports label orders already received through this parent account; they do not create duplicate orders or change order status. Use a report containing only {program.name}.</p>
   <div className="ci-form"><label>Report purpose<select disabled={busy} value={kind} onChange={event=>{setKind(event.target.value);resetReport();}}><option value="stock">Observe programme stock</option><option value="orders">Identify existing programme orders</option></select></label><label>CSV / XLSX report<input disabled={busy} type="file" accept=".csv,.xlsx" onChange={event=>{setFile(event.target.files?.[0]||null);resetReport();}}/></label><label>Worksheet (optional)<input disabled={busy} value={sheetName} onChange={event=>{setSheetName(event.target.value);resetReport();}} placeholder="First worksheet by default"/></label><label>Header row<input disabled={busy} type="number" min="1" max="20" value={headerRow} onChange={event=>{setHeaderRow(Number(event.target.value));resetReport();}}/></label><label>Actual report export time<input disabled={busy} type="datetime-local" value={asOf} onChange={event=>setAsOf(event.target.value)}/></label></div>
   <button disabled={busy||!file} onClick={()=>void run(async()=>{if(!file||file.size>5000000)throw new Error('Choose a report under 5 MB');const value=await encode(file);const result=await apiSend<{headers:string[];rows:number;sheet:string}>(`${path}/inspect`,'POST',{fileName:file.name,base64:value,headerRow,sheetName:sheetName||undefined});if(result.rows>2000)throw new Error('Split reports into no more than 2,000 rows');setEncoded(value);setHeaders(result.headers);setMapping({});setNotice(`${result.rows} rows in ${result.sheet}; choose the actual columns below.`);})}>Inspect programme report</button>
   {headers.length>0&&<><div className="ci-form">{fields.map(([key,label])=><label key={key}>{label}<select disabled={busy} value={mapping[key]||''} onChange={event=>setMapping({...mapping,[key]:event.target.value})}><option value="">Select column</option>{headers.map(header=><option key={header}>{header}</option>)}</select></label>)}</div><label className="ci-checkbox"><input disabled={busy} type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>This export contains only {program.name}, and its IDs belong to {account.external_account_id}.</label><button disabled={busy||!confirmed||!asOf||fields.some(([key])=>!mapping[key])} onClick={()=>void run(async()=>{if(!file)throw new Error('Choose a report');const result=await apiSend<{duplicate:boolean;count:number;stale:number}>(`${path}/import`,'POST',{kind,fileName:file.name,base64:encoded,headerRow,sheetName:sheetName||undefined,mapping,reportAsOf:new Date(asOf).toISOString(),programOnly:confirmed});setNotice(result.duplicate?'This report was already processed.':`${result.count} records updated; ${result.stale} older or unchanged records skipped. Physical stock and seller status were not changed.`);})}>Import programme report</button></>}
  </>}
  <h4>Programme stock observations</h4><p>These rows are excluded from central sellable totals. Latest report: {when(setup?.last_report_at||null)}.</p>
  <div className="ci-table-scroll"><table><thead><tr><th>Seller SKU</th><th>Facility</th><th>Observed units</th><th>Report time</th></tr></thead><tbody>{stocks?.rows.map(row=><tr key={`${row.external_sku}:${row.external_location_id}`}><td>{row.external_sku}</td><td>{row.external_location_id}</td><td>{row.observed_quantity}</td><td>{when(row.observed_at)}</td></tr>)}</tbody></table></div>
  {!stocks?.rows.length&&<p>No programme stock report recorded.</p>}<div className="ci-toolbar"><button disabled={page===1||busy} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page} · {stocks?.total||0} rows</span><button disabled={busy||page*25>=(stocks?.total||0)} onClick={()=>setPage(page+1)}>Next</button></div>
 </div>;
}
