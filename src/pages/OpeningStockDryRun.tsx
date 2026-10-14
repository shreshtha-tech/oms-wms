import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';

type Issue = { status:string; sourceColumn:string; reason:string; valueReference:string };
type Report = {
  fileSha256:string; rowsRead:number; rowsValid:number; rowsInvalid:number; rowsDuplicated:number;
  rowsUnmapped:number; rowsAmbiguous:number; rowsReadyForApproval:number; rowsReadyToImport:number;
  rejectedRows:{sheet:string; row:number; status:string; issues:Issue[]}[];
};
type BatchView = {
  batch:{id:string;status:string;source_reference:string;file_sha256:string;source_date:string;mapping_version:string;
    rows_read:number;rows_valid:number;created_by:string;approved_by:string|null;posted_by:string|null;result:unknown};
  lines:{sheet_name:string;source_row:number;sku:string;location:string;quantity:string;uom:string;event_id:string|null}[];
  audit:{from_status:string|null;to_status:string;actor:string;created_at:string}[];
};
type Transition = {id:string;status:string;duplicate?:boolean;batchId?:string;rows?:number;eventIds?:string[];fileSha256?:string};

const encode = (file:File) => new Promise<string>((resolve,reject) => {
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result).split(',')[1]);
  reader.onerror=()=>reject(new Error('Could not read workbook'));
  reader.readAsDataURL(file);
});
const errorText=(cause:unknown)=>cause instanceof Error?cause.message:'Opening-stock request failed';

