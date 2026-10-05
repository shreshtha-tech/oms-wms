import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import Shell from '../Shell';
import { apiGet, apiSend } from '../../lib/api';
import { Toast } from '../parts';

const headings = ['', 'SKU Code', 'Display SKU', 'SKU Desc', 'MFG SKU Code', 'Brand', 'Status'];
const filters = ['View', 'Add', 'Remove'];

type SkuRow = {
  id: number;
  sku_code: string;
  display_sku: string;
  sku_desc: string;
  mfg_sku_code: string;
  brand: string;
  status: string;
};

export default function SkuCompanyLink() {
  const [meta, setMeta] = useState<any>({ companies: [], locations: [] });
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [skuCode, setSkuCode] = useState('');
  const [skuName, setSkuName] = useState('');
  const [mode, setMode] = useState('View');
  const [available, setAvailable] = useState<SkuRow[]>([]);
  const [linked, setLinked] = useState<SkuRow[]>([]);
  const [left, setLeft] = useState<string[]>([]);
  const [right, setRight] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<any>(null);
  const searchRevision = useRef(0);

  useEffect(() => {
    let mounted = true;
    apiGet('/api/sku-company-links')
      .then((result) => { if (mounted) setMeta(result); })
      .catch((error) => { if (mounted) setToast({ msg: error.message || 'Company and Location references could not be loaded.', type: 'err' }); });
    return () => { mounted = false; };
  }, []);

  const search = async () => {
    const revision = ++searchRevision.current;
    setLeft([]);
    setRight([]);
    if (!company || !location) {
      setAvailable([]);
      setLinked([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result: any = await apiSend('/api/sku-company-links', 'POST', {
        action: 'search', company, location, skuCode, skuName,
      });
      if (revision !== searchRevision.current) return;
      setAvailable(Array.isArray(result.available) ? result.available : []);
      setLinked(Array.isArray(result.linked) ? result.linked : []);
    } catch (error: any) {
      if (revision !== searchRevision.current) return;
      setAvailable([]);
      setLinked([]);
      setToast({ msg: error.message || 'SKU Company Link search failed.', type: 'err' });
    } finally {
      if (revision === searchRevision.current) setLoading(false);
    }
  };

  useEffect(() => {
    void search();
    return () => { searchRevision.current += 1; };
  }, [company, location, skuCode, skuName]);

  const move = async (action: 'add' | 'remove', codes: string[]) => {
    if (!codes.length || saving) return;
    setSaving(true);
    try {
      const result: any = await apiSend('/api/sku-company-links', 'POST', {
        action, company, location, skuCodes: codes,
      });
      setLeft([]);
      setRight([]);
      const changed = Number(action === 'add' ? result.added : result.removed) || 0;
      const noun = changed === 1 ? 'SKU link' : 'SKU links';
      setToast({
        msg: changed ? `${changed} ${noun} ${action === 'add' ? 'added' : 'removed'}.` : 'No SKU links changed.',
        type: 'ok',
      });
      await search();
    } catch (error: any) {
      setToast({ msg: error.message || 'SKU Company Link update failed.', type: 'err' });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    searchRevision.current += 1;
    setCompany('');
    setLocation('');
    setSkuCode('');
    setSkuName('');
    setMode('View');
    setAvailable([]);
    setLinked([]);
    setLeft([]);
    setRight([]);
    setLoading(false);
  };

  return (
    <Shell active="master" breadcrumb="MASTER > Sku Management > SKU Company Link" openScreens={[{ label: 'SKU Company Link', to: '#' }]}>
      <div className="mb-2 flex justify-end">
        <button onClick={reset} className="flex items-center gap-1 rounded border px-4 py-2 text-sm">
          <RotateCcw size={14} />Reset
        </button>
      </div>
      <section className="grid gap-3 border bg-white p-4 md:grid-cols-4">
        <label className="text-sm">Company
          <select aria-label="Company" className="inp mt-1" value={company} onChange={(event) => setCompany(event.target.value)}>
            <option value="">--- Select ---</option>
            {meta.companies.map((row: any) => <option key={row.id} value={row.code}>{row.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Location
          <select aria-label="Location" className="inp mt-1" value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="">--- Select ---</option>
            {meta.locations.map((row: any) => <option key={row.id} value={row.location_code || row.code}>{row.location_name || row.name}</option>)}
          </select>
        </label>
        <label className="text-sm">SKU Code
          <input aria-label="SKU Code" className="inp mt-1" value={skuCode} onChange={(event) => setSkuCode(event.target.value)} />
        </label>
        <label className="text-sm">SKU Name
          <input aria-label="SKU Name" className="inp mt-1" value={skuName} onChange={(event) => setSkuName(event.target.value)} />
        </label>
        <div className="col-span-full flex gap-6">
          {filters.map((value) => (
            <label key={value} className="flex gap-2 text-sm">
              <input aria-label={value} type="radio" name="operationMode" checked={mode === value} onChange={() => setMode(value)} />
              {value}
            </label>
          ))}
        </div>
      </section>
      <div className="mt-2 min-h-5 text-sm" role="status" aria-live="polite">
        {loading ? 'Loading SKU links…' : saving ? 'Saving SKU links…' : ''}
      </div>
      <div className="mt-1 grid items-center gap-3 lg:grid-cols-[1fr_48px_1fr]">
        <Grid title="Non Range Products" rows={available.slice(0, pageSize)} selected={left} setSelected={setLeft} pageSize={pageSize} setPageSize={setPageSize} />
        <div className="grid gap-2">
          {mode === 'Add' && <button type="button" title="Add selected" aria-label="Add selected" disabled={!left.length || loading || saving} onClick={() => void move('add', left)} className="rounded bg-[#2f9e9e] p-3 text-white disabled:cursor-not-allowed disabled:opacity-50"><ChevronRight /></button>}
          {mode === 'Remove' && <button type="button" title="Remove selected" aria-label="Remove selected" disabled={!right.length || loading || saving} onClick={() => void move('remove', right)} className="rounded bg-rose-600 p-3 text-white disabled:cursor-not-allowed disabled:opacity-50"><ChevronLeft /></button>}
        </div>
        <Grid title="Range Products" rows={linked.slice(0, pageSize)} selected={right} setSelected={setRight} pageSize={pageSize} setPageSize={setPageSize} />
      </div>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </Shell>
  );
}

function Grid({ title, rows, selected, setSelected, pageSize, setPageSize }: any) {
  const toggle = (code: string) => setSelected((current: string[]) => current.includes(code)
    ? current.filter((value) => value !== code)
    : [...current, code]);
  const visibleCodes = rows.map((row: SkuRow) => row.sku_code);
  const allSelected = visibleCodes.length > 0 && visibleCodes.every((code: string) => selected.includes(code));

  return (
    <section className="overflow-x-auto border bg-white">
      <h2 className="border-b bg-slate-50 p-2 text-sm font-semibold">{title}</h2>
      <table className="min-w-full text-xs">
        <thead><tr>{headings.map((heading, index) => (
          <th key={index} className="p-2">
            {heading || <input aria-label={`Select all ${title}`} type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : visibleCodes)} />}
          </th>
        ))}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row: SkuRow) => (
            <tr key={row.id} className="border-t text-center">
              <td><input aria-label={`Select ${row.sku_code}`} type="checkbox" checked={selected.includes(row.sku_code)} onChange={() => toggle(row.sku_code)} /></td>
              <td>{row.sku_code}</td><td>{row.display_sku}</td><td>{row.sku_desc}</td><td>{row.mfg_sku_code}</td><td>{row.brand}</td><td>{row.status}</td>
            </tr>
          )) : <tr><td colSpan={7} className="p-12 text-center text-slate-400">No records to view</td></tr>}
        </tbody>
      </table>
      <div className="flex justify-between border-t p-2 text-xs">
        <span>Page of {rows.length ? 1 : 0}</span>
        <select aria-label={`${title} records per page`} value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
          {[20, 50, 100, 200].map((size) => <option key={size}>{size}</option>)}
        </select>
        <span>{rows.length ? `View 1 - ${rows.length} of ${rows.length}` : 'No records to view'}</span>
      </div>
    </section>
  );
}
