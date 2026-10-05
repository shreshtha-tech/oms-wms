import { useRef, useState } from 'react';
import Shell from '../Shell';
import EnquiryScreen, { type EField } from '../EnquiryScreen';
import Modal from '../../components/Modal';
import { Toast } from '../parts';
import { apiSend } from '../../lib/api';

const initial = { code: '', description: '', mandatory: false, visible: true, scope: 'C', searchable: false, isActive: true, inputType: 'Text' };
const columns = [
  { key: 'code', label: 'Attribute Code' }, { key: 'description', label: 'Description' },
  { key: 'mandatory', label: 'Mandatory', render: (r: any) => r.extra?.mandatory ? 'Yes' : 'No' },
  { key: 'input_type', label: 'Input Type', render: (r: any) => r.extra?.input_type || 'Text' },
  { key: 'visible', label: 'Visible', render: (r: any) => r.extra?.visible ? 'Yes' : 'No' },
  { key: 'scope', label: 'Scope', render: (r: any) => ({ S: 'Seller Panel', C: 'Company', E: 'Enterprise' }[r.extra?.scope as 'S' | 'C' | 'E'] || r.extra?.scope || '') },
  { key: 'searchable', label: 'Searchable', render: (r: any) => r.extra?.searchable ? 'Yes' : 'No' },
];
const fields: EField[] = [
  { key: 'code', label: 'Attribute Code' }, { key: 'description', label: 'Description' },
  { key: 'mandatory', label: 'Mandatory', type: 'select', options: ['--- Select ---', 'Yes', 'No'] },
  { key: 'visible', label: 'Visible', type: 'select', options: ['--- Select ---', 'Yes', 'No'] },
  { key: 'scope', label: 'Scope', type: 'select', options: ['--- Select ---', 'Seller Panel', 'Company', 'Enterprise'] },
  { key: 'searchable', label: 'Searchable', type: 'select', options: ['--- Select ---', 'Yes', 'No'] },
  { key: 'isActive', label: 'isActive', type: 'select', options: ['--- Select ---', 'Yes', 'No'] },
];

export default function ManageAttribute() {
  const [rows, setRows] = useState<any[]>([]), [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 20 });
  const [loading, setLoading] = useState(false), [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [form, setForm] = useState(initial), [toast, setToast] = useState<any>(null);
  const searchRevision = useRef(0), savingRef = useRef(false);
  const search = async (filters: any = {}, page = 1, size = pager.pageSize) => {
    const revision = ++searchRevision.current;
    setLoading(true);
    try {
      const bool = (value: string) => value === 'Yes' ? 'true' : value === 'No' ? 'false' : '-1';
      const scope = ({ 'Seller Panel': 'S', Company: 'C', Enterprise: 'E' } as Record<string, string>)[filters.scope] || '-1';
      const response: any = await apiSend('/api/manage-attributes', 'POST', { rows: size, page, sidx: 'attrPK.atribCode', sord: 'desc', pick_sku: filters.code || '', attributeDescription: filters.description || '', mandatory1: bool(filters.mandatory), visible1: bool(filters.visible), scope1: scope, searchable1: bool(filters.searchable), active: bool(filters.isActive), REQ_SEARCH_FLAG: true });
      if (revision === searchRevision.current) {
        setRows(Array.isArray(response.rows) ? response.rows : []);
        setPager({ page: response.page, total: response.total, records: response.records, pageSize: size });
      }
    } catch (error: any) {
      if (revision === searchRevision.current) setToast({ msg: error.message, type: 'err' });
    } finally {
      if (revision === searchRevision.current) setLoading(false);
    }
  };
  const reset = () => { searchRevision.current++; setLoading(false); setRows([]); setPager({ page: 0, total: 0, records: 0, pageSize: 20 }); };
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await apiSend('/api/manage-attributes', 'POST', form);
      setToast({ msg: 'Attribute saved successfully', type: 'ok' }); setOpen(false); setForm({ ...initial });
    } catch (error: any) { setToast({ msg: error.message, type: 'err' }); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <Shell active="master" breadcrumb="MASTER > SKU Management > Attribute Enquiry" openScreens={[{ label: 'Attribute Enquiry', to: '#' }]}>
    <EnquiryScreen breadcrumb={[{ label: 'Master' }, { label: 'SKU Management' }, { label: 'Attribute Enquiry' }]} fields={fields} cols={columns} rows={rows} loading={loading} remote={pager} pageSizes={[20, 50, 100, 200]} onSearch={search} onReset={reset} actions={[{ label: 'Add New', onClick: () => setOpen(true) }]} />
    <Modal title="Add Attribute" open={open} onClose={() => !saving && setOpen(false)} wide><div className="grid gap-4 md:grid-cols-2">
      <Field label="Attribute Code *"><input aria-label="Attribute Code" className="inp" value={form.code} disabled={saving} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
      <Field label="Description *"><input aria-label="Description" className="inp" value={form.description} disabled={saving} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Input Type"><select aria-label="Input Type" className="inp" value={form.inputType} disabled={saving} onChange={(e) => setForm({ ...form, inputType: e.target.value })}><option>Text</option><option>Number</option><option>Date</option><option>List</option></select></Field>
      <Field label="Scope"><select aria-label="Scope" className="inp" value={form.scope} disabled={saving} onChange={(e) => setForm({ ...form, scope: e.target.value })}><option value="S">Seller Panel</option><option value="C">Company</option><option value="E">Enterprise</option></select></Field>
      {(['mandatory', 'visible', 'searchable', 'isActive'] as const).map((key) => <label key={key} className="flex items-center gap-2 text-sm"><input aria-label={key} type="checkbox" checked={form[key]} disabled={saving} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />{key}</label>)}
    </div><div className="mt-5 flex justify-end gap-2"><button className="rounded border px-4 py-2" disabled={saving} onClick={() => setOpen(false)}>Cancel</button><button className="rounded bg-[#2f9e9e] px-4 py-2 text-white disabled:opacity-50" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button></div></Modal>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}
function Field({ label, children }: any) { return <label className="lbl">{label}{children}</label>; }
