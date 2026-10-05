/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useMemo } from 'react';
import {
  Search, X, Plus, Download, HelpCircle, Home, ChevronRight, Pencil,
  ChevronsLeft, ChevronLeft, ChevronsRight,
} from 'lucide-react';
import Shell from '../Shell';
import Modal from '../../components/Modal';
import { Toast } from '../parts';
import { StatusPill as Pill } from '../EnquiryScreen';
import { apiGet, apiSend } from '../../lib/api';
import { useDownload } from '../../context/DownloadContext';
import { parse } from 'csv-parse/browser/esm/sync';

const UOMS = ['Each', 'Pair', 'Set', 'Box', 'Pack'];
const BARCODE_TYPES = ['AJIOBusiness', 'AJIOJIT', 'Default'];
const fmt = (iso: string) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

export default function SkuBarcode() {
  const { requestDownload } = useDownload();
  const [tab, setTab] = useState<'grid' | 'import'>('grid');
  const [rows, setRows] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importBatch, setImportBatch] = useState('');
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20); const [records,setRecords]=useState(0); const [total,setTotal]=useState(0);

  const [filters, setFilters] = useState<any>({ sku_code: '', sku_name: '', sku_barcode: '', uom: 'Each', barcode_type: '', is_active: 'Active', is_default: 'Yes' });
  const [applied, setApplied] = useState(filters);

  const empty = { client:'',sku_code: '', sku_name: '', sku_barcode: '', uom: 'Each', barcode_type: 'Default', is_active: 'Active', is_default: 'Yes', modified_date: new Date().toISOString().slice(0, 10), case_size: 1, sale_price: 0, is_purchasable:'Yes',is_saleable: 'Yes',additional_uom:'',length:'',breath:'',height:'',weight:'',cube:'' };
  const [form, setForm] = useState<any>(empty);

  const load = async(nextPage=page,nextSize=pageSize,filterValues=filters) => { setLoading(true); try{const result:any=await apiSend('/api/skubarcode','POST',{rows:nextSize,page:nextPage,sidx:'skuCode',sord:'desc',client:'-1',skuCode:filterValues.sku_code,skuName:filterValues.sku_name,skuBarcode:filterValues.sku_barcode,uom:filterValues.uom||'-1',barcodeType:filterValues.barcode_type||'-1',isActive:filterValues.is_active||'-1',isDefault:filterValues.is_default||'-1',REQ_SEARCH_FLAG:true});setRows(result.rows||result.gridModel||[]);setRecords(result.records||0);setTotal(result.total||0);setPage(result.page||nextPage)}catch(error:any){setToast({msg:error.message||'Failed to load SKU barcodes',type:'err'})}finally{setLoading(false)}};
  useEffect(()=>{
    void load(1,20,filters);
    apiGet<any[]>('/api/skus').then(setSkus).catch((error:any)=>setToast({msg:error.message||'Failed to load Master SKUs',type:'err'}));
  },[]);

  const filtered = useMemo(() => rows.filter((r) =>
    (!applied.sku_code || r.sku_code.toLowerCase().includes(applied.sku_code.toLowerCase())) &&
    (!applied.sku_name || (r.sku_name || '').toLowerCase().includes(applied.sku_name.toLowerCase())) &&
    (!applied.sku_barcode || (r.sku_barcode || '').toLowerCase().includes(applied.sku_barcode.toLowerCase())) &&
    (!applied.barcode_type || r.barcode_type === applied.barcode_type) &&
    (!applied.is_active || r.is_active === applied.is_active) &&
    (!applied.is_default || r.is_default === applied.is_default)
  ), [rows, applied]);

  const totalPages = Math.max(1,total); const pageRows = filtered;

  const doSearch = () => { setApplied(filters); void load(1,pageSize,filters); };
  const doReset = () => { const c = { sku_code: '', sku_name: '', sku_barcode: '', uom: 'Each', barcode_type: '', is_active: 'Active', is_default: 'Yes' }; setFilters(c); setApplied(c); void load(1,pageSize,c); };

  const openNew = () => { setEdit(null); setForm(empty); setErrors({}); setShow(true); };
  const openEdit = (r: any) => { setEdit(r); setForm({ ...empty, ...r }); setErrors({}); setShow(true); };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.sku_code.trim() || !form.sku_barcode.trim()) e.sku_code = 'Please fill all the mandatory fields';
    if (!form.uom) e.uom = 'UOM is mandatory';
    if (form.sale_price === '' || isNaN(Number(form.sale_price)) || Number(form.sale_price) < 0 || Number(form.sale_price) > 999999999999999) e.sale_price = 'Sale Price cannot Exceed 999999999999999.';
    if (Number(form.case_size) < 1) e.case_size = '.Case Size is mandatory for case pack creation';
    const dup = rows.find((r) => r.sku_barcode?.toLowerCase() === form.sku_barcode.toLowerCase() && (!edit || r.id !== edit.id));
    if (dup) e.sku_barcode = `Barcode "${form.sku_barcode}" already exists`;
    setErrors(e); return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return setToast({ msg: 'Please fix the highlighted fields', type: 'err' });
    setBusy(true);
    try {
      const payload = { ...form, case_size: Number(form.case_size), sale_price: Number(form.sale_price) };
      if (edit) await apiSend('/api/skubarcode', 'PUT', { id: edit.id, ...payload });
      else await apiSend('/api/skubarcode', 'POST', payload);
      setToast({ msg: edit ? 'SKU Barcode updated' : 'SKU Barcode created', type: 'ok' }); setShow(false); await load(1,pageSize,applied);
    } catch { setToast({ msg: 'Save failed', type: 'err' }); } finally { setBusy(false); }
  };

  const downloadTemplate = () => { const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,sku_barcode,sku_code,barcode_type,is_active,is_default,uom,case_size,sale_price,is_purchasable,is_saleable%0A'; a.download='BarCode_Template.csv'; a.click(); };
  const importBarcodes = async () => {
    if (!importFile) return setToast({ msg: 'Upload Template is mandatory', type: 'err' });
    if (!importFile.name.toLowerCase().endsWith('.csv')) return setToast({ msg: 'CSV is required for validated local processing', type: 'err' });
    setBusy(true); const preview:any[]=[];
    try {
      const parsed = parse(await importFile.text(), { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
      if (!parsed.length) throw new Error('CSV contains no barcode rows.');
      if (parsed.length > 1000) throw new Error('Max 1000 rows can be imported in an attempt of Import.');
      if (!parsed.every((row) => Object.hasOwn(row, 'sku_barcode') && Object.hasOwn(row, 'sku_code'))) throw new Error('CSV must contain sku_barcode and sku_code columns.');
      const batch = `BC-${Date.now()}`;
      for (let i=0;i<parsed.length;i++) { const row:any=parsed[i]; const sku=skus.find(x=>x.sku_code?.toLowerCase()===row.sku_code?.toLowerCase()); try { if(!sku)throw new Error('SKU Code does not exist in Master SKU'); await apiSend('/api/skubarcode','POST',{...row,import_batch_no:batch,sku_name:sku.name,uom:row.uom||sku.uom||'Each',sale_price:Number(row.sale_price||sku.mrp||0),is_active:row.is_active||'Active',is_default:row.is_default||'Yes',is_saleable:row.is_saleable||'Yes'}); preview.push({seq:i+1,...row,status:'Success',error:''}); } catch(e:any) { preview.push({seq:i+1,...row,status:'Failed',error:e.message}); } }
      setImportRows(preview); setImportBatch(batch); setToast({msg:`Import completed: ${preview.filter(x=>x.status==='Success').length} successful, ${preview.filter(x=>x.status==='Failed').length} failed`,type:preview.some(x=>x.status==='Failed')?'err':'ok'}); void load(1,pageSize,applied);
    } catch(e:any){setToast({msg:e.message,type:'err'})} finally{setBusy(false)}
  };

  const download = () => requestDownload({
    title: 'SKU Barcode', module: 'sku-barcode', baseName: 'sku-barcode',
    data: { columns: ['SKU Code', 'SKU Name', 'SKU Barcode', 'UOM', 'BarCode Type', 'Is Active', 'Is Default', 'Modified Date', 'Case Size', 'Sale Price', 'Is Saleable'], rows: filtered.map((r) => [r.sku_code, r.sku_name, r.sku_barcode, r.uom, r.barcode_type, r.is_active, r.is_default, fmt(r.modified_date), r.case_size, r.sale_price, r.is_saleable]) },
  });

  const btn = 'flex items-center gap-1.5 rounded px-3.5 py-2 text-sm font-medium transition';
  const hf = 'w-full rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-[#2f9e9e]';

  return (
    <Shell active="master" breadcrumb="MASTER > Sku Management > SKU Bar Code Create/Edit" openScreens={[{ label: 'SKU Barcode', to: '#' }]}>
      {/* Breadcrumb + actions */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm text-slate-500">
          <Home size={14} /> Master <ChevronRight size={13} className="text-slate-300" /> Sku Management <ChevronRight size={13} className="text-slate-300" /> <span className="font-medium text-slate-700">SKU Bar Code Create/Edit</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={doSearch} className={`${btn} bg-[#f5a623] text-white hover:brightness-105`}><Search size={14} /> Search</button>
          <button onClick={doReset} className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}><X size={14} /> Reset</button>
          <button onClick={download} className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}><Download size={14} /> Download</button>
          <button onClick={openNew} className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}><Plus size={14} /> Add New</button>
          <button className="rounded-full p-1 text-[#3b8fc4] hover:bg-slate-100"><HelpCircle size={18} /></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        <button onClick={() => setTab('grid')} className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === 'grid' ? 'border-[#e0574f] text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>SKU BarCode Create/Edit</button>
        <button onClick={() => setTab('import')} className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === 'import' ? 'border-[#e0574f] text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>SKU BarCode Import</button>
      </div>

      {tab === 'import' ? (
        <div className="rounded-b-lg border border-t-0 border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b p-4"><div className="flex items-center gap-8 text-sm"><span>Download Template <button onClick={downloadTemplate} className="font-semibold text-[#2f8eb8] hover:underline">BarCode_Template.csv</button></span><label>Upload Template <input aria-label="Upload Barcode Template" type="file" accept=".csv" onChange={(e)=>setImportFile(e.target.files?.[0]||null)} className="ml-2 border p-1"/></label><label>Import Batch No <input aria-label="Import Batch No" value={importBatch} readOnly className="ml-2 border p-1"/></label></div><div className="flex gap-2"><button onClick={importBarcodes} disabled={busy} className="rounded bg-[#ef9d18] px-4 py-2 text-white">Import</button><button onClick={()=>{setImportFile(null);setImportRows([]);setImportBatch('')}} className="rounded border px-4 py-2">Reset</button></div></div>
          <p className="px-4 py-2 text-sm font-semibold italic">*Note: Max 1000 rows can be imported in an attempt of Import.</p>
          <table className="w-full text-sm"><thead className="bg-slate-100"><tr>{['Seq No','SKU Barcode','SKU Code','BarCode Type','Is Active','Status','Error Description'].map(x=><th key={x} className="border p-2">{x}</th>)}</tr></thead><tbody>{importRows.map(r=><tr key={r.seq} className="border-t text-center"><td>{r.seq}</td><td>{r.sku_barcode}</td><td>{r.sku_code}</td><td>{r.barcode_type}</td><td>{r.is_active}</td><td>{r.status}</td><td>{r.error}</td></tr>)}</tbody></table><div className="h-56 border-t"/>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-b-lg border border-t-0 border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                {['Actions', 'SKU Code', 'SKU Name', 'SKU Barcode', 'UOM', 'BarCode Type', 'Is Active', 'Is Default', 'Modified Date', 'Case Size', 'Sale Price', 'Is Saleable'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 pt-3 pb-1 text-center text-[13px] font-semibold">{h}</th>
                ))}
              </tr>
              <tr className="border-b-2 border-slate-200 bg-slate-50">
                <th className="px-2 pb-2" />
                <th className="px-2 pb-2"><input aria-label="Filter SKU Code" value={filters.sku_code} onChange={(e) => setFilters({ ...filters, sku_code: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && doSearch()} className={hf} /></th>
                <th className="px-2 pb-2"><input aria-label="Filter SKU Name" value={filters.sku_name} onChange={(e) => setFilters({ ...filters, sku_name: e.target.value })} className={hf} /></th>
                <th className="px-2 pb-2"><input aria-label="Filter SKU Barcode" value={filters.sku_barcode} onChange={(e) => setFilters({ ...filters, sku_barcode: e.target.value })} className={hf} /></th>
                <th className="px-2 pb-2"><select aria-label="Filter UOM" value={filters.uom} onChange={(e) => setFilters({ ...filters, uom: e.target.value })} className={hf}>{UOMS.map((u) => <option key={u}>{u}</option>)}</select></th>
                <th className="px-2 pb-2"><select aria-label="Filter Barcode Type" value={filters.barcode_type} onChange={(e) => setFilters({ ...filters, barcode_type: e.target.value })} className={hf}><option value="">--- Select ---</option>{BARCODE_TYPES.map((b) => <option key={b}>{b}</option>)}</select></th>
                <th className="px-2 pb-2"><select aria-label="Filter Is Active" value={filters.is_active} onChange={(e) => setFilters({ ...filters, is_active: e.target.value })} className={hf}><option>Active</option><option>Inactive</option></select></th>
                <th className="px-2 pb-2"><select aria-label="Filter Is Default" value={filters.is_default} onChange={(e) => setFilters({ ...filters, is_default: e.target.value })} className={hf}><option>Yes</option><option>No</option></select></th>
                <th className="px-2 pb-2" />
                <th className="px-2 pb-2" />
                <th className="px-2 pb-2" />
                <th className="px-2 pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-16 text-center text-slate-400"><div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-[#2f9e9e]" /><p className="mt-2 text-xs">Loading…</p></td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-16 text-center text-sm text-slate-400">No records to view</td></tr>
              ) : pageRows.map((r, i) => (
                <tr key={r.id} className={`${i % 2 ? 'bg-slate-50/50' : 'bg-white'} hover:bg-[#eef7fb]`}>
                  <td className="px-3 py-2.5 text-center"><button onClick={() => openEdit(r)} className="flex h-7 w-7 items-center justify-center rounded bg-[#f5a623] text-white hover:brightness-105" title="Edit"><Pencil size={13} /></button></td>
                  <td className="px-3 py-2.5"><button onClick={() => openEdit(r)} className="font-medium text-[#2f7fb6] hover:underline">{r.sku_code}</button></td>
                  <td className="px-3 py-2.5 text-slate-700">{r.sku_name}</td>
                  <td className="px-3 py-2.5 text-center text-slate-700">{r.sku_barcode}</td>
                  <td className="px-3 py-2.5 text-center text-slate-700">{r.uom}</td>
                  <td className="px-3 py-2.5 text-center text-slate-700">{r.barcode_type}</td>
                  <td className="px-3 py-2.5 text-center"><Pill active={r.is_active === 'Active'} /></td>
                  <td className="px-3 py-2.5 text-center text-slate-700">{r.is_default}</td>
                  <td className="px-3 py-2.5 text-center text-slate-600">{fmt(r.modified_date)}</td>
                  <td className="px-3 py-2.5 text-center text-slate-700">{r.case_size}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-slate-700">{Number(r.sale_price).toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-center text-slate-700">{r.is_saleable}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600">
            <div className="flex items-center gap-1">
              <Pg onClick={() => load(1,pageSize,applied)} disabled={page === 1}><ChevronsLeft size={15} /></Pg>
              <Pg onClick={() => load(Math.max(1,page-1),pageSize,applied)} disabled={page === 1}><ChevronLeft size={15} /></Pg>
              <span className="mx-2 flex items-center gap-1">Page <input aria-label="Current Page" value={filtered.length ? page : 0} onChange={(e) => setPage(Math.min(totalPages, Math.max(1, Number(e.target.value) || 1)))} className="w-12 rounded border border-slate-300 px-2 py-1 text-center" /> of {filtered.length ? totalPages : 0}</span>
              <Pg onClick={() => load(Math.min(totalPages,page+1),pageSize,applied)} disabled={page >= totalPages}><ChevronRight size={15} /></Pg>
              <Pg onClick={() => load(totalPages,pageSize,applied)} disabled={page >= totalPages}><ChevronsRight size={15} /></Pg>
              <select aria-label="Records per Page" value={pageSize} onChange={(e) => { const n=Number(e.target.value);setPageSize(n);void load(1,n,applied); }} className="ml-2 rounded border border-slate-300 px-2 py-1">{[20, 50, 100,200].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </div>
            <span>{records ? `View ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, records)} of ${records}` : 'No records to view'}</span>
          </div>
        </div>
      )}

      <Modal title={edit ? 'Edit SKU Barcode' : 'Add New SKU Barcode'} open={show} onClose={() => setShow(false)} wide>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">SKU Code<span className="text-rose-500"> *</span></label>
            <input aria-label="SKU Code" list="master-sku-codes" value={form.sku_code} onChange={(e) => { const sku=skus.find(x=>x.sku_code===e.target.value); setForm({ ...form, sku_code:e.target.value, sku_name:sku?.name||form.sku_name, uom:sku?.uom||form.uom, sale_price:sku?.mrp??form.sale_price }); }} className={`inp ${errors.sku_code ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} /><datalist id="master-sku-codes">{skus.map(s=><option key={s.id} value={s.sku_code}>{s.name}</option>)}</datalist>
            {errors.sku_code && <p className="mt-0.5 text-xs text-rose-500">{errors.sku_code}</p>}</div>
          <div><label className="lbl">SKU Name</label><input aria-label="SKU Name" value={form.sku_name} onChange={(e) => setForm({ ...form, sku_name: e.target.value })} className="inp" /></div>
          <div><label className="lbl">SKU Barcode<span className="text-rose-500"> *</span></label>
            <input aria-label="SKU Barcode" value={form.sku_barcode} onChange={(e) => setForm({ ...form, sku_barcode: e.target.value })} className={`inp ${errors.sku_barcode ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} />
            {errors.sku_barcode && <p className="mt-0.5 text-xs text-rose-500">{errors.sku_barcode}</p>}</div>
          <div><label className="lbl">UOM</label><select aria-label="UOM" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} className="inp">{UOMS.map((u) => <option key={u}>{u}</option>)}</select></div>
          <div><label className="lbl">BarCode Type</label><select aria-label="BarCode Type" value={form.barcode_type} onChange={(e) => setForm({ ...form, barcode_type: e.target.value })} className="inp">{BARCODE_TYPES.map((b) => <option key={b}>{b}</option>)}</select></div>
          <div><label className="lbl">Case Size</label>
            <input aria-label="Case Size" type="number" min={1} value={form.case_size} onChange={(e) => setForm({ ...form, case_size: e.target.value })} className={`inp ${errors.case_size ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} />
            {errors.case_size && <p className="mt-0.5 text-xs text-rose-500">{errors.case_size}</p>}</div>
          <div><label className="lbl">Sale Price (₹)</label>
            <input aria-label="Sale Price" type="number" min={0} value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} className={`inp ${errors.sale_price ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} />
            {errors.sale_price && <p className="mt-0.5 text-xs text-rose-500">{errors.sale_price}</p>}</div>
          <div><label className="lbl">Is Active</label><select aria-label="Is Active" value={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.value })} className="inp"><option>Active</option><option>Inactive</option></select></div>
          <div><label className="lbl">Is Default</label><select aria-label="Is Default" value={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.value })} className="inp"><option>Yes</option><option>No</option></select></div>
          <div><label className="lbl">Is Saleable</label><select aria-label="Is Saleable" value={form.is_saleable} onChange={(e) => setForm({ ...form, is_saleable: e.target.value })} className="inp"><option>Yes</option><option>No</option></select></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setShow(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-md bg-[#2f9e9e] px-4 py-2 text-sm font-medium text-white hover:brightness-105 disabled:opacity-50">{busy ? 'Saving…' : edit ? 'Update' : 'Save'}</button>
        </div>
      </Modal>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </Shell>
  );
}

function Pg({ children, onClick, disabled }: { children: any; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40">{children}</button>;
}
