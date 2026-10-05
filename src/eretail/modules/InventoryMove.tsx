/* eslint-disable @typescript-eslint/no-explicit-any -- Inventory rows carry configurable lottable fields. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDownload } from '../../context/DownloadContext';
import { apiGet, apiSend } from '../../lib/api';
import Modal from '../../components/Modal';
import Shell from '../Shell';
import { Btn, Toast } from '../parts';

const initial = { skuCode: '', SKUDesc: '', zone: '-1', fromBin: '', fromId: '',
  lottable1: '', lottable2: '', lottable3: '', lottable4: '', lottable5: '', lottable6: '', toBin: '', sameQty: true };
const heads = [['skuCode', 'Sku'], ['zone', 'Zone'], ['fromBin', 'From Bin'], ['toBin', 'To Bin'],
  ['allocatedQty', 'Allocated Qty'], ['fromQty', 'From Qty'], ['toQty', 'To Qty'], ['fromLPN', 'From LPN'],
  ['toLPN', 'To LPN'], ['lot', 'Lot'], ...[1, 2, 3, 4, 5, 6].map(index => [`lottable${index}`, `Lottable 0${index}`]),
  ['isUnique', 'isUnique'], ['remarks', 'Remarks'], ['reason', 'Reason']];
const importColumns = ['skuCode', 'fromBin', 'toBin', 'toQty', 'reason'];

export default function InventoryMove() {
  const navigate = useNavigate();
  const { requestDownload } = useDownload();
  const [meta, setMeta] = useState<any>({ zones: [['-1', '--- Select ---']], reasons: [['-1', '--- Select ---']], products: [], bins: [] });
  const [filters, setFilters] = useState<any>(initial);
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [tab, setTab] = useState<'move' | 'import'>('move');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [records, setRecords] = useState(0);
  const [picker, setPicker] = useState<'sku' | 'from' | 'to' | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importResults, setImportResults] = useState<any[]>([]);
  const [reasonName, setReasonName] = useState('');
  const [toast, setToast] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    void apiGet('/api/inventory-move').then(setMeta)
      .catch((error: Error) => setToast({ msg: error.message, type: 'err' }));
  }, []);
  const set = (key: string, value: any) => setFilters((previous: any) => ({ ...previous, [key]: value }));

  async function search(nextPage = page, nextSize = size) {
    setLoading(true);
    try {
      const result = await apiSend<any>('/api/inventory-move', 'POST', { action: 'search', REQ_SEARCH_FLAG: true,
        rows: nextSize, page: nextPage, sidx: 'skuCode', sord: 'asc', ...filters });
      setRows(result.rows); setPage(result.page); setSize(nextSize); setRecords(result.records); setSelected([]);
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Inventory search failed', type: 'err' });
    } finally { setLoading(false); }
  }

  function apply() {
    if (filters.toBin && filters.toBin.toLowerCase() === filters.fromBin.toLowerCase())
      return setToast({ msg: 'TO BIN and TO ID both cannot be same as FROM BIN and FROM ID', type: 'err' });
    setRows(previous => previous.map(row => selected.includes(row.id) ? {
      ...row, toBin: filters.toBin || row.toBin, toQty: filters.sameQty ? row.fromQty : row.toQty,
    } : row));
  }

  async function execute() {
    try {
      const result = await apiSend<any>('/api/inventory-move', 'POST', { action: 'execute', rows: rows.filter(row => selected.includes(row.id)) });
      setToast({ msg: result.jsonMessage, type: 'ok' });
      await search(1);
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Inventory move failed', type: 'err' });
    }
  }

  async function doImport() {
    if (!file) return setToast({ msg: 'No file chosen to import.', type: 'err' });
    const content = await file.text();
    const [header, ...lines] = content.split(/\r?\n/).filter(Boolean);
    if (header?.split(',').map(value => value.trim()).join(',') !== importColumns.join(','))
      return setToast({ msg: 'Use the Inventory Move template columns.', type: 'err' });
    const data = lines.map(line => {
      const [skuCode, fromBin, toBin, toQty, reason] = line.split(',');
      return { skuCode: skuCode?.trim(), fromBin: fromBin?.trim(), toBin: toBin?.trim(), toQty: Number(toQty), reason: reason?.trim() };
    });
    try {
      const result = await apiSend<any>('/api/inventory-move', 'POST', { action: 'import', rows: data });
      setImportResults(result.rows);
      setToast({ msg: result.jsonMessage, type: result.failedItems ? 'err' : 'ok' });
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Inventory import failed', type: 'err' });
    }
  }

  function downloadTemplate() {
    requestDownload({ title: 'Inventory Move Import Template', module: 'inventory-move',
      baseName: 'inventory-move-template', formats: ['csv'], data: { columns: importColumns, rows: [] } });
  }

  async function addReason() {
    try {
      const result = await apiSend<any>('/api/inventory-move', 'POST', { action: 'create-reason', name: reasonName });
      setMeta((previous: any) => ({ ...previous, reasons: [...previous.reasons, [result.code, result.name]] }));
      setReasonName('');
      setToast({ msg: 'Inventory move reason added.', type: 'ok' });
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Unable to add reason', type: 'err' });
    }
  }

  function reset() { setFilters(initial); setRows([]); setSelected([]); setRecords(0); setPage(1); setFile(null); setImportResults([]); }
  const pages = Math.ceil(records / size);
  return <Shell active="wms" breadcrumb="WMS > Inventory > Inventory Move" openScreens={[{ label: 'Inventory Move', to: '#' }]}>
    <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Bin-level moves are paused because Central Inventory does not currently store the bin, lot, or LPN balances this workflow needs. The API rejects search, execute, and import until those mappings are connected.</div><div className="mb-3 flex gap-2">{tab === 'move' ? <><Btn disabled onClick={() => void execute()}>Execute Move</Btn><Btn variant="warn" disabled onClick={() => void search(1)}>Search</Btn><Btn variant="ghost" onClick={reset}>Reset</Btn></>
      : <><Btn variant="warn" disabled onClick={() => void doImport()}>Import</Btn><Btn variant="ghost" onClick={reset}>Reset</Btn></>}</div>
    <div className="rounded border bg-white"><div className="flex border-b text-sm">
      <button className={`px-4 py-2 ${tab === 'move' ? 'border-b-2 border-sky-600' : ''}`} onClick={() => setTab('move')}>Inventory Move</button>
      <button className={`px-4 py-2 ${tab === 'import' ? 'border-b-2 border-sky-600' : ''}`} onClick={() => setTab('import')}>Inventory Move Import</button>
    </div>
      {tab === 'import' ? <div className="p-5"><div className="grid gap-4 md:grid-cols-2">
        <label className="text-xs">Upload Template<input aria-label="Upload Template" type="file" accept=".csv" className="inp mt-1" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
        <button className="text-left text-sm text-sky-700 underline" onClick={downloadTemplate}>Download Template</button>
        <p className="text-xs text-slate-500">Maximum 200 rows per import. Import is paused until bin and LPN balances are connected to Central Inventory.</p>
      </div>{importResults.length > 0 && <table className="mt-4 w-full text-xs"><thead><tr>{['Row', 'SKU', 'From Bin', 'To Bin', 'Quantity', 'Status', 'Error'].map(label => <th className="border p-2 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{importResults.map(result => <tr key={result.seqNo}><td className="border p-2">{result.seqNo}</td><td className="border p-2">{result.skuCode}</td><td className="border p-2">{result.fromBin}</td><td className="border p-2">{result.toBin}</td><td className="border p-2">{result.toQty}</td><td className="border p-2">{result.status}</td><td className="border p-2">{result.error}</td></tr>)}</tbody></table>}</div>
      : <><section className="border-b p-4"><h2 className="mb-3 font-semibold">Search Criteria</h2>
        <div className="grid items-end gap-3 md:grid-cols-4">
          <Pick label="SKU Code" value={filters.skuCode} set={value => set('skuCode', value)} open={() => setPicker('sku')} />
          <Input label="SKU Desc" value={filters.SKUDesc} set={value => set('SKUDesc', value)} />
          <label className="text-xs">Zone<select aria-label="Zone" className="inp mt-1" value={filters.zone} onChange={event => set('zone', event.target.value)}>{(meta.zones || []).map(([code, name]: [string, string]) => <option key={code} value={code}>{code}{name && code !== '-1' ? ` - ${name}` : ''}</option>)}</select></label>
          <Pick label="From Bin" value={filters.fromBin} set={value => set('fromBin', value)} open={() => setPicker('from')} />
          <Input label="From LPN" value={filters.fromId} set={value => set('fromId', value)} />
          {[1, 2, 3, 4, 5, 6].map(index => <Input key={index} label={`Lottable 0${index}`} value={filters[`lottable${index}`]} set={value => set(`lottable${index}`, value)} />)}
        </div><div className="mt-4 flex items-end gap-4"><label className="flex items-center gap-2 text-xs"><input aria-label="From Qty Same As To Qty" type="checkbox" checked={filters.sameQty} onChange={event => set('sameQty', event.target.checked)} />From Qty Same As To Qty</label>
          <Pick label="To Bin" value={filters.toBin} set={value => set('toBin', value)} open={() => setPicker('to')} /><Btn onClick={apply}>Apply</Btn></div>
        <div className="mt-4 flex items-end gap-2"><label className="text-xs">New inventory move reason<input aria-label="New inventory move reason" className="inp mt-1" value={reasonName} onChange={event => setReasonName(event.target.value)} /></label><Btn variant="ghost" onClick={() => void addReason()}>Add Reason</Btn></div>
      </section><section><h2 className="p-4 font-semibold">Search Results</h2><div className="overflow-auto"><table className="min-w-[1900px] text-xs"><thead className="bg-slate-100"><tr><th className="p-2"><input aria-label="Select all rows" type="checkbox" checked={!!rows.length && selected.length === rows.length} onChange={event => setSelected(event.target.checked ? rows.map(row => row.id) : [])} /></th>{heads.map(([, label]) => <th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead>
        <tbody>{loading ? <tr><td colSpan={20} className="p-10 text-center">Loading...</td></tr> : rows.length ? rows.map(row => <tr className="border-t" key={row.id}><td className="p-2"><input aria-label={`Select ${row.skuCode}`} type="checkbox" checked={selected.includes(row.id)} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} /></td>
          {heads.map(([key]) => <td className="p-1" key={key}>{['toBin', 'toQty', 'toLPN', 'remarks'].includes(key) ? <input aria-label={`${heads.find(([name]) => name === key)?.[1]} ${row.skuCode}`} className="w-24 border p-1" value={row[key] ?? ''} onChange={event => setRows(previous => previous.map(item => item.id === row.id ? { ...item, [key]: key === 'toQty' ? Number(event.target.value) : event.target.value } : item))} />
            : key === 'reason' ? <select aria-label={`Reason ${row.skuCode}`} value={row.reason} onChange={event => setRows(previous => previous.map(item => item.id === row.id ? { ...item, reason: event.target.value } : item))}>{(meta.reasons || []).map(([code, name]: [string, string]) => <option value={code} key={code}>{name}</option>)}</select> : String(row[key] ?? '')}</td>)}</tr>)
          : <tr><td colSpan={20} className="p-10 text-center text-slate-400">No inventory to move. <button className="text-sky-700 underline" onClick={() => navigate('/app/inventory')}>View inventory</button></td></tr>}</tbody></table></div>
        <div className="flex items-center justify-end gap-3 border-t p-3 text-xs"><button disabled={page <= 1} onClick={() => void search(page - 1)}>Previous</button><span>Page {records ? page : 0} of {pages}</span><button disabled={page >= pages} onClick={() => void search(page + 1)}>Next</button><select aria-label="Page size" value={size} onChange={event => void search(1, Number(event.target.value))}>{[20, 50, 100, 200].map(value => <option key={value}>{value}</option>)}</select></div>
      </section></>}
    </div>
    <Modal title={`${picker === 'sku' ? 'SKU' : 'Bin'} Picker`} open={!!picker} onClose={() => setPicker(null)}>{picker === 'sku' ? (meta.products || []).map((product: any) => <button key={product.id} className="block w-full border-b p-3 text-left" onClick={() => { set('skuCode', product.code); set('SKUDesc', product.name); setPicker(null); }}><b>{product.code}</b> — {product.name}</button>) : (meta.bins || []).map((bin: string) => <button key={bin} className="block w-full border-b p-3 text-left" onClick={() => { set(picker === 'from' ? 'fromBin' : 'toBin', bin); setPicker(null); }}>{bin}</button>)}</Modal>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}

function Input({ label, value, set }: { label: string; value: string; set: (value: string) => void }) {
  return <label className="text-xs">{label}<input aria-label={label} className="inp mt-1" value={value || ''} onChange={event => set(event.target.value)} /></label>;
}
function Pick({ label, value, set, open }: { label: string; value: string; set: (value: string) => void; open: () => void }) {
  return <label className="text-xs">{label}<div className="mt-1 flex"><input aria-label={label} className="inp rounded-r-none" value={value} onChange={event => set(event.target.value)} /><button aria-label={`Open ${label} picker`} className="rounded-r border px-3" onClick={open}>...</button></div></label>;
}