export default function OpeningStockDryRun({file,permissions}:{file:File|null;permissions:string[]}) {
  const [sheet,setSheet]=useState(''),[headerRow,setHeaderRow]=useState(''),[version,setVersion]=useState('');
  const [skuHeader,setSkuHeader]=useState(''),[skuColumn,setSkuColumn]=useState('');
  const [locationMode,setLocationMode]=useState(''),[locationHeader,setLocationHeader]=useState(''),[locationColumn,setLocationColumn]=useState('');
  const [locationCode,setLocationCode]=useState(''),[locationEvidence,setLocationEvidence]=useState(''),[locationValueMap,setLocationValueMap]=useState('');
  const [quantityHeader,setQuantityHeader]=useState(''),[quantityColumn,setQuantityColumn]=useState(''),[quantityFormat,setQuantityFormat]=useState(''),[uom,setUom]=useState('');
  const [sourceReference,setSourceReference]=useState(''),[sourceDate,setSourceDate]=useState('');
  const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [batchId,setBatchId]=useState(''),[batch,setBatch]=useState<BatchView|null>(null),[batchError,setBatchError]=useState('');
  const can=(permission:string)=>permissions.includes(permission);

  useEffect(()=>{setReport(null);setError('');setBatch(null);setBatchError('');},[file]);

  function mappingValue() {
    let valueMap:Record<string,string>|undefined;
    if(locationValueMap.trim()) {
      const parsed:unknown=JSON.parse(locationValueMap);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.values(parsed).some(value=>typeof value!=='string'))throw new Error('Location value map must be a JSON object of source and Central Inventory codes');
      valueMap=parsed as Record<string,string>;
    }
    const location=locationMode==='column'
      ? {mode:'column',column:Number(locationColumn),header:locationHeader,transform:'trim',...(valueMap?{valueMap}:{})}
      : {mode:'constant',code:locationCode,evidenceRef:locationEvidence};
    return {version,sheet,headerRow:Number(headerRow),sku:{column:Number(skuColumn),header:skuHeader,transform:'trim'},
      location,quantity:{column:Number(quantityColumn),header:quantityHeader,format:quantityFormat},unitContract:'exact_sku_units',uom};
  }

  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setReport(null);setError('');setBatch(null);setBatchError('');
    try {
      if(!file||file.size>7*1024*1024)throw new Error('Choose an .xlsx workbook no larger than 7 MB');
      setReport(await apiSend<Report>('/api/inventory-sync/central/imports/opening-stock/dry-run','POST',
        {fileName:file.name,base64:await encode(file),mapping:mappingValue()}));
    } catch (cause) { setError(errorText(cause)); }
    finally {setBusy(false);}
  }

  async function loadBatch(id=batchId) {
    if(!can('central_inventory.opening_stock.read'))throw new Error('Your account lacks opening-stock read permission');
    if(!id)throw new Error('Enter an opening-stock batch ID');
    const value=await apiGet<BatchView>(`/api/inventory-sync/central/imports/opening-stock/${encodeURIComponent(id)}`);
    setBatch(value);setBatchId(id);setBatchError('');
  }

  async function stageBatch() {
    setBusy(true);setError('');setBatchError('');
    try {
      if(!file||file.size>7*1024*1024)throw new Error('Choose an .xlsx workbook no larger than 7 MB');
      if(!report||report.rowsInvalid!==0||report.rowsRead===0||report.rowsReadyForApproval!==report.rowsRead)throw new Error('Run a clean dry run before staging');
      const result=await apiSend<Transition>('/api/inventory-sync/central/imports/opening-stock','POST',{
        fileName:file.name,base64:await encode(file),sourceReference,sourceDate,mapping:mappingValue(),
      });
      setBatchId(result.id);
      if(can('central_inventory.opening_stock.read'))await loadBatch(result.id);
      else setBatchError(`Batch ${result.id} was staged as ${result.status}. Read permission is not assigned to this account.`);
    } catch (cause) { setError(errorText(cause)); }
    finally {setBusy(false);}
  }

  async function transition(action:'request-approval'|'approve'|'post') {
    setBusy(true);setBatchError('');
    try {
      if(!batchId)throw new Error('Load an opening-stock batch first');
      const result=await apiSend<Transition>(`/api/inventory-sync/central/imports/opening-stock/${encodeURIComponent(batchId)}/${action}`,'POST',{});
      if(can('central_inventory.opening_stock.read'))await loadBatch(result.id||batchId);
      else setBatchError(`Batch transition recorded as ${result.status}; read permission is not assigned to this account.`);
    } catch (cause) { setBatchError(errorText(cause)); }
    finally {setBusy(false);}
  }

  return <section className="ci-card"><h2>Opening-stock validation and approval</h2>
    <p className="ci-caption">Enter the evidenced workbook mapping exactly. Up to 50,000 data rows (7 MB) are accepted. Dry-run validates tenant SKU and location eligibility without writing stock. Initial quantities post only through the audited, separate-actor approval workflow.</p>
    <form className="ci-form" onSubmit={submit}>
      <label>Mapping version<input required value={version} onChange={event=>setVersion(event.target.value)} placeholder="Owner-approved version"/></label>
      <label>Worksheet name<input required value={sheet} onChange={event=>setSheet(event.target.value)} placeholder="Exact sheet name"/></label>
      <label>Header row<input required type="number" min="1" step="1" value={headerRow} onChange={event=>setHeaderRow(event.target.value)}/></label>
      <label>SKU column number<input required type="number" min="1" step="1" value={skuColumn} onChange={event=>setSkuColumn(event.target.value)}/></label>
      <label>SKU header<input required value={skuHeader} onChange={event=>setSkuHeader(event.target.value)}/></label>
      <label>Quantity column number<input required type="number" min="1" step="1" value={quantityColumn} onChange={event=>setQuantityColumn(event.target.value)}/></label>
      <label>Quantity header<input required value={quantityHeader} onChange={event=>setQuantityHeader(event.target.value)}/></label>
      <label>Quantity format<select required value={quantityFormat} onChange={event=>setQuantityFormat(event.target.value)}><option value="">Choose format</option><option value="integer_plain">Whole number, no separators</option><option value="integer_grouped">Whole number, comma grouping</option></select></label>
      <label>Physical UOM<input required value={uom} onChange={event=>setUom(event.target.value)} placeholder="Exact SKU unit, e.g. EA"/></label>
      <label>Location source<select required value={locationMode} onChange={event=>setLocationMode(event.target.value)}><option value="">Choose source</option><option value="column">Workbook column</option><option value="constant">One evidenced location</option></select></label>
      {locationMode==='column'&&<><label>Location column number<input required type="number" min="1" step="1" value={locationColumn} onChange={event=>setLocationColumn(event.target.value)}/></label><label>Location header<input required value={locationHeader} onChange={event=>setLocationHeader(event.target.value)}/></label><label className="ci-wide">Approved location value map (optional JSON)<textarea value={locationValueMap} onChange={event=>setLocationValueMap(event.target.value)} placeholder={'{"source code":"Central Inventory code"}'}/></label></>}
      {locationMode==='constant'&&<><label>Central Inventory location code<input required value={locationCode} onChange={event=>setLocationCode(event.target.value)}/></label><label>Location evidence reference<input required value={locationEvidence} onChange={event=>setLocationEvidence(event.target.value)}/></label></>}
      <p className="ci-wide ci-caption">SKU and location text are trimmed only. Counts must be physically verified, in exact SKU units. The mapping and source date must be approved evidence, not guessed from the filename.</p>
      <button className="ci-primary" disabled={busy||!file}>{busy?'Validating…':'Run read-only validation'}</button>
    </form>
    {error&&<p role="alert" className="ci-warning-text">{error}</p>}
    {report&&<div className="ci-preview"><h3>Dry-run result</h3><p>Source SHA-256: <code>{report.fileSha256}</code></p><p>{report.rowsRead} read · {report.rowsValid} valid · {report.rowsInvalid} invalid · {report.rowsDuplicated} duplicated · {report.rowsUnmapped} unmapped · {report.rowsAmbiguous} ambiguous · {report.rowsReadyForApproval} ready for approval · {report.rowsReadyToImport} ready to import</p>
      {report.rejectedRows.length>0&&<><h4>Rejected rows (first 100)</h4><ul role="alert">{report.rejectedRows.map((row,index)=><li key={index}>{row.sheet}, row {row.row}: {row.status} — {row.issues.map(issue=>`${issue.sourceColumn}: ${issue.reason} (${issue.valueReference})`).join('; ')}</li>)}</ul></>}
      <p className="ci-caption">No inventory changed during dry-run. Only a fully valid report can be staged.</p>
      {can('central_inventory.opening_stock.stage')&&<div className="ci-form"><label>Source reference<input required value={sourceReference} onChange={event=>setSourceReference(event.target.value)} placeholder="Owner-approved document reference"/></label><label>Source date<input required type="date" value={sourceDate} onChange={event=>setSourceDate(event.target.value)}/></label><button className="ci-primary" disabled={busy||!file||!sourceReference.trim()||!sourceDate||report.rowsInvalid>0||report.rowsRead===0||report.rowsReadyForApproval!==report.rowsRead} onClick={()=>void stageBatch()}>Stage validated batch</button></div>}
    </div>}
    {!can('central_inventory.opening_stock.stage')&&<p role="status" className="ci-caption">This account has no opening-stock staging permission. A dry run never changes inventory.</p>}
    <section className="ci-preview"><h3>Opening-stock batch</h3><label>Batch ID<input value={batchId} onChange={event=>setBatchId(event.target.value)} placeholder="UUID"/></label><button disabled={busy||!can('central_inventory.opening_stock.read')} onClick={()=>void loadBatch().catch(cause=>setBatchError(errorText(cause)))}>Load batch</button>
      {batchError&&<p role="alert" className="ci-warning-text">{batchError}</p>}
      {batch&&<><p>{batch.batch.status} · source {batch.batch.source_reference} · {batch.batch.rows_valid} rows · {batch.batch.file_sha256}</p><p>Created by {batch.batch.created_by} · Approved by {batch.batch.approved_by||'—'} · Posted by {batch.batch.posted_by||'—'}</p>
        <div className="ci-table-scroll"><table><thead><tr><th>Source row</th><th>SKU</th><th>Location</th><th>Count</th><th>UOM</th><th>Ledger event</th></tr></thead><tbody>{batch.lines.map(line=><tr key={`${line.sheet_name}:${line.source_row}`}><td>{line.sheet_name} · {line.source_row}</td><td>{line.sku}</td><td>{line.location}</td><td>{Number(line.quantity).toLocaleString('en-IN')}</td><td>{line.uom}</td><td>{line.event_id||'Not posted'}</td></tr>)}</tbody></table></div>
        <ol>{batch.audit.map((item,index)=><li key={index}>{item.from_status||'New'} → {item.to_status} by {item.actor} · {new Date(item.created_at).toLocaleString()}</li>)}</ol>
        <div className="ci-toolbar">
          {batch.batch.status==='VALIDATED'&&can('central_inventory.opening_stock.request_approval')&&<button disabled={busy} onClick={()=>void transition('request-approval')}>Request approval</button>}
          {batch.batch.status==='AWAITING_APPROVAL'&&can('central_inventory.opening_stock.approve')&&<button disabled={busy} onClick={()=>void transition('approve')}>Approve batch</button>}
          {batch.batch.status==='APPROVED'&&can('central_inventory.opening_stock.post')&&<button className="ci-primary" disabled={busy} onClick={()=>void transition('post')}>Post approved stock</button>}
        </div>
      </>}
    </section>
  </section>;
}
