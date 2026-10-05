import { useEffect, useRef, useState } from 'react';
import { Download, Search, Upload } from 'lucide-react';
import { parse } from 'csv-parse/browser/esm/sync';
import Modal from '../../components/Modal';
import { apiGet, apiSend } from '../../lib/api';
import Shell from '../Shell';
import { Btn, Toast } from '../parts';

type ToastState = { msg: string; type: 'ok' | 'err' } | null;
type Filters = { skuName: string; locCode: string; channelSkuCode: string; channelProductId: string };
const blankFilters: Filters = { skuName: '', locCode: '', channelSkuCode: '', channelProductId: '' };
const columns = ['Image', 'SKU Name', 'Channel', 'Seller SKU', 'ERetail Sku', 'Product ID', 'Pricing', 'Other Info', 'Action'];
const inputClass = 'h-7 w-full min-w-24 rounded border border-slate-300 bg-white px-2 text-xs';

export default function SkuModeration() {
  const [tab, setTab] = useState<'Enquiry/Create' | 'Import'>('Enquiry/Create');
  const [mode, setMode] = useState<'0' | '1'>('0');
  const [filters, setFilters] = useState<Filters>(blankFilters), [rows, setRows] = useState<any[]>([]);
  const [pager, setPager] = useState({ page: 1, total: 0, records: 0, pageSize: 50 });
  const [channels, setChannels] = useState<{ value: string; label: string }[]>([]), [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any>(null), [query, setQuery] = useState(''), [candidates, setCandidates] = useState<any[]>([]), [candidate, setCandidate] = useState<any>(null);
  const [toast, setToast] = useState<ToastState>(null), [file, setFile] = useState<File | null>(null), [fileKey, setFileKey] = useState(0), [importing, setImporting] = useState(false);
  const [batch, setBatch] = useState(''), [importRows, setImportRows] = useState<any[]>([]), [importSummary, setImportSummary] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void apiGet<any>('/api/sku-moderation?meta=1').then((data) => setChannels(data.channels)); }, []);

  const search = async (nextPage = 1, nextSize = pager.pageSize, nextMode = mode, nextFilters = filters, requestFlag: boolean | string = true) => {
    setLoading(true);
    try {
      const result: any = await apiSend('/api/sku-moderation', 'POST', { rows: nextSize, page: nextPage, sidx: '', sord: 'desc', linkedUnlinkedFlag: nextMode, REQ_SEARCH_FLAG: requestFlag, doFetchCount: true, ...nextFilters });
      setRows(result.rows); setPager({ page: result.page, total: result.total, records: result.records, pageSize: nextSize });
    } catch (error: any) { setToast({ msg: error.message, type: 'err' }); } finally { setLoading(false); }
  };
  const switchMode = (value: '0' | '1') => { setMode(value); void search(1, pager.pageSize, value); };
  const reset = () => { setFilters(blankFilters); void search(1, pager.pageSize, mode, blankFilters, 'false'); };
  const fetchCandidates = async (value: string) => {
    setQuery(value); setCandidate(null);
    if (value.trim().length <= 2) return setCandidates([]);
    try { setCandidates(await apiGet(`/api/sku-moderation?q=${encodeURIComponent(value.trim())}`)); } catch (error: any) { setToast({ msg: error.message, type: 'err' }); }
  };
  const closeLink = () => { setSelected(null); setQuery(''); setCandidates([]); setCandidate(null); };
  const link = async () => {
    if (!candidate) return setToast({ msg: 'Search SKU to link.', type: 'err' });
    try {
      const result: any = await apiSend('/api/sku-moderation', 'PUT', { id: selected.id, linkedSkuCode: candidate.sku_code, chnlSkuCode: selected.channelSkuCode, channelProductId: selected.channelProductId, channelPrice: selected.channelPrice, mrp: selected.mrp, chnlCode: selected.channelCode, actionCode: 0 });
      setToast({ msg: result.message, type: 'ok' }); closeLink(); await search();
    } catch (error: any) { setToast({ msg: error.message, type: 'err' }); }
  };
  const exportRows = async () => {
    if (!rows.length) return setToast({ msg: 'No Data in Grid', type: 'err' });
    const ExcelJS = (await import('exceljs')).default, workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('SKU Moderation');
    sheet.addRow(['SKU Name', 'Channel', 'Seller SKU', 'ERetail Sku', 'Product ID', 'Price', 'MRP', 'Size', 'Color']);
    rows.forEach((row) => sheet.addRow([row.skuName, row.locCode, row.channelSkuCode, row.eRetailSku, row.channelProductId, row.channelPrice, row.mrp, row.size, row.color]));
    const buffer = await workbook.xlsx.writeBuffer(), url = URL.createObjectURL(new Blob([buffer])); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'SKU_Moderation.xlsx'; anchor.click(); URL.revokeObjectURL(url);
  };
  const parseFile = async (upload: File) => {
    if (upload.name.toLowerCase().endsWith('.csv')) return parse(await upload.text(), { columns: true, skip_empty_lines: true, bom: true, trim: true }) as Record<string, string>[];
    const ExcelJS = (await import('exceljs')).default, workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await upload.arrayBuffer()); const sheet = workbook.worksheets[0], keys = (sheet.getRow(1).values as any[]).slice(1).map((x) => String(x ?? '').trim()), parsed: any[] = [];
    for (let index = 2; index <= sheet.rowCount; index++) { const values = (sheet.getRow(index).values as any[]).slice(1); if (values.some((x) => String(x ?? '').trim())) parsed.push(Object.fromEntries(keys.map((key, position) => [key, String(values[position] ?? '').trim()]))); } return parsed;
  };
  const runImport = async () => {
    if (importing) return;
    if (!file) { setToast({ msg: 'No file chosen to import.', type: 'err' }); fileRef.current?.focus(); return; }
    setImporting(true);
    try { const parsed = await parseFile(file); if (!parsed.length) throw new Error('Import file contains no rows.'); const result: any = await apiSend('/api/sku-moderation', 'POST', { action: 'import', fileName: file.name, rows: parsed }); setBatch(result.batchIdImport); setImportRows(result.importDTO.dtoList); setImportSummary(`Total Delivery Import:${result.importDTO.totalItems} Successful:${result.importDTO.successItems} Failed:${result.importDTO.failedItems} In Process:${result.importDTO.inProcessItems}`); }
    catch (error: any) { setToast({ msg: error.message, type: 'err' }); }
    finally { setImporting(false); }
  };
  const resetImport = () => { setFile(null); setFileKey((key) => key + 1); setBatch(''); setImportRows([]); setImportSummary(''); };
  const exportErrors = () => { const failed = importRows.filter((row) => row.remarks); if (!batch || !failed.length) return; const csv = [['Seller SKU', 'Product ID', 'Channel', 'Error Description'], ...failed.map((row) => [row.channelSkuCode, row.channelProductId, row.locCode, row.remarks])].map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n'); const url = URL.createObjectURL(new Blob([csv])); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${batch}-errors.csv`; anchor.click(); URL.revokeObjectURL(url); };

  return <Shell active="sales" breadcrumb="SALES > Sku Moderation" openScreens={[{ label: 'SKU Moderation', to: '#' }]}>
    <div className="border bg-white">
      <div className="flex border-b">{(['Enquiry/Create', 'Import'] as const).map((name) => <button key={name} onClick={() => setTab(name)} className={`px-4 py-2 text-sm ${tab === name ? 'border-b-2 border-red-500 font-semibold' : ''}`}>{name}</button>)}</div>
      {tab === 'Enquiry/Create' ? <>
        <div className="flex items-center justify-between p-3"><div className="flex gap-5 text-sm"><label><input type="radio" name="moderation-mode" checked={mode === '0'} onChange={() => switchMode('0')} /> Unlinked</label><label><input type="radio" name="moderation-mode" checked={mode === '1'} onChange={() => switchMode('1')} /> Linked</label></div><div className="flex gap-2"><Btn variant="warn" onClick={() => void search()}>Search</Btn><Btn variant="ghost" onClick={reset}>Reset</Btn><Btn variant="ghost" onClick={() => void exportRows()}><Download size={15} />Export</Btn></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-xs"><thead className="bg-slate-100"><tr>{columns.map((name) => <th key={name} className="border p-2 text-left">{name}</th>)}</tr><tr><th className="border p-1"/><th className="border p-1"><input aria-label="SKU Name" className={inputClass} value={filters.skuName} onChange={(e) => setFilters({ ...filters, skuName: e.target.value })}/></th><th className="border p-1"><select aria-label="Channel" className={inputClass} value={filters.locCode} onChange={(e) => setFilters({ ...filters, locCode: e.target.value })}><option value="">--- Select ---</option>{channels.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></th><th className="border p-1"><input aria-label="Seller SKU" className={inputClass} value={filters.channelSkuCode} onChange={(e) => setFilters({ ...filters, channelSkuCode: e.target.value })}/></th><th className="border p-1"/><th className="border p-1"><input aria-label="Product ID" className={inputClass} value={filters.channelProductId} onChange={(e) => setFilters({ ...filters, channelProductId: e.target.value })}/></th>{[0,1,2].map((x) => <th key={x} className="border p-1"/>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t align-top"><td className="p-2"><img src={row.image} className="h-14 max-w-16 object-contain" /></td><td className="p-2">{row.skuName}</td><td className="p-2">{row.locCode}{row.channelImage && <img src={row.channelImage} className="mt-1 h-10 w-12 object-contain" />}</td><td className="p-2">{row.channelSkuCode}</td><td className="p-2">{row.eRetailSku}</td><td className="p-2">{row.channelProductId}</td><td className="p-2"><b>Price -</b> {row.channelPrice}<br/><b>MRP -</b> {row.mrp}</td><td className="p-2">{row.size && <><b>Size -</b> {row.size}<br/></>}{row.color && <><b>Color -</b> {row.color}</>}</td><td className="p-2">{mode === '0' ? <button title="Link" className="rounded bg-sky-600 px-2 py-1 text-white" onClick={() => setSelected(row)}>⊕ | Link</button> : ['Linked', 'Deleted', 'Created New', 'Auto Linked'][row.actionCode] || 'Auto Linked'}</td></tr>)}</tbody></table>{!rows.length && <div className="h-52 border-t p-4 text-center text-sm text-slate-500">{loading ? 'Loading…' : 'No records to view'}</div>}</div>
        <div className="flex items-center justify-end gap-2 border-t p-2 text-xs"><button disabled={pager.page <= 1} onClick={() => void search(pager.page - 1)}>‹</button><span>Page {pager.page} of {pager.total}</span><button disabled={pager.page >= pager.total} onClick={() => void search(pager.page + 1)}>›</button><select aria-label="Page size" value={pager.pageSize} onChange={(e) => void search(1, Number(e.target.value))}>{[50,100,200].map((size) => <option key={size}>{size}</option>)}</select><span>{pager.records ? `View 1 - ${Math.min(pager.pageSize, pager.records)} of ${pager.records}` : 'No records to view'}</span></div>
      </> : <>
        <div className="flex flex-wrap items-center gap-5 p-4 text-sm"><label>Import Batch No <input aria-label="Import Batch No" value={batch} readOnly className="ml-2 rounded border px-2 py-1" /></label><a href="/api/sku-moderation?template=1" className="text-sky-700 underline">Download Template</a><label>Upload Template <input key={fileKey} ref={fileRef} aria-label="Upload Template" type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="ml-2" /></label><Btn variant="warn" disabled={importing} onClick={() => void runImport()}><Upload size={15}/>{importing?'Importing…':'Import'}</Btn><Btn variant="ghost" disabled={importing} onClick={resetImport}>Reset</Btn><Btn variant="ghost" disabled={!batch || !importRows.some((row) => row.remarks)} onClick={exportErrors}>Export</Btn></div>
        <p className="px-4 pb-3 text-xs font-semibold">**Note: Max 5000 lines are allowed at a time.</p>{importSummary && <p className="mx-4 mb-2 bg-emerald-100 p-2 text-sm">{importSummary}</p>}
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-100"><tr>{['Seq No','SKU Code','Channel SKU Code','Product ID','Channel','Error Description'].map((name) => <th key={name} className="border p-2 text-left">{name}</th>)}</tr></thead><tbody>{importRows.map((row) => <tr key={row.sq} className={row.remarks ? 'bg-rose-50' : 'bg-emerald-50'}><td className="border p-2">{row.sq}</td><td className="border p-2">{row.skuCode}</td><td className="border p-2">{row.channelSkuCode}</td><td className="border p-2">{row.channelProductId}</td><td className="border p-2">{row.locCode}</td><td className="border p-2">{row.remarks}</td></tr>)}</tbody></table><div className="h-52 border-t" /></div>
      </>}
    </div>
    <Modal title="Product Link" open={!!selected} onClose={closeLink} wide><div className="grid grid-cols-[80px_1fr_120px] items-start gap-4"><img src={selected?.image} className="h-16 w-16 border object-contain"/><div><b>{selected?.channelSkuCode}</b><p>{selected?.skuName}</p></div><div className="text-center">{selected?.locCode}{selected?.channelImage && <img src={selected.channelImage} className="mx-auto h-10 w-12 object-contain"/>}</div></div><label className="mt-6 block text-sm">Search Item to link<div className="relative mt-1"><input aria-label="Search Item to link" placeholder="Select Item SKU..." className="inp" value={query} onChange={(e) => void fetchCandidates(e.target.value)}/><Search size={16} className="absolute right-2 top-2 text-slate-400"/></div></label><div className="h-36 overflow-auto border-x border-b">{candidates.map((row) => <button key={row.id} className="block w-full px-3 py-1 text-left text-sm hover:bg-slate-100" onClick={() => { setCandidate(row); setQuery(''); setCandidates([]); }}>{row.description}<b> ({row.sku_code})</b></button>)}</div>{candidate && <div className="mt-4 flex items-center gap-3"><img src={candidate.image} className="h-16 w-16 object-contain"/><div><b>{candidate.sku_code}</b><p>{candidate.description}</p></div></div>}<div className="mt-5 flex justify-end gap-2"><Btn variant="ghost" onClick={() => void link()}>Link Now</Btn><Btn variant="ghost" onClick={closeLink}>Cancel</Btn></div></Modal>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}
