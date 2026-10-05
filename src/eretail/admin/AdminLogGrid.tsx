import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Download, PlusCircle, Search, X } from 'lucide-react';
import { apiGet, apiSend } from '../../lib/api';
import { AdminParityHeader, AdminParityNotice } from './AdminParityParts';
import definitions from './adminLogDefinitions.json';

export type LogColumn = { key: string; label: string; width: number; filter?: string; options?: {text:string;value:string}[]; value?: string; dateRange?: boolean; dynamic?: boolean };
export type LogRow = Record<string, unknown> & {id: number};
type Definition = {title:string;actions:string[];tabs:string[];grids:{key:string;endpoint:string;columns:LogColumn[]}[]};
export const weekRange = () => { const end=new Date(),start=new Date(); start.setDate(end.getDate()-7); const fmt=(d:Date)=>d.toLocaleDateString('en-GB'); return `${fmt(start)} - ${fmt(end)}`; };
export const initialFilters = (columns:LogColumn[]) => Object.fromEntries(columns.filter(c=>c.filter).map(c=>[c.key,c.dateRange&&c.value?weekRange():c.value||'']));
export function AdminAction({label,onClick,disabled=false}:{label:string;onClick:()=>void;disabled?:boolean}) {
  const Icon=label==='Search'?Search:label==='Reset'||label==='Cancel'?X:label==='Export'||label==='Download'?Download:label==='Add New'||label==='Add'?PlusCircle:Check;
  const tone=['Search','Save','Download'].includes(label)?'save':['Re Push','Confirm','Repush','Add'].includes(label)?'green':label==='Cancel'?'danger':'';
  return <button className={`admin-parity-button ${tone}`} disabled={disabled} onClick={onClick}><Icon size={12}/>{label}</button>;
}
export function AdminGrid({columns,rows,filters={},onFilter,onSearch,page=0,total=0,size=20,onPage,onSize,selected=[],onSelect,renderCell}: {
  columns:LogColumn[]; rows:LogRow[]; filters?:Record<string,string>;onFilter?:(key:string,value:string)=>void;onSearch?:()=>void;page?:number;total?:number;size?:number;onPage?:(page:number)=>void;onSize?:(size:number)=>void;selected?:number[];onSelect?:(ids:number[])=>void;renderCell?:(row:LogRow,column:LogColumn)=>ReactNode;
}) {
  const pages=Math.ceil(total/size),width=columns.reduce((sum,c)=>sum+c.width,0);
  return <div className="admin-log-grid"><div className="admin-log-scroll"><table style={{minWidth:width>1500?width:undefined}}><colgroup>{columns.map(c=><col key={c.key} style={{width:width>1500?c.width:`${c.width/width*100}%`}}/>)}</colgroup><thead><tr>{columns.map(c=><th key={c.key}>{c.key==='cb'?<input aria-label="Select all rows" type="checkbox" checked={rows.length>0&&rows.every(r=>selected.includes(r.id))} onChange={e=>onSelect?.(e.target.checked?rows.map(r=>r.id):[])}/>:c.label}</th>)}</tr>{onFilter&&<tr className="admin-grid-filters">{columns.map(c=><th key={c.key}>{c.filter==='select'?<select aria-label={c.label} value={filters[c.key]??'-1'} onChange={e=>onFilter(c.key,e.target.value)}>{(c.options||[{text:'--- Select ---',value:'-1'}]).map((o,i)=><option key={`${o.value}-${i}`} value={o.value}>{o.text}</option>)}</select>:c.filter?<div><input aria-label={c.label} value={filters[c.key]||''} onChange={e=>onFilter(c.key,e.target.value)} onKeyDown={e=>e.key==='Enter'&&onSearch?.()}/><Search size={11}/></div>:null}</th>)}</tr>}</thead><tbody>{rows.map(row=><tr key={row.id} className={selected.includes(row.id)?'selected':''}>{columns.map(c=><td key={c.key}>{c.key==='cb'?<input aria-label={`Select row ${row.id}`} type="checkbox" checked={selected.includes(row.id)} onChange={e=>onSelect?.(e.target.checked?[...selected,row.id]:selected.filter(id=>id!==row.id))}/>:renderCell?.(row,c)??String(row[c.key]??'')}</td>)}</tr>)}</tbody></table></div>
    <div className="admin-grid-pager"><div className="admin-grid-pages"><button aria-label="First page" disabled={page<=1} onClick={()=>onPage?.(1)}><ChevronsLeft size={14}/></button><button aria-label="Previous page" disabled={page<=1} onClick={()=>onPage?.(page-1)}><ChevronLeft size={14}/></button><span>Page <input aria-label="Page" key={page} defaultValue={page} onKeyDown={e=>{if(e.key==='Enter')onPage?.(Math.max(1,Math.min(pages,Number(e.currentTarget.value)||1)));}}/> of {pages}</span><button aria-label="Next page" disabled={page>=pages} onClick={()=>onPage?.(page+1)}><ChevronRight size={14}/></button><button aria-label="Last page" disabled={page>=pages} onClick={()=>onPage?.(pages)}><ChevronsRight size={14}/></button><select aria-label="Records per Page" value={size} onChange={e=>onSize?.(Number(e.target.value))}>{[20,50,100,200].map(n=><option key={n}>{n}</option>)}</select></div><span>{total?`View ${(Math.max(1,page)-1)*size+1} - ${Math.min(page*size,total)} of ${total}`:'No records to view'}</span></div>
  </div>;
}

