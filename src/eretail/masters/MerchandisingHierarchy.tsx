import { useEffect, useState } from 'react';
import { ChevronRight, Download, History, RotateCcw, Save, Upload } from 'lucide-react';
import Shell from '../Shell';
import { apiGet, apiSend } from '../../lib/api';
import { Toast } from '../parts';
import { useDownload } from '../../context/DownloadContext';

const tabs = ['Merchandising Hierarchy', 'User Defined Fields', 'Other Settings'];
const hierarchyTypes = ['Department', 'Category', 'Sub Category'];
const outboundPackaging = ['Small Box', 'Big Box', 'Medium Box', 'FEDEX_BOX', 'FEDEX_ENVELOPE', 'Normal'];
const inboundPackaging = ['Small Box', 'Big Box', 'Medium Box', 'Normal'];
const blank = {
  hierarchy_type: 'Department', code: '', external_code: '', name: '', description: '', parent_code: '', status: 'Active',
  outbound_packaging_type: '', inbound_packaging_type: '', udf: Array(5).fill(''), default_lottable: '', is_default: 'No',
  return_window: '', non_returnable: false, pre_approved: false, restricted: false, eligible: false,
};

type HierarchyRow = typeof blank & { id: number; created_by?: string; created_date?: string; updated_by?: string; updated_date?: string };

