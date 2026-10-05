import { useEffect, useMemo, useRef, useState } from 'react';
import Shell from '../Shell';
import { Toast } from '../parts';
import Modal from '../../components/Modal';
import { apiGet, apiSend } from '../../lib/api';

type Form = { description: string; externalCode: string; active: boolean };
type AttributeSetRow = { id: number; code: string; name: string; status: string; extra?: { external_code?: string } };
const initial: Form = { description: '', externalCode: '', active: true };

export default function AttributeSet() {
  const [rows, setRows] = useState<AttributeSetRow[]>([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<Form>({ ...initial });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [toast, setToast] = useState<any>(null);
  const loadRevision = useRef(0);
  const savingRef = useRef(false);

  const load = async () => {
    const revision = ++loadRevision.current;
    setLoading(true);
    try {
      const response = await apiGet<{ rows: AttributeSetRow[] }>('/api/attribute-sets');
      if (revision === loadRevision.current) setRows(Array.isArray(response.rows) ? response.rows : []);
    } catch (error: any) {
      if (revision === loadRevision.current) setToast({ msg: error.message || 'Unable to load Attribute Set', type: 'err' });
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => { loadRevision.current++; };
  }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('en');
    return rows.filter((row) => [row.code, row.name, row.extra?.external_code]
      .some((value) => String(value || '').toLocaleLowerCase('en').includes(needle)));
  }, [rows, query]);

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await apiSend('/api/attribute-sets', 'POST', form);
      setToast({ msg: 'Attribute Set saved successfully', type: 'ok' });
      setForm({ ...initial });
      setOpen(false);
      await load();
    } catch (error: any) {
      setToast({ msg: error.message || 'Unable to save Attribute Set', type: 'err' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (deleting !== null) return;
    setDeleting(id);
    try {
      await apiSend('/api/attribute-sets', 'DELETE', { id });
      setToast({ msg: 'Attribute Set deleted successfully', type: 'ok' });
      await load();
    } catch (error: any) {
      setToast({ msg: error.message || 'Unable to delete Attribute Set', type: 'err' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Shell active="master" breadcrumb="MASTER > SKU Management > Attribute Set" openScreens={[{ label: 'Attribute Set', to: '#' }]}>
      <div className="space-y-4">
        <section className="rounded border bg-white p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="lbl">Attribute Set Description
              <input aria-label="Attribute Set search" className="inp mt-1" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <button type="button" className="self-end rounded border px-4 py-2 text-sm" onClick={() => setQuery('')}>Reset</button>
            <button type="button" className="self-end rounded bg-[#2f9e9e] px-4 py-2 text-sm text-white" onClick={() => { setForm({ ...initial }); setOpen(true); }}>Add New</button>
          </div>
        </section>

        <section className="overflow-x-auto rounded border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50"><tr>
              {['Attribute Set Code', 'Attribute Set Description', 'Ext Attribute Set Code', 'Is Active', 'Actions'].map((heading) => <th className="p-3 text-left" key={heading}>{heading}</th>)}
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="p-8 text-center text-slate-400">Loading Attribute Sets…</td></tr>
                : shown.length ? shown.map((row) => <tr className="border-t" key={row.id}>
                  <td className="p-3">{row.code}</td><td className="p-3">{row.name}</td>
                  <td className="p-3">{row.extra?.external_code || '—'}</td><td className="p-3">{row.status === 'Active' ? 'Yes' : 'No'}</td>
                  <td className="p-3"><button type="button" disabled={deleting !== null} onClick={() => void remove(row.id)} className="text-rose-600 hover:underline disabled:opacity-50">{deleting === row.id ? 'Deleting…' : 'Delete'}</button></td>
                </tr>)
                  : <tr><td colSpan={5} className="p-8 text-center text-slate-400">No records to view</td></tr>}
            </tbody>
          </table>
        </section>

        <Modal title="Add Attribute Set" open={open} onClose={() => !saving && setOpen(false)}>
          <div className="grid gap-4">
            <Field label="Attribute Set Description*"><input aria-label="Attribute Set Description" value={form.description} disabled={saving} onChange={(event) => setForm({ ...form, description: event.target.value })} className="inp" /></Field>
            <Field label="Ext Attribute Set Code"><input aria-label="Ext Attribute Set Code" value={form.externalCode} disabled={saving} onChange={(event) => setForm({ ...form, externalCode: event.target.value })} className="inp" /></Field>
            <label className="flex items-center gap-2 text-sm"><input aria-label="Is Active" type="checkbox" checked={form.active} disabled={saving} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Is Active</label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="rounded border px-4 py-2 text-sm" disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="rounded bg-[#2f9e9e] px-4 py-2 text-sm text-white disabled:opacity-50" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </Shell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="lbl">{label}{children}</label>;
}
