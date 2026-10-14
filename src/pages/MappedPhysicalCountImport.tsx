import { useEffect, useState, type ChangeEvent } from 'react';
import { apiSend } from '../lib/api';

type Location = { id:string; code:string };
type HeaderCandidate = { column:number; label:string; kind:string };
type SheetInspection = { name:string; state:string; rowCount:number; populatedRows:number; firstRowLabels:{column:number;label:string}[]; candidateHeaderRows:{row:number;columns:HeaderCandidate[]}[] };
type Inspection = { sha256:string; sheets:SheetInspection[] };
type Preview = { id:string|null; summary:{rows:number;newSkus:number;stockChanges:number;packListings:number;errors:number}; rows:{sku:string;location:string;stock:number|null;previousOnHand:number|null}[]; errors:{sheet:string;row:number;message:string}[] };
type Props = { file:File|null; locations:Location[]; permissions:string[] };

const encode=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read workbook'));reader.readAsDataURL(file);});
const message=(error:unknown)=>error instanceof Error?error.message:'Physical-count import failed';

export default function MappedPhysicalCountImport({file,locations,permissions}:Props){
  const [inspection,setInspection]=useState<Inspection|null>(null),[preview,setPreview]=useState<Preview|null>(null);
  const [sheet,setSheet]=useState(''),[headerRow,setHeaderRow]=useState(''),[skuColumn,setSkuColumn]=useState(''),[skuHeader,setSkuHeader]=useState('');
  const [quantityColumn,setQuantityColumn]=useState(''),[quantityHeader,setQuantityHeader]=useState(''),[quantityFormat,setQuantityFormat]=useState<'integer_plain'|'integer_grouped'>('integer_plain');
  const [locationColumn,setLocationColumn]=useState(''),[locationHeader,setLocationHeader]=useState(''),[defaultLocation,setDefaultLocation]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const canCommit=permissions.includes('central_inventory.stock_count.write');

  useEffect(()=>{setInspection(null);setPreview(null);setError('');setNotice('');setSheet('');setHeaderRow('');setSkuColumn('');setSkuHeader('');setQuantityColumn('');setQuantityHeader('');setLocationColumn('');setLocationHeader('');},[file]);

  function edit(setter:(value:string)=>void){return(event:ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>{setter(event.target.value);setPreview(null);setNotice('');};}

  async function inspect(){
    if(!file)throw new Error('Choose an Excel workbook first');
    if(file.size>7*1024*1024)throw new Error('Workbook must be at most 7 MB');
    const result=await apiSend<Inspection>('/api/inventory-sync/central/imports/inspect','POST',{fileName:file.name,base64:await encode(file)});
    setInspection(result);setPreview(null);setSheet(result.sheets.find(item=>item.state==='visible')?.name||'');
  }

  function applyCandidate(sheetName:string,row:number,columns:HeaderCandidate[]){
    setSheet(sheetName);setHeaderRow(String(row));
    const sku=columns.find(item=>item.kind==='sku'),quantity=columns.find(item=>item.kind==='quantity'),location=columns.find(item=>item.kind==='location');
    if(sku){setSkuColumn(String(sku.column));setSkuHeader(sku.label);}
    if(quantity){setQuantityColumn(String(quantity.column));setQuantityHeader(quantity.label);}
    if(location){setLocationColumn(String(location.column));setLocationHeader(location.label);}
    setPreview(null);setNotice('');
  }

  async function previewMapped(){
    if(!file||!inspection)throw new Error('Inspect the selected workbook first');
    if(!sheet.trim()||!headerRow||!skuColumn||!skuHeader.trim()||!quantityColumn||!quantityHeader.trim())throw new Error('Enter the exact worksheet, header row, SKU column and quantity column');
    if(Boolean(locationColumn.trim())!==Boolean(locationHeader.trim()))throw new Error('Enter both location column and header, or leave both blank and choose a default warehouse/store');
    if(!locationColumn.trim()&&!defaultLocation)throw new Error('Choose a default warehouse/store when the workbook has no location column');
    setBusy(true);setError('');setNotice('');setPreview(null);
    try{
      if(file.size>7*1024*1024)throw new Error('Workbook must be at most 7 MB');
      const mapping={sheet:sheet.trim(),headerRow:Number(headerRow),sku:{column:Number(skuColumn),header:skuHeader.trim()},quantity:{column:Number(quantityColumn),header:quantityHeader.trim(),format:quantityFormat},...(locationColumn.trim()?{location:{column:Number(locationColumn),header:locationHeader.trim()}}:{})};
      const result=await apiSend<Preview>('/api/inventory-sync/central/imports/preview','POST',{fileName:file.name,base64:await encode(file),mode:'counts',locationId:defaultLocation||undefined,mapping});
      setPreview(result);
    }catch(cause){setError(message(cause));}finally{setBusy(false);}
  }

  async function commit(){
    if(!preview?.id||!canCommit)return;
    setBusy(true);setError('');setNotice('');
    try{
      const result=await apiSend<{stockEvents:number}>('/api/inventory-sync/central/imports/'+encodeURIComponent(preview.id)+'/commit','POST',{});
      setNotice(`Count import committed: ${result.stockEvents} SKU/location rows written to the Central Inventory ledger.`);setPreview(null);window.dispatchEvent(new Event('inventory-live-changed'));
    }catch(cause){setError(message(cause));}finally{setBusy(false);}
  }

  return <section className="ci-card" data-mapped-count-import>
    <h2>Map a source workbook to exact SKU counts</h2>
    <p className="ci-caption">Use this when the source sheet is not named “Physical counts”. Inspection is read-only. Select and verify the exact sheet, header row and columns; the preview resolves each SKU exactly and updates only an existing SKU/location balance. No pack conversion is applied. Up to 50,000 rows and 7 MB are supported.</p>
    {!file&&<p role="status">Choose the source workbook in the Upload Excel panel above.</p>}
    {file&&<><p>Selected file: <strong>{file.name}</strong> · {(file.size/1024/1024).toFixed(2)} MB</p>
      <button type="button" disabled={busy} onClick={()=>{setBusy(true);setError('');void inspect().catch(cause=>setError(message(cause))).finally(()=>setBusy(false));}}>Inspect workbook structure</button>
      {inspection&&<div className="ci-preview"><p>Read-only inspection · SHA-256 <code>{inspection.sha256}</code></p>{inspection.sheets.map((item,index)=><div key={`${item.name}:${index}`}><h3>{item.name} ({item.state})</h3><p>{item.rowCount} rows · {item.populatedRows} populated</p><p>First-row labels: {item.firstRowLabels.map(value=>`${value.column}: ${value.label||'(blank)'}`).join(' · ')||'None'}</p>{item.candidateHeaderRows.map(candidate=><div key={candidate.row}><p>Possible header row {candidate.row}: {candidate.columns.map(value=>`${value.column}: ${value.label} (${value.kind})`).join(' · ')}</p><button type="button" disabled={busy||item.state!=='visible'} onClick={()=>applyCandidate(item.name,candidate.row,candidate.columns)}>Use this candidate; review fields</button></div>)}</div>)}<p className="ci-caption">Candidate labels are structural hints. Confirm them against the source workbook before previewing; inspection does not show data-row values or change stock.</p></div>}
      {inspection&&<div className="ci-form"><label>Worksheet<select value={sheet} onChange={edit(setSheet)} required><option value="">Choose worksheet</option>{inspection.sheets.map((item,index)=><option key={`${item.name}:${index}`} value={item.name} disabled={item.state!=='visible'}>{item.name} ({item.state})</option>)}</select></label><label>Header row<input type="number" min="1" max="100" step="1" value={headerRow} onChange={edit(setHeaderRow)}/></label><label>SKU column number<input type="number" min="1" step="1" value={skuColumn} onChange={edit(setSkuColumn)}/></label><label>Exact SKU header<input value={skuHeader} onChange={edit(setSkuHeader)} placeholder="For example: Seller SKU ID"/></label><label>Quantity column number<input type="number" min="1" step="1" value={quantityColumn} onChange={edit(setQuantityColumn)}/></label><label>Exact quantity header<input value={quantityHeader} onChange={edit(setQuantityHeader)} placeholder="For example: Stock"/></label><label>Quantity format<select value={quantityFormat} onChange={event=>{setQuantityFormat(event.target.value as 'integer_plain'|'integer_grouped');setPreview(null);}}><option value="integer_plain">Whole number (1234)</option><option value="integer_grouped">Comma-grouped whole number (1,234)</option></select></label><label>Location column number (optional)<input type="number" min="1" step="1" value={locationColumn} onChange={edit(setLocationColumn)} placeholder="Leave blank for one location"/></label><label>Exact location header (optional)<input value={locationHeader} onChange={edit(setLocationHeader)} placeholder="For example: Location"/></label>{!locationColumn&&<label>Default warehouse / store<select value={defaultLocation} onChange={edit(setDefaultLocation)}><option value="">Choose location</option>{locations.map(item=><option key={item.id} value={item.id}>{item.code}</option>)}</select></label>}<p className="ci-wide ci-caption">SKU cells must be text so leading zeros and exact identifiers are preserved. Quantities must be nonnegative whole units for that exact SKU. A missing balance must use the separate approved opening-stock workflow.</p><button type="button" className="ci-primary" disabled={busy||!file} onClick={()=>void previewMapped()}>{busy?'Validating…':'Preview mapped counts'}</button></div>}
    </>}
    {error&&<p role="alert" className="ci-warning-text">{error}</p>}{notice&&<p role="status" className="ci-message">{notice}</p>}
    {preview&&<div className="ci-preview"><h3>Mapped count preview</h3><p>{preview.summary.rows} rows · {preview.summary.stockChanges} stock changes · {preview.summary.errors} errors. The match is exact SKU plus location.</p>{preview.errors.length>0&&<ul role="alert">{preview.errors.map((item,index)=><li key={`${item.sheet}:${item.row}:${index}`}>{item.sheet}, row {item.row}: {item.message}</li>)}</ul>}<div className="ci-table-scroll"><table><thead><tr><th>SKU</th><th>Location</th><th>Previous on hand</th><th>New on hand</th></tr></thead><tbody>{preview.rows.map((row,index)=><tr key={`${row.sku}:${row.location}:${index}`}><td>{row.sku}</td><td>{row.location||'—'}</td><td>{row.previousOnHand===null?'Not counted':Number(row.previousOnHand).toLocaleString('en-IN')}</td><td>{row.stock===null?'—':Number(row.stock).toLocaleString('en-IN')}</td></tr>)}</tbody></table></div><p className="ci-caption">First 100 rows shown. Preview does not change stock and expires after 30 minutes.</p>{!canCommit&&<p role="status">This account does not have physical-count write permission.</p>}<button type="button" className="ci-primary" disabled={busy||!canCommit||!preview.id||preview.summary.errors>0} onClick={()=>void commit()}>{busy?'Committing…':'Commit verified SKU counts'}</button></div>}
  </section>;
}