export default function MerchandisingHierarchy() {
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<HierarchyRow[]>([]);
  const [form, setForm] = useState<any>({ ...blank, udf: [...blank.udf] });
  const [edit, setEdit] = useState<HierarchyRow | null>(null);
  const [tab, setTab] = useState(tabs[0]);
  const [toast, setToast] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response: any = await apiGet('/api/merch-hierarchy');
      setRows(Array.isArray(response.rows) ? response.rows : []);
      return true;
    } catch (error: any) {
      setToast({ msg: error.message || 'Merchandising Hierarchy could not be loaded.', type: 'err' });
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const reset = () => {
    setForm({ ...blank, udf: [...blank.udf] });
    setEdit(null);
    setTab(tabs[0]);
  };

  const pick = (row: HierarchyRow) => {
    setEdit(row);
    setForm({ ...blank, ...row, udf: Array.from({ length: 5 }, (_, index) => row.udf?.[index] || '') });
    setTab(tabs[0]);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response: any = await apiSend('/api/merch-hierarchy', edit ? 'PUT' : 'POST', edit ? { ...form, id: edit.id } : form);
      setToast({ msg: edit ? 'Merchandising Hierarchy updated successfully.' : 'Merchandising Hierarchy saved successfully.', type: 'ok' });
      reset();
      await load();
      return response;
    } catch (error: any) {
      setToast({ msg: error.message || 'Merchandising Hierarchy could not be saved.', type: 'err' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const setField = (key: string, value: unknown) => setForm((current: any) => ({ ...current, [key]: value }));
  const exportRows = () => requestDownload({
    title: 'Merchandising Hierarchy',
    module: 'merch-hierarchy',
    baseName: 'merchandising-hierarchy',
    data: {
      columns: ['Code', 'Name', 'Type', 'Parent', 'Status'],
      rows: rows.map((row) => [row.code, row.name, row.hierarchy_type, row.parent_code, row.status]),
    },
  });

  const renderTree = (parentCode = '', visited = new Set<number>()): React.ReactNode => rows
    .filter((row) => (row.parent_code || '') === parentCode)
    .map((row) => {
      if (visited.has(row.id)) return <div key={row.id} role="alert" className="px-2 py-1 text-xs text-rose-700">Circular parent link detected.</div>;
      const nextVisited = new Set(visited);
      nextVisited.add(row.id);
      return (
        <div key={row.id}>
          <button type="button" aria-label={`Select merchandising ${row.code}`} onClick={() => pick(row)} className={`flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm ${edit?.id === row.id ? 'bg-sky-100' : 'hover:bg-sky-50'}`}>
            <ChevronRight size={12} />{row.name}
          </button>
          <div className="pl-4">{renderTree(row.code, nextVisited)}</div>
        </div>
      );
    });

  return (
    <Shell active="master" breadcrumb="MASTER > Sku Management > Merchandising Hierarchy" openScreens={[{ label: 'Merchandising Hierarchy', to: '#' }]}>
      <div className="mb-2 flex justify-end gap-2">
        <button type="button" disabled={saving || loading} onClick={() => void save()} className="flex items-center gap-1 rounded bg-[#f5a623] px-3 py-2 text-sm text-white disabled:opacity-50"><Save size={14} />{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={saving} onClick={reset} className="flex items-center gap-1 rounded border px-3 py-2 text-sm disabled:opacity-50"><RotateCcw size={14} />Reset</button>
        <button type="button" disabled className="flex items-center gap-1 rounded border px-3 py-2 text-sm opacity-50" title="Hierarchy CSV import is unavailable until a verified processor is connected."><Upload size={14} />Import unavailable</button>
        <button type="button" disabled={loading} onClick={exportRows} className="flex items-center gap-1 rounded border px-3 py-2 text-sm disabled:opacity-50"><Download size={14} />Export</button>
        <button type="button" onClick={() => setToast({ msg: 'Audit history is unavailable for Merchandising Hierarchy records.', type: 'err' })} className="flex items-center gap-1 rounded border px-3 py-2 text-sm"><History size={14} />Audit</button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[310px_1fr]">
        <section className="min-h-[560px] border bg-white p-3">
          <h2 className="mb-2 border-b pb-2 font-semibold">Merchandising Hierarchy</h2>
          {loading ? <p className="p-4 text-sm text-slate-500">Loading hierarchy…</p> : renderTree()}
          {!loading && rows.length === 0 && <p className="p-4 text-sm text-slate-500">No merchandising hierarchy records.</p>}
        </section>

        <section className="border bg-white">
          <div className="flex border-b">
            {tabs.map((value) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)} className={`px-4 py-3 text-sm ${tab === value ? 'border-b-2 border-red-500' : ''}`}>{value}</button>)}
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-3">
            {tab === 'Merchandising Hierarchy' && <>
              <SelectField label="Merch. Hierarchy Type *" value={form.hierarchy_type} options={hierarchyTypes} disabled={saving} onChange={(value) => setField('hierarchy_type', value)} />
              <TextField label="Merchandising Code *" value={form.code} disabled={saving || !!edit} onChange={(value) => setField('code', value)} />
              <TextField label="Ext. Merchandising Code" value={form.external_code} disabled={saving} onChange={(value) => setField('external_code', value)} />
              <TextField label="Merchandising Name *" value={form.name} disabled={saving} onChange={(value) => setField('name', value)} />
              <TextField label="Merchandising Desc *" value={form.description} disabled={saving} onChange={(value) => setField('description', value)} />
              <SelectField label="Parent Merch Code" value={form.parent_code} options={rows.filter((row) => row.id !== edit?.id).map((row) => row.code)} disabled={saving} onChange={(value) => setField('parent_code', value)} />
              <label className="flex items-center gap-2 pt-6"><input aria-label="Is Active" type="checkbox" checked={form.status === 'Active'} disabled={saving} onChange={(event) => setField('status', event.target.checked ? 'Active' : 'InActive')} />Is Active</label>
              <SelectField label="Outbound Packaging Type" value={form.outbound_packaging_type} options={outboundPackaging} disabled={saving} onChange={(value) => setField('outbound_packaging_type', value)} />
              <SelectField label="Inbound Packaging Type" value={form.inbound_packaging_type} options={inboundPackaging} disabled={saving} onChange={(value) => setField('inbound_packaging_type', value)} />
            </>}

            {tab === 'User Defined Fields' && form.udf.map((value: string, index: number) => (
              <label key={index} className="text-sm">UDF {index + 1}
                <input aria-label={`UDF ${index + 1}`} className="inp mt-1" value={value} disabled={saving} onChange={(event) => setField('udf', form.udf.map((item: string, itemIndex: number) => itemIndex === index ? event.target.value : item))} />
              </label>
            ))}

            {tab === 'Other Settings' && <>
              <TextField label="Default Lottable" value={form.default_lottable} disabled={saving} onChange={(value) => setField('default_lottable', value)} />
              <SelectField label="Is Default" value={form.is_default} options={['No', 'Yes']} disabled={saving} onChange={(value) => setField('is_default', value)} />
              <TextField label="Return Window" type="number" value={form.return_window} disabled={saving} onChange={(value) => setField('return_window', value)} />
              {([
                ['non_returnable', 'Non Returnable Category'],
                ['pre_approved', 'Pre Approved Category'],
                ['restricted', 'Restricted Category'],
                ['eligible', 'Eligible Category'],
              ] as const).map(([field, label]) => (
                <label key={field} className="flex gap-2 pt-6"><input aria-label={label} type="checkbox" checked={!!form[field]} disabled={saving} onChange={(event) => setField(field, event.target.checked)} />{label}</label>
              ))}
            </>}
          </div>
        </section>
      </div>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </Shell>
  );
}

function TextField({ label, value, onChange, disabled = false, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; disabled?: boolean; type?: string }) {
  return <label className="text-sm">{label}<input aria-label={label} type={type} className="inp mt-1" value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SelectField({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: string[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="text-sm">{label}<select aria-label={label} className="inp mt-1" value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">--- Select ---</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}
