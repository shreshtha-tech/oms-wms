import { platformRequirements } from '../pages/platformRequirements';

type Stream={state:string;label:string;detail:string;lastConfirmedAt:string|null};
type Account={platform:string;external_account_id:string;status:string;connection_state:string;live_connected:boolean;readiness?:{orders:Stream}};

function statusFor(platform:string,accounts:Account[]){
 const rows=accounts.filter(account=>account.platform===platform);
 if(rows.some(account=>account.live_connected))return rows.find(account=>account.live_connected)?.readiness?.orders.label||'Order feed ready';
 if(rows.some(account=>account.connection_state==='report_observed'))return 'Report only · no live feed';
 if(rows.some(account=>account.connection_state==='token_expired'))return 'Token expired';
 if(rows.some(account=>account.connection_state==='error'))return 'Connection error';
 if(rows.some(account=>account.connection_state==='pending_approval'))return platform==='tally'?'Local bridge pairing required':'Setup details saved · not authenticated';
 const orderStatus=rows.find(account=>account.readiness)?.readiness?.orders;
 if(orderStatus)return orderStatus.label;
 if(rows.some(account=>account.connection_state==='verified'))return 'Verified · activation required';
 if(rows.length)return 'Setup saved · not live';
 return 'Not connected';
}

export default function LiveConnectionStatus({accounts,onConnect}:{accounts:Account[];onConnect:(platform?:string)=>void}){
 const connected=new Set(accounts.filter(account=>account.live_connected).map(account=>account.platform));
 const liveCount=platformRequirements.filter(item=>connected.has(item.key)).length;
 const notLive=platformRequirements.length-liveCount;
 const reportOnly=new Set(accounts.filter(account=>account.connection_state==='report_observed').map(account=>account.platform)).size;
 return <section className="rounded border border-slate-200 bg-white p-4" aria-label="Seller platform connections">
  {notLive>0&&<div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
   <span>{notLive} platform{notLive===1?'':'s'} do not currently have a verified, operational order feed{reportOnly?`; ${reportOnly} currently have report-only access`:''}.</span>
   <button className="rounded border border-amber-500 bg-white px-3 py-1.5 font-medium" onClick={()=>onConnect()}>Review connections</button>
  </div>}
  <details>
   <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 font-semibold">
    <span>Connection status · show platform details</span><span className="rounded bg-slate-100 px-2 py-1 text-sm font-medium text-slate-700">{liveCount} of {platformRequirements.length} order feeds ready · {notLive} not fully verified</span>
   </summary>
   <div className="mt-3 max-h-80 overflow-y-auto rounded border border-slate-200">
    <ul className="divide-y divide-slate-200">
     {platformRequirements.map(item=>{
      const rows=accounts.filter(account=>account.platform===item.key),isConnected=connected.has(item.key);
      const orderState=rows.find(row=>row.readiness)?.readiness?.orders.state;
      return <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
       <div className="min-w-48"><strong>{item.name}</strong><span className={`ml-2 inline-block rounded px-2 py-0.5 text-xs ${isConnected?'bg-green-100 text-green-800':rows.some(row=>row.connection_state==='report_observed')||['partial','starting','setup_required'].includes(orderState||'')?'bg-amber-100 text-amber-900':'bg-slate-100 text-slate-700'}`}>{statusFor(item.key,accounts)}</span>
        {rows.length>0&&<small className="mt-1 block text-slate-500">{rows.map(row=>row.external_account_id).filter(Boolean).join(', ')}</small>}
       </div>
       <button className="rounded border border-slate-300 bg-white px-3 py-1.5" onClick={()=>onConnect(item.key)}>{rows.length?'Manage / verify':'Connect'}</button>
      </li>;
     })}
    </ul>
   </div>
  </details>
 </section>;
}