export default function AdminLogGrid({screen}:{screen:string}) {
  const definition=(definitions as Record<string,Definition>)[screen];
  const [tab,setTab]=useState(0),[financialClient,setFinancialClient]=useState('TLY');
  const grid=definition.grids[Math.min(tab,definition.grids.length-1)];
  const [filters,setFilters]=useState(()=>initialFilters(grid.columns));
  const [rows,setRows]=useState<LogRow[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[size,setSize]=useState(20),[selected,setSelected]=useState<number[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [catalog,setCatalog]=useState<Record<string,{text:string;value:string}[]>>({});
  const columns=grid.columns.map(c=>c.dynamic?{...c,options:[...(c.options||[]),...(catalog[c.key]||[])]}:c);
  useEffect(()=>{void apiGet<Record<string,{text:string;value:string}[]>>(`/api/admin-parity?action=log-catalog&screen=${screen}`).then(setCatalog).catch(e=>setMessage(e.message));},[screen]);
  const search=async(next=1,nextSize=size,values=filters)=>{
    if(screen==='accounting-log'&&financialClient!=='XRO'&&values.billPartyCode&&values.billPartyCode!=='-1'&&values.intCode==='-1'){setMessage('Document Type is manadatory for searching');return;}
    setBusy(true);
    try {const result=await apiSend<{rows:LogRow[];total:number;page:number}>('/api/admin-parity','POST',{action:'search-logs',screen,tab:grid.key,filters:values,financialClient,page:next,size:nextSize});setRows(result.rows);setTotal(result.total);setPage(result.total?result.page:0);setSelected([]);}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to load logs');}finally{setBusy(false);}
  };
  const reset=()=>{setFilters(initialFilters(grid.columns));setRows([]);setTotal(0);setPage(0);setSelected([]);setMessage('');};
  const changeTab=(index:number)=>{setTab(index);setFilters(initialFilters(definition.grids[Math.min(index,definition.grids.length-1)].columns));setRows([]);setTotal(0);setPage(0);setSelected([]);};
  const action=async(label:string)=>{
    if(label==='Search')return search();if(label==='Reset')return reset();
    if(label==='Export') {try{await apiSend('/api/admin-parity','POST',{action:'export-logs',screen,tab:grid.key,filters,financialClient});setMessage('Report generated. Open Exports to download.');}catch(e){setMessage(e instanceof Error?e.message:'Unable to export');}return;}
    if(!selected.length&&['Re Push','Confirm','Repush'].includes(label)){setMessage(screen==='repush-log'?'Please Select Grid Row For Repush':'Please select at least one record');return;}
    try {await apiSend('/api/admin-parity','POST',{action:'log-action',screen,tab:grid.key,operation:label,ids:selected});await search();}catch(e){setMessage(e instanceof Error?e.message:'Unable to complete action');}
  };
  return <div className="admin-parity admin-log-page" aria-busy={busy}><AdminParityHeader title={definition.title}>{definition.actions.map(label=><AdminAction key={label} label={label} disabled={busy} onClick={()=>void action(label)}/>)}</AdminParityHeader><AdminParityNotice message={message} close={()=>setMessage('')}/>
    {!!definition.tabs.length&&<div className="admin-log-tabs">{definition.tabs.map((label,index)=><button className={tab===index?'active':''} onClick={()=>changeTab(index)} key={label}>{label}</button>)}{screen==='accounting-log'&&<select aria-label="Financial Client" value={financialClient} onChange={e=>{setFinancialClient(e.target.value);reset();}}><option value="XRO">Xero</option><option value="ZOH">ZohoBooks</option><option value="TLY">Tally</option></select>}</div>}
    <AdminGrid columns={columns} rows={rows} filters={filters} onFilter={(key,value)=>{const values={...filters,[key]:value};setFilters(values);if(screen==='external-apps-logs')void search(1,size,values);}} onSearch={()=>void search()} total={total} page={page} size={size} onPage={p=>void search(p)} onSize={n=>{setSize(n);void search(1,n);}} selected={selected} onSelect={setSelected}/>
  </div>;
}
