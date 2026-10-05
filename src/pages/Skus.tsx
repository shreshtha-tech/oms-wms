import { useEffect, useState, useMemo } from 'react';
import { Plus, Download, Pencil, Search, X, Filter } from 'lucide-react';
import { apiGet, apiSend, money } from '../lib/api';
import { useDownload } from '../context/DownloadContext';
import PageHeader from '../components/PageHeader';
import DataTable, { Col } from '../components/DataTable';
import Modal from '../components/Modal';
import { useNavigate } from 'react-router-dom';

const CATS = ['Apparel', 'Footwear', 'Electronics', 'Beauty', 'Home & Living', 'Accessories'];
const UOMS = ['PCS', 'PAIR', 'SET', 'BOX'];

export default function Skus() {
  const navigate = useNavigate();
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<any[]>([]);
  const [taxCategories, setTaxCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 50 });
  const [q, setQ] = useState('');
  // individual column filters
  const [fStyle, setFStyle] = useState('');
  const [fName, setFName] = useState('');
  const [fClassification, setFClassification] = useState('');
  const [fSku, setFSku] = useState('');
  const [fBrand, setFBrand] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [show, setShow] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [edit, setEdit] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const empty = { master_sku_code: '', sku_code: '', style: '', name: '', classification: '', category: 'Apparel', brand: '', uom: 'PCS', mrp: '', cost_price: '', sale_price: '', sku_mfg_code: '', primary_vendor: '', hierarchy_code: '', attribute_set: '', hsn: '', back_order: 'No', status: 'Active' };
  const [form, setForm] = useState<any>(empty);

  const load = async (page = 1, pageSize = pager.pageSize, criteria?: Record<string, string>) => {
    const current = criteria || { q, style: fStyle, name: fName, classification: fClassification, sku: fSku, brand: fBrand, status: fStatus };
    setLoading(true); setLoadError('');
    try {
      const result: any = await apiSend('/api/skus', 'POST', {
        _search: true, rows: pageSize, page, sidx: 'sku', sord: 'desc', sku: current.sku, globalSearch: current.q,
        style: current.style, skuName: current.name, tempSkuCode: '', classification: current.classification || '-1',
        size: '', color: '', vendorCode: '', brandCode: current.brand, hierarchyCode: '', attributeSet: '-1',
        sizeGroup: '', status: current.status || '-1', createdBy: '-1', createdDate: '', updatedBy: '-1',
        updatedDate: '', backOrder: '-1', magentoStatus: '-1', REQ_SEARCH_FLAG: true,
      });
      setRows(result.rows || result.gridModel || []);
      setPager({ page: result.page || page, total: result.total || 0, records: result.records || 0, pageSize });
    } catch (error: any) {
      setRows([]); setPager({ page: 0, total: 0, records: 0, pageSize }); setLoadError(error.message || 'Failed to load SKU records');
    } finally { setLoading(false); }
  };
  useEffect(() => {
    void load(1, 50, { q: '', style: '', name: '', classification: '', sku: '', brand: '', status: '' });
    apiGet<any[]>('/api/tax-categories').then(setTaxCategories).catch((error: any) => setLoadError(error.message || 'Failed to load Tax Categories'));
  }, []);

  // dynamic dropdown option lists from data
  const classificationOptions = useMemo(() => [...new Set(rows.map((r) => r.classification).filter(Boolean))].sort(), [rows]);
  const brandOptions = useMemo(() => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort(), [rows]);

  // combined filtering: global search + individual filters (all AND together)
  const filtered = rows;

  const anyFilter = q || fStyle || fName || fClassification || fSku || fBrand || fStatus;
  const clearAll = () => {
    setQ(''); setFStyle(''); setFName(''); setFClassification(''); setFSku(''); setFBrand(''); setFStatus('');
    void load(1, pager.pageSize, { q: '', style: '', name: '', classification: '', sku: '', brand: '', status: '' });
  };

  const openNew = () => { setEdit(null); setForm(empty); setSaveError(''); setShow(true); };
  const openEdit = (r: any) => { setEdit(r); setForm({ ...empty, ...r, mrp: r.mrp, cost_price: r.cost_price }); setSaveError(''); setShow(true); };

  const save = async () => {
    if (!String(form.sku_code || '').trim()) return setSaveError('Please Enter SKU Code');
    if (!String(form.name || '').trim()) return setSaveError('Please Enter SKU Name');
    for (const [key, label] of [['mrp', 'MRP'], ['cost_price', 'Cost Price'], ['sale_price', 'Sale Price']]) {
      const value = form[key] === '' ? 0 : Number(form[key]);
      if (!Number.isFinite(value) || value < 0) return setSaveError(`${label} must be a non-negative number.`);
    }
    setSaveError('');
    setSaving(true);
    try {
      const payload = { ...form, mrp: Number(form.mrp) || 0, cost_price: Number(form.cost_price) || 0, sale_price: Number(form.sale_price) || 0 };
      if (edit) await apiSend('/api/skus', 'PUT', { id: edit.id, ...payload });
      else await apiSend('/api/skus', 'POST', payload);
      setShow(false); await load(1, pager.pageSize);
    } catch (error: any) { setSaveError(error.message || 'SKU could not be saved'); }
    finally { setSaving(false); }
  };


  // Export preserves column order + respects current filters/search/sorting.
  // Offers Excel / CSV / PDF / JSON via the shared format dialog.
  const exportData = () => requestDownload({
    title: 'SKU Master', module: 'skus', baseName: 'sku-master',
    formats: ['excel', 'csv', 'pdf', 'json'],
    data: {
      columns: ['Master SKU Code', 'Product Name', 'Category', 'SKU Code', 'Portal / Brand', 'UOM', 'MRP', 'Cost', 'HSN'],
      rows: filtered.map((r) => [r.master_sku_code || '', r.name, r.category, r.sku_code, r.brand, r.uom, r.mrp, r.cost_price, r.hsn]),
    },
  });

  // Captured SKU Enquiry column order.
  const cols: Col<any>[] = [
    { key: 'sku_code', label: 'SKU Code', render: (r) => <span className="font-medium text-slate-700">{r.sku_code}</span> },
    { key: 'master_sku_code', label: 'Master SKU', render: (r) => r.master_sku_code || '—' },
    { key: 'style', label: 'Style' }, { key: 'name', label: 'SKU Name' }, { key: 'classification', label: 'Classification' },
    { key: 'size_color', label: 'Size/Color' },
    { key: 'mrp', label: 'MRP', render: (r) => money(r.mrp) },
    { key: 'cost_price', label: 'Base Cost', render: (r) => money(r.cost_price) }, { key: 'sale_price', label: 'Sale Price', render: (r) => money(r.sale_price) },
    { key: 'sku_mfg_code', label: 'SKU Mfg Code' }, { key: 'primary_vendor', label: 'Primary Vendor' }, { key: 'brand', label: 'Brand Code' },
    { key: 'hierarchy_code', label: 'Hierarchy Code' }, { key: 'attribute_set', label: 'Attribute Set' }, { key: 'status', label: 'Status' },
    { key: 'created_by', label: 'Created By' }, { key: 'created_date', label: 'Created Date' }, { key: 'updated_by', label: 'Updated By' }, { key: 'updated_date', label: 'Updated Date' },
    { key: 'back_order', label: 'Back Order' }, { key: 'hsn', label: 'Tax Category (HSN/SAC)' },
    { key: 'act', label: 'Actions', render: (r) => (
      <div className="flex gap-1">
        <button type="button" aria-label={`Edit SKU ${r.sku_code}`} title="Edit SKU" onClick={() => openEdit(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><Pencil size={15} /></button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="SKU Enquiry" breadcrumb="Master / SKU Management / SKU Master"
        actions={<>
          <button onClick={() => void load(1,pager.pageSize)} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><Search size={14} /> Search</button>
          <button onClick={clearAll} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><X size={14} /> Reset</button>
          <button onClick={() => setAdvanced((value) => !value)} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><Filter size={14} /> Advance Search</button>
          <button onClick={exportData} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><Download size={14} /> Export</button>
          <button type="button" disabled title="No separate metadata export format is configured." className="flex cursor-not-allowed items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"><Download size={14} /> MetaData Export</button>
          <button onClick={() => navigate('/app/sku-import')} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><Plus size={14} /> Import</button>
          <button onClick={openNew} className="flex items-center gap-1.5 rounded-md bg-[#2f9e9e] px-3 py-2 text-sm font-medium text-white hover:bg-[#268686]"><Plus size={15} /> Add New</button>
        </>} />

      {loadError && <p role="alert" className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{loadError}</p>}
      {/* Global search (searches Master SKU, Name, Category, SKU Code, Portal/Brand) */}
      <div className="mb-3 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 sm:w-96">
        <Search size={15} className="text-slate-400" />
        <input aria-label="Search SKU code, style, SKU name, classification, brand" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(1, pager.pageSize); }} placeholder="Search SKU code, style, SKU name, classification, brand…" className="w-full bg-transparent text-sm outline-none" />
        {q && <button onClick={() => setQ('')} className="text-slate-400 hover:text-rose-500"><X size={14} /></button>}
      </div>

      {/* Individual column filters */}
      {advanced && <div className="mb-4 rounded-md border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FilterText label="Style" value={fStyle} onChange={setFStyle} />
          <FilterText label="SKU Name" value={fName} onChange={setFName} />
          <FilterSelect label="SKU Classification" value={fClassification} onChange={setFClassification} options={classificationOptions} />
          <FilterText label="SKU Code" value={fSku} onChange={setFSku} />
          <FilterSelect label="Brand Code" value={fBrand} onChange={setFBrand} options={brandOptions} />
          <FilterSelect label="Status" value={fStatus} onChange={setFStatus} options={['Active', 'Inactive']} />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className="text-xs text-slate-400">Showing <b className="text-slate-600">{filtered.length}</b> of {rows.length}</span>
          {anyFilter && <button onClick={clearAll} className="flex items-center gap-1 text-xs font-medium text-[#2f7fb6] hover:underline"><Filter size={12} /> Clear all filters</button>}
        </div>
      </div>}

      <DataTable cols={cols} rows={filtered} loading={loading} empty="No SKUs found" />
      <div className="flex items-center justify-between border border-t-0 bg-white px-4 py-2 text-sm text-slate-600"><div className="flex items-center gap-2"><button disabled={pager.page<=1} onClick={()=>load(pager.page-1,pager.pageSize)} className="rounded border px-2 py-1 disabled:opacity-40">‹</button><span>Page {pager.records?pager.page:0} of {pager.total}</span><button disabled={!pager.total||pager.page>=pager.total} onClick={()=>load(pager.page+1,pager.pageSize)} className="rounded border px-2 py-1 disabled:opacity-40">›</button><select aria-label="Records per Page" value={pager.pageSize} onChange={e=>load(1,Number(e.target.value))} className="rounded border px-2 py-1">{[50,100,200].map(n=><option key={n}>{n}</option>)}</select></div><span>{pager.records?`View ${(pager.page-1)*pager.pageSize+1} - ${Math.min(pager.page*pager.pageSize,pager.records)} of ${pager.records}`:'No records to view'}</span></div>

      <Modal title={edit ? 'Edit SKU' : 'Add New SKU'} open={show} onClose={() => setShow(false)} wide>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Master SKU Code</label><input aria-label="Master SKU Code" value={form.master_sku_code} onChange={(e) => setForm({ ...form, master_sku_code: e.target.value })} className="inp" placeholder="e.g. MSKU-1001" /></div>
          <div><label className="lbl">SKU Code *</label><input aria-label="SKU Code" value={form.sku_code} onChange={(e) => setForm({ ...form, sku_code: e.target.value })} className="inp" placeholder="e.g. TSHIRT-BLK-M" /></div>
          <div><label className="lbl">Style</label><input aria-label="Style" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} className="inp" /></div>
          <div><label className="lbl">SKU Name *</label><input aria-label="SKU Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="inp" /></div>
          <div><label className="lbl">SKU Classification</label><input aria-label="SKU Classification" value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Category</label><select aria-label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="inp">{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="lbl">Portal / Brand</label><input aria-label="Portal / Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="inp" placeholder="Source portal / supplier / marketplace" /></div>
          <div><label className="lbl">UOM</label><select aria-label="UOM" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} className="inp">{UOMS.map((u) => <option key={u}>{u}</option>)}</select></div>
          <div><label className="lbl">HSN/SAC Category</label><select aria-label="HSN/SAC Category" value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} className="inp"><option value="">--- Select ---</option>{taxCategories.filter((item) => item.status === 'Active' || item.code === form.hsn).map((item) => <option key={item.id} value={item.code}>{item.code} — {item.name}</option>)}</select></div>
          <div><label className="lbl">Status</label><select aria-label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="inp"><option>Active</option><option>Inactive</option></select></div>
          <div><label className="lbl">MRP (₹)</label><input aria-label="MRP" type="number" min="0" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Cost Price (₹)</label><input aria-label="Cost Price" type="number" min="0" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Sale Price</label><input aria-label="Sale Price" type="number" min="0" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} className="inp" /></div>
          <div><label className="lbl">SKU Mfg Code</label><input aria-label="SKU Mfg Code" value={form.sku_mfg_code} onChange={(e) => setForm({ ...form, sku_mfg_code: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Primary Vendor</label><input aria-label="Primary Vendor" value={form.primary_vendor} onChange={(e) => setForm({ ...form, primary_vendor: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Hierarchy Code</label><input aria-label="Hierarchy Code" value={form.hierarchy_code} onChange={(e) => setForm({ ...form, hierarchy_code: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Attribute Set</label><input aria-label="Attribute Set" value={form.attribute_set} onChange={(e) => setForm({ ...form, attribute_set: e.target.value })} className="inp" /></div>
          <div><label className="lbl">Back Order</label><select aria-label="Back Order" value={form.back_order} onChange={(e) => setForm({ ...form, back_order: e.target.value })} className="inp"><option>No</option><option>Yes</option></select></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setShow(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          {saveError && <p role="alert" className="mr-auto text-sm text-rose-600">{saveError}</p>}
          <button onClick={save} disabled={saving} className="rounded-md bg-[#2f9e9e] px-4 py-2 text-sm font-medium text-white hover:bg-[#268686] disabled:opacity-50">{saving ? 'Saving…' : edit ? 'Update SKU' : 'Create SKU'}</button>
        </div>
      </Modal>
    </div>
  );
}

function FilterText({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <div className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5">
        <Search size={13} className="text-slate-400" />
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-sm outline-none" />
        {value && <button onClick={() => onChange('')} className="text-slate-400 hover:text-rose-500"><X size={12} /></button>}
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const shown = options.filter((o) => o.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <button type="button" aria-label={`Filter ${label}`} onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-left text-sm text-slate-600">
        <span className={value ? 'text-slate-700' : 'text-slate-400'}>{value || 'All'}</span>
        <span className="flex items-center gap-1">{value && <X size={12} className="text-slate-400 hover:text-rose-500" onClick={(e) => { e.stopPropagation(); onChange(''); }} />}<Search size={13} className="text-slate-400" /></span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
            <div className="border-b border-slate-100 p-2">
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-[#2f9e9e]" />
            </div>
            <div className="max-h-52 overflow-y-auto py-1">
              <button onClick={() => { onChange(''); setOpen(false); setSearch(''); }} className="block w-full px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-50">All</button>
              {shown.map((o) => (
                <button key={o} onClick={() => { onChange(o); setOpen(false); setSearch(''); }} className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${value === o ? 'font-medium text-[#2f9e9e]' : 'text-slate-600'}`}>{o}</button>
              ))}
              {shown.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No matches</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
