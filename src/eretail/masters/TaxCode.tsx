import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import Shell from '../Shell';
import Modal from '../../components/Modal';
import { Toast } from '../parts';
import EnquiryScreen, { ECol, StatusPill } from '../EnquiryScreen';
import { apiGet, apiSend } from '../../lib/api';

const TYPES = ['GST', 'CESS', 'VAT', 'OTHERS'];
const fmt = (iso: string) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

export default function TaxCode() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [records, setRecords] = useState(0), [total, setTotal] = useState(0), [lastFilters, setLastFilters] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [view, setView] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const empty = { tax_code: '', tax_code_type: '', tax_nature: '', start_date: '', percentage: '', description: '', is_active: 'Active' };
  const [form, setForm] = useState<any>(empty);

  const search = async (filters: Record<string, string> = lastFilters, nextPage = 1, nextSize = pageSize) => { setLoading(true); try { const result: any = await apiSend('/api/taxcodes', 'POST', { REQ_SEARCH_FLAG: true, rows: nextSize, page: nextPage, sidx: 'taxCode', sord: 'desc', extTaxCode: filters.tax_code || '', taxCodeType: '', taxCodeValue: filters.tax_code_type || '', displayStartDate: filters.start_date || '', percentage: filters.percentage || '', description: filters.description || '', isActive: '', displayIsActive: filters.is_active || '', createdDate: '', updatedBy: '', taxNature: '', updatedDate: '' }); setRows(result.gridModel || result.rows || []); setPage(result.page || nextPage); setPageSize(nextSize); setRecords(result.records || 0); setTotal(result.total || 0); setLastFilters(filters); } catch (error: any) { setRows([]); setToast({ msg: error.message || 'Failed to load tax codes', type: 'err' }); } finally { setLoading(false); } };
  const load = () => search(lastFilters, page, pageSize);
  useEffect(() => { void search({}, 1, 20); }, []);

  const openNew = () => { setEdit(null); setForm(empty); setErrors({}); setShow(true); };
  const openEdit = (r: any) => {
    if (['VINCCNA', 'VINSCNA'].includes(String(r.tax_code).toUpperCase())) {
      setToast({ msg: 'VINCCNA/VINSCNA are system defined taxes and cannot be changed.', type: 'err' });
      return;
    }
    setEdit(r); setForm({ ...empty, ...r }); setErrors({}); setShow(true);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.tax_code.trim()) e.tax_code = 'Please Enter Tax Code';
    else if (!/^[a-z0-9]+$/i.test(form.tax_code)) e.tax_code = 'Please Enter Only AlphaNumerics';
    else if (form.tax_code.length > 50) e.tax_code = 'Tax Code cannot exceed 50 characters';
    if (!form.tax_code_type) e.tax_code_type = 'Please Select Tax Code Type';
    if (!form.tax_nature) e.tax_nature = 'Please Select Tax Nature';
    const date = String(form.start_date || '');
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) e.start_date = 'Please Select a valid Start Date';
    if (String(form.description || '').length > 500) e.description = 'Description cannot exceed 500 characters';
    if (form.percentage === '') e.percentage = 'Please Enter Percentage';
    else if (isNaN(Number(form.percentage)) || Number(form.percentage) < 0 || Number(form.percentage) > 100) e.percentage = 'Please Enter Valid Percentage';
    const dup = rows.find((r) => r.tax_code?.toLowerCase() === form.tax_code.toLowerCase() && (!edit || r.id !== edit.id));
    if (dup) e.tax_code = `Tax Code "${form.tax_code}" already exists`;
    setErrors(e); return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return setToast({ msg: 'Please fix the highlighted fields', type: 'err' });
    setBusy(true);
    try {
      const payload = { ...form, percentage: Number(form.percentage) };
      if (edit) await apiSend('/api/taxcodes', 'PUT', { id: edit.id, ...payload });
      else await apiSend('/api/taxcodes', 'POST', payload);
      setToast({ msg: edit ? 'Tax Code updated successfully' : 'Tax Code created successfully', type: 'ok' }); setShow(false); await search({}, 1, pageSize);
    } catch (e: any) { setToast({ msg: e.message || 'Save failed', type: 'err' }); } finally { setBusy(false); }
  };

  const cols: ECol[] = [
    { key: 'tax_code', label: 'Tax Code', filter: 'text', sortable: true, align: 'left', render: (r) => <button onClick={() => setView(r)} className="font-semibold text-[#2f7fb6] hover:underline">{r.tax_code}</button> },
    { key: 'tax_code_type', label: 'Tax Code Type', filter: 'select', options: TYPES },
    { key: 'start_date', label: 'Start Date', filter: 'text', render: (r) => fmt(r.start_date) },
    { key: 'percentage', label: 'Percentage', filter: 'text' },
    { key: 'description', label: 'Description', filter: 'text', align: 'left' },
    { key: 'is_active', label: 'Is Active', filter: 'select', options: ['Active', 'Inactive'], render: (r) => <StatusPill active={r.is_active === 'Active'} /> },
  ];

  return (
    <Shell active="master" breadcrumb="MASTER > Tax Management > Tax Code" openScreens={[{ label: 'Tax Code', to: '#' }]}>
      <EnquiryScreen
        breadcrumb={[{ label: 'Master' }, { label: 'Tax Management' }, { label: 'Tax Code' }]}
        cols={cols} rows={rows} loading={loading}
        actions={[{ label: 'Add New', icon: Plus, onClick: openNew }]}
        onRowEdit={openEdit}
        onSearch={(filters, nextPage, nextSize) => void search(filters, nextPage, nextSize)}
        onReset={() => void search({}, 1, pageSize)}
        remote={{ page, pageSize, records, total }}
      />

      <Modal title={edit ? 'Edit Tax Code' : 'Add New Tax Code'} open={show} onClose={() => setShow(false)}>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Tax Code<span className="text-rose-500"> *</span></label>
            <input aria-label="Tax Code" maxLength={50} value={form.tax_code} onChange={(e) => setForm({ ...form, tax_code: e.target.value })} className={`inp ${errors.tax_code ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} />
            {errors.tax_code && <p className="mt-0.5 text-xs text-rose-500">{errors.tax_code}</p>}</div>
          <div><label className="lbl">Tax Code Type<span className="text-rose-500"> *</span></label>
            <select aria-label="Tax Code Type" value={form.tax_code_type} onChange={(e) => setForm({ ...form, tax_code_type: e.target.value })} className="inp"><option value="">--- Select ---</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>{errors.tax_code_type && <p className="mt-0.5 text-xs text-rose-500">{errors.tax_code_type}</p>}</div>
          <div><label className="lbl">Tax Nature<span className="text-rose-500"> *</span></label><select aria-label="Tax Nature" value={form.tax_nature} onChange={(e) => setForm({ ...form, tax_nature: e.target.value })} className="inp"><option value="">--- Select ---</option><option>Central Cess</option><option>State Cess</option></select>{errors.tax_nature && <p className="mt-0.5 text-xs text-rose-500">{errors.tax_nature}</p>}</div>
          <div><label className="lbl">Start Date<span className="text-rose-500"> *</span></label>
            <input aria-label="Start Date" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={`inp ${errors.start_date ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} />
            {errors.start_date && <p className="mt-0.5 text-xs text-rose-500">{errors.start_date}</p>}</div>
          <div><label className="lbl">Percentage (%)<span className="text-rose-500"> *</span></label>
            <input aria-label="Percentage (%)" type="number" min="0" max="100" step="0.01" value={form.percentage} onChange={(e) => setForm({ ...form, percentage: e.target.value })} className={`inp ${errors.percentage ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} />
            {errors.percentage && <p className="mt-0.5 text-xs text-rose-500">{errors.percentage}</p>}</div>
          <div className="col-span-2"><label className="lbl">Description</label>
            <textarea aria-label="Description" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="inp" rows={2} />{errors.description && <p className="mt-0.5 text-xs text-rose-500">{errors.description}</p>}</div>
          <div><label className="lbl">Is Active</label><select aria-label="Is Active" value={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.value })} className="inp"><option>Active</option><option>Inactive</option></select></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setShow(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-md bg-[#2f9e9e] px-4 py-2 text-sm font-medium text-white hover:brightness-105 disabled:opacity-50">{busy ? 'Saving…' : edit ? 'Update' : 'Save'}</button>
        </div>
      </Modal>

      <Modal title={`Tax Code — ${view?.tax_code || ''}`} open={!!view} onClose={() => setView(null)}>
        {view && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[['Tax Code', view.tax_code], ['Type', view.tax_code_type], ['Start Date', fmt(view.start_date)], ['Percentage', view.percentage + '%'], ['Description', view.description || '—'], ['Is Active', view.is_active]].map(([l, v]) => (
              <div key={l as string}><p className="text-xs text-slate-400">{l}</p><p className="font-medium text-slate-700">{v}</p></div>
            ))}
          </div>
        )}
      </Modal>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </Shell>
  );
}
