import { useEffect, useRef, useState } from 'react';
import Shell from '../Shell';
import { Toast } from '../parts';
import { apiGet, apiSend } from '../../lib/api';

type Form = { vendor: string; sku: string; location: string; cost: string; maxOrder: string; minOrder: string; leadTime: string };
type CatalogResponse = {
  rows: any[];
  vendors: { id: number; vendor_code: string; vendor_name: string }[];
  skus: { id: number; sku_code: string; name: string }[];
  locations: { id: number; code: string; name: string }[];
};
const empty: Form = { vendor: '', sku: '', location: '', cost: '', maxOrder: '', minOrder: '', leadTime: '' };
const numericFields: [keyof Form, string][] = [
  ['cost', 'Cost'], ['maxOrder', 'Maximum Order Qty'], ['minOrder', 'Minimum Order Qty'], ['leadTime', 'Lead Time (Days)'],
];

export default function VendorSkuLocCatalog() {
  const [form, setForm] = useState<Form>({ ...empty });
  const [rows, setRows] = useState<any[]>([]);
  const [vendors, setVendors] = useState<CatalogResponse['vendors']>([]);
  const [skus, setSkus] = useState<CatalogResponse['skus']>([]);
  const [locations, setLocations] = useState<CatalogResponse['locations']>([]);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const savingRef = useRef(false);

  const load = async () => {
    const current = ++revision.current;
    setLoading(true);
    try {
      const response = await apiGet<CatalogResponse>('/api/vendor-sku-loc-catalog');
      if (current === revision.current) {
        setRows(Array.isArray(response.rows) ? response.rows : []);
        setVendors(Array.isArray(response.vendors) ? response.vendors : []);
        setSkus(Array.isArray(response.skus) ? response.skus : []);
        setLocations(Array.isArray(response.locations) ? response.locations : []);
      }
    } catch (error: any) {
      if (current === revision.current) setToast({ msg: error.message || 'Vendor SKU Location Catalog could not be loaded.', type: 'err' });
    } finally {
      if (current === revision.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => { revision.current++; };
  }, []);

  const setField = (key: keyof Form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const reset = () => setForm({ ...empty });
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await apiSend('/api/vendor-sku-loc-catalog', 'POST', form);
      setToast({ msg: 'Vendor SKU Location saved successfully', type: 'ok' });
      reset();
      await load();
    } catch (error: any) {
      setToast({ msg: error.message || 'Vendor SKU Location could not be saved.', type: 'err' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const needle = query.trim().toLocaleLowerCase('en');
  const shown = rows.filter((row) => [row.code, row.extra?.vendor, row.extra?.sku, row.extra?.location]
    .some((value) => String(value || '').toLocaleLowerCase('en').includes(needle)));

  return (
    <Shell active="master" breadcrumb="MASTER > SKU Management > Vendor SKU Loc Catalog" openScreens={[{ label: 'Vendor SKU Loc Catalog', to: '#' }]}>
      <div className="space-y-4">
        <section className="rounded border bg-white p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Select label="Vendor" value={form.vendor} disabled={saving || loading} onChange={(value) => setField('vendor', value)} options={vendors.map((row) => ({ value: row.vendor_code, label: `${row.vendor_code} — ${row.vendor_name}` }))} />
            <Select label="SKU" value={form.sku} disabled={saving || loading} onChange={(value) => setField('sku', value)} options={skus.map((row) => ({ value: row.sku_code, label: `${row.sku_code}${row.name ? ` — ${row.name}` : ''}` }))} />
            <Select label="Location" value={form.location} disabled={saving || loading} onChange={(value) => setField('location', value)} options={locations.map((row) => ({ value: row.code, label: `${row.code}${row.name ? ` — ${row.name}` : ''}` }))} />
            {numericFields.map(([key, label]) => <label className="lbl" key={key}>{label}
              <input type="number" min="0" step="any" aria-label={label} value={form[key]} disabled={saving} onChange={(event) => setField(key, event.target.value)} className="inp mt-1" />
            </label>)}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={saving} onClick={reset} className="rounded border px-4 py-2 disabled:opacity-50">Reset</button>
            <button type="button" disabled={saving || loading} onClick={() => void save()} className="rounded bg-[#2f9e9e] px-4 py-2 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </section>

        <section className="rounded border bg-white p-4">
          <input aria-label="Search" className="inp mb-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Vendor, SKU or Location" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{['Vendor', 'SKU', 'Location', 'Cost', 'Maximum Order Qty', 'Minimum Order Qty', 'Lead Time (Days)'].map((heading) => <th className="px-2 py-2 text-left" key={heading}>{heading}</th>)}</tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={7} className="p-8 text-center text-slate-400">Loading Vendor SKU Location Catalog…</td></tr>
                  : shown.length ? shown.map((row) => <tr className="border-t" key={row.id}>
                    {[row.extra?.vendor, row.extra?.sku, row.extra?.location, row.extra?.cost, row.extra?.maxOrder, row.extra?.minOrder, row.extra?.leadTime].map((value, index) => <td className="px-2 py-2" key={index}>{value ?? ''}</td>)}
                  </tr>)
                    : <tr><td colSpan={7} className="p-8 text-center text-slate-400">No records to view</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </Shell>
  );
}

function Select({ label, value, options, disabled, onChange }: { label: string; value: string; options: { value: string; label: string }[]; disabled?: boolean; onChange: (value: string) => void }) {
  return <label className="lbl">{label}<select aria-label={label} className="inp mt-1" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">Select {label}</option>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>;
}
