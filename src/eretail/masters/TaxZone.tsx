import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RotateCcw, Save, Search, X } from 'lucide-react';
import Shell from '../Shell';
import Modal from '../../components/Modal';
import { Toast } from '../parts';
import { apiGet, apiSend } from '../../lib/api';

const countries = ['AFGHANISTAN', 'ALBANIA', 'ALGERIA El Djazair', 'INDIA', 'UNITED ARAB EMIRATES', 'UNITED KINGDOM', 'UNITED STATES'];
const states = ['Maharashtra', 'Uttar Pradesh', 'Assam', 'Kerala', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Andaman Nicobar'];
const pageSizes = [20, 50, 100, 200];
type TaxZone = { id: number; code: string; name: string; description: string; country: string; status: 'Active' | 'Inactive'; states: string[]; no_of_states?: number; udf1?: string; udf2?: string; udf3?: string };
type TaxZoneForm = Omit<TaxZone, 'id'>;
type TaxZoneFilters = { code: string; name: string; status: string };
const blank: TaxZoneForm = { code: '0', name: '', description: '', country: 'INDIA', status: 'Active', states: [], udf1: '', udf2: '', udf3: '' };

export default function TaxZone() {
  const [rows, setRows] = useState<TaxZone[]>([]);
  const [filters, setFilters] = useState<TaxZoneFilters>({ code: '', name: '', status: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<TaxZoneForm>(blank);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const load = async (nextFilters = filters) => {
    setLoading(true);
    try {
      const query = new URLSearchParams(Object.entries(nextFilters).filter(([, value]) => value));
      const data = await apiGet<TaxZone[]>(`/api/tax-zones${query.size ? `?${query}` : ''}`);
      setRows(data);
      setPage(1);
      setFilters(nextFilters);
    } catch (error: any) {
      setRows([]);
      setNotice({ msg: error.message || 'Unable to load Tax Zones', type: 'err' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load({ code: '', name: '', status: '' }); }, []);

  const openNew = () => { setEditId(null); setForm({ ...blank, states: [] }); setShow(true); };
  const openEdit = (zone: TaxZone) => {
    setEditId(zone.id);
    setForm({ code: zone.code, name: zone.name, description: zone.description || '', country: zone.country, status: zone.status, states: [...zone.states], udf1: zone.udf1 || '', udf2: zone.udf2 || '', udf3: zone.udf3 || '' });
    setShow(true);
  };
  const save = async () => {
    if (!form.name.trim()) return setNotice({ msg: 'Please Enter Tax Zone Name', type: 'err' });
    if (!form.country.trim()) return setNotice({ msg: 'Please Select Country', type: 'err' });
    if (!form.states.length) return setNotice({ msg: 'Please Select State', type: 'err' });
    setBusy(true);
    try {
      const payload = { ...form, ...(editId ? { id: editId } : { code: '' }) };
      await apiSend('/api/tax-zones', editId ? 'PUT' : 'POST', payload);
      setNotice({ msg: editId ? 'Tax Zone updated successfully' : 'Tax Zone created successfully', type: 'ok' });
      setShow(false);
      setEditId(null);
      setForm({ ...blank, states: [] });
      await load(filters);
    } catch (error: any) {
      setNotice({ msg: error.message || 'Unable to save Tax Zone', type: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const pageCount = Math.ceil(rows.length / pageSize);
  const visibleRows = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);
  const cls = 'w-full border border-slate-300 px-2 py-1.5 text-xs';

  return <Shell active="master" breadcrumb="MASTER > Tax Management > Tax Zone" openScreens={[{ label: 'Tax Zone', to: '#' }]}>
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <h1 className="text-base font-semibold text-slate-700">Tax Zone Enquiry</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load(filters)} className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-4 py-2 text-sm"><Search size={13} />Search</button>
          <button type="button" onClick={() => { const cleared = { code: '', name: '', status: '' }; setFilters(cleared); void load(cleared); }} className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-4 py-2 text-sm"><RotateCcw size={13} />Reset</button>
          <button type="button" onClick={openNew} className="inline-flex items-center gap-1.5 rounded bg-[#f5a623] px-4 py-2 text-sm text-white"><Plus size={13} />Add New</button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="lbl">Tax Zone Code<input aria-label="Tax Zone Code filter" className="inp mt-1" value={filters.code} onChange={(event) => setFilters((current) => ({ ...current, code: event.target.value }))} /></label>
        <label className="lbl">Tax Zone Name<input aria-label="Tax Zone Name filter" className="inp mt-1" value={filters.name} onChange={(event) => setFilters((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="lbl">Status<select aria-label="Tax Zone Status filter" className="inp mt-1" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">All</option><option>Active</option><option>Inactive</option></select></label>
      </div>

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600"><tr>{['Tax Zone', 'Tax Zone Name', 'Tax Zone Description', 'Country', 'States', 'Status', 'Actions'].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
          <tbody>{loading ? <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-400">Loading…</td></tr> : visibleRows.length ? visibleRows.map((zone) => <tr key={zone.id} className="border-t border-slate-100"><td className="px-3 py-2">{zone.code}</td><td className="px-3 py-2">{zone.name}</td><td className="px-3 py-2">{zone.description || '—'}</td><td className="px-3 py-2">{zone.country}</td><td className="px-3 py-2" title={zone.states.join(', ')}>{zone.no_of_states}: {zone.states.join(', ')}</td><td className="px-3 py-2">{zone.status}</td><td className="px-3 py-2"><button type="button" aria-label={`Edit Tax Zone ${zone.code}`} title="Edit" onClick={() => openEdit(zone)} className="rounded bg-[#f5a623] p-1.5 text-white"><Pencil size={14} /></button></td></tr>) : <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-400">No Tax Zones found.</td></tr>}</tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm text-slate-600"><div className="flex items-center gap-2"><span>Records per Page</span><select aria-label="Records per Page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded border px-2 py-1">{pageSizes.map((size) => <option key={size}>{size}</option>)}</select></div><div className="flex items-center gap-2"><span>Page {rows.length ? page : 0} of {pageCount}</span><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Previous</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button></div></div>
      </div>
    </section>

    <Modal title="Tax Zone Create/Edit" open={show} onClose={() => setShow(false)} wide>
      <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Tax Zone" value={form.code === '0' ? '' : form.code} readOnly />
        <Field label="Tax Zone Name *" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
        <Field label="Tax Zone Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
        <label className="lbl">Country *<select aria-label="Country" className={cls} value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))}><option value="">--- Select ---</option>{countries.map((country) => <option key={country}>{country}</option>)}</select></label>
        <label className="lbl">State *<select aria-label="State" multiple size={5} className={cls} value={form.states} onChange={(event) => { const selectedStates = Array.from(event.currentTarget.selectedOptions, (option) => option.value); setForm((current) => ({ ...current, states: selectedStates })); }}>{states.map((state) => <option key={state}>{state}</option>)}</select><span className="text-[11px] text-slate-500">Use Ctrl or Command to select multiple states.</span></label>
        <label className="flex items-center gap-2 pt-5 text-xs"><input aria-label="Is Active" type="checkbox" checked={form.status === 'Active'} onChange={(event) => setForm((current) => ({ ...current, status: event.target.checked ? 'Active' : 'Inactive' }))} />Is Active</label>
        {[1, 2, 3].map((index) => <Field key={index} label={`UDF ${index}`} value={String(form[`udf${index}` as 'udf1' | 'udf2' | 'udf3'] || '')} onChange={(value) => setForm((current) => ({ ...current, [`udf${index}`]: value }))} />)}
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t pt-3"><button type="button" disabled={busy} onClick={() => { setShow(false); setEditId(null); }} className="inline-flex items-center gap-1 rounded border px-4 py-2 text-sm"><X size={13} />Close</button><button type="button" disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1 rounded bg-[#f5a623] px-4 py-2 text-sm text-white disabled:opacity-50"><Save size={13} />{busy ? 'Saving…' : editId ? 'Update' : 'Save'}</button></div>
    </Modal>
    {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
  </Shell>;
}

function Field({ label, value, onChange, readOnly = false }: { label: string; value: string; onChange?: (value: string) => void; readOnly?: boolean }) {
  const id = `tax-zone-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return <label htmlFor={id} className="lbl">{label}<input id={id} readOnly={readOnly} className={`inp mt-1 ${readOnly ? 'bg-slate-100' : ''}`} value={value} onChange={(event) => onChange?.(event.target.value)} /></label>;
}
