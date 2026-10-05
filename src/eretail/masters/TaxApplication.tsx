import { useEffect, useState } from 'react';
import { Plus, Download, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Shell from '../Shell';
import Modal from '../../components/Modal';
import { Toast } from '../parts';
import EnquiryScreen, { ECol } from '../EnquiryScreen';
import { apiGet, apiSend } from '../../lib/api';
import { useDownload } from '../../context/DownloadContext';

const TAX_TYPES = ['Purchase', 'Sales'];
const DIRECTIONS = ['ALL', 'IN', 'OUT', 'With In'];
const fmt = (iso: string) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const mrp = (n: number) => Number(n || 0).toFixed(2);

export default function TaxApplication() {
  const navigate = useNavigate();
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [taxGroups, setTaxGroups] = useState<any[]>([]);
  const [taxZones, setTaxZones] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageModel, setPageModel] = useState({ page: 1, total: 0, records: 0, pageSize: 20 });
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [view, setView] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const empty = { tax_category: '', tax_type: '', tax_group_code: '', goods_direction: '', tax_authority: '', tax_zone: '', start_date: '', is_active: 'Active', is_form_c_tax: false, is_form_h_tax: false, from_mrp: '', to_mrp: '' };
  const [form, setForm] = useState<any>(empty);

  const search = async (filters: Record<string, string> = appliedFilters, page = 1, pageSize = pageModel.pageSize) => {
    setLoading(true);
    try {
      const result: any = await apiSend('/api/taxapp', 'POST', { _search: true, rows: pageSize, page, sidx: 'taxCategory', sord: 'desc', taxGroupCode: filters.tax_group_code || '-1', taxZone: filters.tax_zone || '-1', taxCategory: filters.tax_category || '-1', startDate: filters.start_date || '', taxType: filters.tax_type || '-1', goodsDirection: filters.goods_direction || '-1', taxAuthority: filters.tax_authority || '', IsFormCTax: filters.is_form_c_tax || '-1', IsFormHTax: filters.is_form_h_tax || '-1', isActive: filters.is_active || '-1', operationFlag: 'save', REQ_SEARCH_FLAG: true });
      setRows(result.rows || result.gridModel || []); setPageModel({ page: result.page || page, total: result.total || 0, records: result.records || 0, pageSize }); setAppliedFilters(filters);
    } catch { setRows([]); setPageModel({ page: 1, total: 0, records: 0, pageSize }); setToast({ msg: 'Failed to load tax applications', type: 'err' }); } finally { setLoading(false); }
  };
  const load = () => { setLoading(true); Promise.all([apiGet('/api/tax-categories'), apiGet('/api/tax-groups'), apiGet('/api/tax-zones')]).then(([taxCategories, groups, zones]) => { setCategories(taxCategories); setTaxGroups(groups); setTaxZones(zones); return search({}, 1, 20); }).catch(() => setToast({ msg: 'Failed to load tax applications', type: 'err' })); };
  useEffect(load, []);

  const catOptions = [...new Set([...rows.map((r) => r.tax_category), ...categories.map((r) => r.code)])].filter(Boolean);
  const groupOptions = [...new Set([...rows.map((r) => r.tax_group_code), ...taxGroups.map((r) => r.code)])].filter(Boolean);
  const zoneOptions = [...new Set([...rows.map((r) => r.tax_zone), ...taxZones.map((r) => r.code)])].filter(Boolean);

  const openNew = () => { setEdit(null); setForm(empty); setErrors({}); setShow(true); };
  const openEdit = (r: any) => { setEdit(r); setForm({ ...empty, ...r }); setErrors({}); setShow(true); };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.tax_category.trim()) e.tax_category = 'Tax Category is required';
    if (!form.tax_group_code.trim()) e.tax_group_code = 'Tax Group Code is required';
    if (!form.tax_zone.trim()) e.tax_zone = 'Please Select Tax Zone';
    if (!TAX_TYPES.includes(form.tax_type)) e.tax_type = 'Please Select Tax Type';
    if (!DIRECTIONS.includes(form.goods_direction)) e.goods_direction = 'Please Select Goods Direction';
    const date = String(form.start_date || '');
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) e.start_date = 'Please Select a valid Start Date';
    if (form.from_mrp === '' || !Number.isFinite(Number(form.from_mrp)) || Number(form.from_mrp) < 0) e.from_mrp = 'Please Enter a valid From MRP';
    if (form.to_mrp === '' || !Number.isFinite(Number(form.to_mrp)) || Number(form.to_mrp) < 0) e.to_mrp = 'Please Enter a valid To MRP';
    if (!e.from_mrp && !e.to_mrp && Number(form.to_mrp) > 0 && Number(form.from_mrp) > Number(form.to_mrp)) e.to_mrp = 'To MRP must be ≥ From MRP';
    setErrors(e); return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return setToast({ msg: 'Please fix the highlighted fields', type: 'err' });
    setBusy(true);
    try {
      const payload = { ...form, from_mrp: Number(form.from_mrp), to_mrp: Number(form.to_mrp) };
      if (edit) await apiSend('/api/taxapp', 'PUT', { id: edit.id, ...payload });
      else await apiSend('/api/taxapp', 'POST', payload);
      setToast({ msg: edit ? 'Tax Application updated' : 'Tax Application created', type: 'ok' }); setShow(false); await search({}, 1, pageModel.pageSize);
    } catch (e: any) { setToast({ msg: e.message || 'Save failed', type: 'err' }); } finally { setBusy(false); }
  };

  const download = (source = rows) => { if (!source.length) { setToast({ msg: 'No data found in the grid to export.', type: 'err' }); return; } requestDownload({
    title: 'Tax Application', module: 'tax-application', baseName: 'tax-application',
    data: { columns: ['Tax Category', 'Tax Type', 'Tax Group Code', 'Goods Direction', 'Tax Zone', 'Start Date', 'Is Active', 'From MRP', 'To MRP'], rows: source.map((r) => [r.tax_category, r.tax_type, r.tax_group_code, r.goods_direction, r.tax_zone, fmt(r.start_date), r.is_active, mrp(r.from_mrp), mrp(r.to_mrp)]) },
  }); };

  const cols: ECol[] = [
    { key: 'tax_category', label: 'Tax Category', filter: 'select', options: catOptions, sortable: true, align: 'left' },
    { key: 'tax_type', label: 'Tax Type', filter: 'select', options: TAX_TYPES, align: 'left' },
    { key: 'tax_group_code', label: 'Tax Group Code', filter: 'select', options: groupOptions, align: 'left' },
    { key: 'goods_direction', label: 'Goods Direction', filter: 'select', options: DIRECTIONS, align: 'left' },
    { key: 'tax_authority', label: 'Tax Authority', filter: 'text', align: 'left' },
    { key: 'tax_zone', label: 'Tax Zone', filter: 'select', options: zoneOptions, align: 'left' },
    { key: 'start_date', label: 'Start Date', filter: 'text', align: 'left', render: (r) => fmt(r.start_date) },
    { key: 'is_active', label: 'Is Active', filter: 'select', options: ['Active', 'Inactive'], align: 'left', render: (r) => <span className="text-slate-700">{r.is_active}</span> },
    { key: 'is_form_c_tax', label: 'Is Form C Tax', filter: 'select', options: ['Yes', 'No'], align: 'left', render: (r) => r.is_form_c_tax ? 'Yes' : 'No' },
    { key: 'is_form_h_tax', label: 'Is Form H Tax', filter: 'select', options: ['Yes', 'No'], align: 'left', render: (r) => r.is_form_h_tax ? 'Yes' : 'No' },
    { key: 'from_mrp', label: 'From MRP', filter: 'none', align: 'right', render: (r) => mrp(r.from_mrp) },
    { key: 'to_mrp', label: 'To MRP', filter: 'none', align: 'right', render: (r) => r.to_mrp ? mrp(r.to_mrp) : '' },
  ];

  return (
    <Shell active="master" breadcrumb="MASTER > Tax Management > Tax Application" openScreens={[{ label: 'Tax Application', to: '#' }]}>
      <EnquiryScreen
        breadcrumb={[{ label: 'Masters' }, { label: 'Master' }, { label: 'Tax Application' }]}
        cols={cols} rows={rows} loading={loading}
        onSearch={(filters, page, size) => search({ ...filters, is_form_c_tax: filters.is_form_c_tax === 'Yes' ? '1' : filters.is_form_c_tax === 'No' ? '0' : '', is_form_h_tax: filters.is_form_h_tax === 'Yes' ? '1' : filters.is_form_h_tax === 'No' ? '0' : '', is_active: filters.is_active === 'Active' ? '1' : filters.is_active === 'Inactive' ? '0' : '' }, page, size)}
        onReset={() => search({}, 1, 20)} remote={pageModel}
        actions={[
          { label: 'Download', icon: Download, onClick: (filtered) => download(filtered || rows) },
          { label: 'Add New', icon: Plus, onClick: openNew },
          { label: 'Bulk Import', icon: Upload, onClick: () => navigate('/app/admin/common-import') },
        ]}
        onRowEdit={openEdit} onRowInfo={setView}
      />

      <Modal title={edit ? 'Edit Tax Application' : 'Add New Tax Application'} open={show} onClose={() => setShow(false)} wide>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Tax Category<span className="text-rose-500"> *</span></label>
            <select aria-label="Tax Category" value={form.tax_category} onChange={(e) => setForm({ ...form, tax_category: e.target.value })} className={`inp ${errors.tax_category ? 'border-rose-400 ring-1 ring-rose-300' : ''}`}><option value="">--- Select ---</option>{categories.filter((category) => category.status === 'Active' || category.code === form.tax_category).map((category) => <option key={category.id} value={category.code}>{category.code} — {category.name}</option>)}</select>
            {errors.tax_category && <p className="mt-0.5 text-xs text-rose-500">{errors.tax_category}</p>}</div>
          <div><label className="lbl">Tax Type</label><select aria-label="Tax Type" value={form.tax_type} onChange={(e) => setForm({ ...form, tax_type: e.target.value })} className={`inp ${errors.tax_type ? 'border-rose-400 ring-1 ring-rose-300' : ''}`}><option value="">--- Select ---</option>{TAX_TYPES.map((t) => <option key={t}>{t}</option>)}</select>{errors.tax_type && <p className="mt-0.5 text-xs text-rose-500">{errors.tax_type}</p>}</div>
          <div><label className="lbl">Tax Group Code<span className="text-rose-500"> *</span></label>
            <select aria-label="Tax Group Code" value={form.tax_group_code} onChange={(e) => setForm({ ...form, tax_group_code: e.target.value })} className={`inp ${errors.tax_group_code ? 'border-rose-400 ring-1 ring-rose-300' : ''}`}><option value="">--- Select ---</option>{taxGroups.filter((group) => group.status === 'Active' || group.code === form.tax_group_code).map((group) => <option key={group.id} value={group.code}>{group.code} — {group.name}</option>)}</select>
            {errors.tax_group_code && <p className="mt-0.5 text-xs text-rose-500">{errors.tax_group_code}</p>}</div>
          <div><label className="lbl">Goods Direction</label><select aria-label="Goods Direction" value={form.goods_direction} onChange={(e) => setForm({ ...form, goods_direction: e.target.value })} className={`inp ${errors.goods_direction ? 'border-rose-400 ring-1 ring-rose-300' : ''}`}><option value="">--- Select ---</option>{DIRECTIONS.map((t) => <option key={t}>{t}</option>)}</select>{errors.goods_direction && <p className="mt-0.5 text-xs text-rose-500">{errors.goods_direction}</p>}</div>
          <div><label className="lbl">Tax Authority</label><input aria-label="Tax Authority" value={form.tax_authority} onChange={(e) => setForm({ ...form, tax_authority: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Tax Zone<span className="text-rose-500"> *</span></label><select aria-label="Tax Zone" value={form.tax_zone} onChange={(e) => setForm({ ...form, tax_zone: e.target.value })} className={`inp ${errors.tax_zone ? 'border-rose-400 ring-1 ring-rose-300' : ''}`}><option value="">--- Select ---</option>{taxZones.filter((zone) => zone.status === 'Active' || zone.code === form.tax_zone).map((zone) => <option key={zone.id} value={zone.code}>{zone.code} — {zone.name}</option>)}</select>{errors.tax_zone && <p className="mt-0.5 text-xs text-rose-500">{errors.tax_zone}</p>}</div>
          <div><label className="lbl">Start Date</label><input aria-label="Start Date" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={`inp ${errors.start_date ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} />{errors.start_date && <p className="mt-0.5 text-xs text-rose-500">{errors.start_date}</p>}</div>
          <div><label className="lbl">From MRP</label><input aria-label="From MRP" type="number" min="0" step="0.01" value={form.from_mrp} onChange={(e) => setForm({ ...form, from_mrp: e.target.value })} className={`inp ${errors.from_mrp ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} />{errors.from_mrp && <p className="mt-0.5 text-xs text-rose-500">{errors.from_mrp}</p>}</div>
          <div><label className="lbl">To MRP</label>
            <input aria-label="To MRP" type="number" min="0" step="0.01" value={form.to_mrp} onChange={(e) => setForm({ ...form, to_mrp: e.target.value })} className={`inp ${errors.to_mrp ? 'border-rose-400 ring-1 ring-rose-300' : ''}`} />
            {errors.to_mrp && <p className="mt-0.5 text-xs text-rose-500">{errors.to_mrp}</p>}</div>
          <div><label className="lbl">Is Active</label><select aria-label="Is Active" value={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.value })} className="inp"><option>Active</option><option>Inactive</option></select></div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.is_form_c_tax} onChange={(e) => setForm({ ...form, is_form_c_tax: e.target.checked })} /> Is Form C Tax</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.is_form_h_tax} onChange={(e) => setForm({ ...form, is_form_h_tax: e.target.checked })} /> Is Form H Tax</label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setShow(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-md bg-[#2f9e9e] px-4 py-2 text-sm font-medium text-white hover:brightness-105 disabled:opacity-50">{busy ? 'Saving…' : edit ? 'Update' : 'Save'}</button>
        </div>
      </Modal>

      <Modal title={`Tax Application — ${view?.tax_category || ''}`} open={!!view} onClose={() => setView(null)} wide>
        {view && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {[['Tax Category', view.tax_category], ['Tax Type', view.tax_type], ['Tax Group Code', view.tax_group_code], ['Goods Direction', view.goods_direction], ['Tax Zone', view.tax_zone || '—'], ['Start Date', fmt(view.start_date)], ['Is Active', view.is_active], ['From MRP', mrp(view.from_mrp)], ['To MRP', mrp(view.to_mrp)]].map(([l, v]) => (
              <div key={l as string}><p className="text-xs text-slate-400">{l}</p><p className="font-medium text-slate-700">{v}</p></div>
            ))}
          </div>
        )}
      </Modal>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </Shell>
  );
}
