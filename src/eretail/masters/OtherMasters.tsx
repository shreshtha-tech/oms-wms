import { useEffect, useState } from 'react';
import Shell from '../Shell';
import { apiGet } from '../../lib/api';

const masters = ['Subscribe HSN code', 'Brands', 'Materials', 'Size Group', 'Size', 'Color', 'State', 'Reasons', 'Tags', 'Payment Terms', 'Pigeon Hole Master', 'Excise Category', 'SKU Case Size', 'Packaging Type', 'SKU Fulfillment Type', 'Channel Configuration', 'Manage Currency', 'UOM', 'FnV Channel Master', 'Pick/Ship Instructions', 'Transpoter PickUp Location Mapping', 'Permanent LPN', 'Device Master', 'Store Promotion'];
const moduleKey = (name: string) => `other-masters-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
type LegacyMaster = { id: number; code?: string; name?: string; status?: string };

export default function OtherMasters() {
  const [selected, setSelected] = useState('');
  const [rows, setRows] = useState<LegacyMaster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selected) { setRows([]); setError(''); return; }
    let active = true;
    setLoading(true);
    setError('');
    apiGet<LegacyMaster[]>(`/api/generic?module=${moduleKey(selected)}`)
      .then((result) => { if (active) setRows(result); })
      .catch((cause) => {
        if (active) {
          setRows([]);
          setError(cause instanceof Error ? cause.message : `Unable to load ${selected}.`);
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected]);

  return <Shell active="master" breadcrumb="MASTER > Miscellaneous > Other Masters" openScreens={[{ label: 'Other Masters', to: '#' }]}>
    <p role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      Other Masters changes are unavailable until each catalog's fields, references, validation, permissions, and consumers are verified. Existing rows are legacy metadata; they are not verified as usable master records.
    </p>
    {!selected ? <section aria-label="Other Masters catalog" className="border bg-white p-6">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {masters.map((master) => <button key={master} onClick={() => setSelected(master)} className="min-h-20 rounded border border-slate-200 bg-gradient-to-b from-white to-slate-50 px-4 py-5 text-sm font-semibold text-slate-700 shadow-sm hover:border-[#2f9e9e] hover:text-[#247d7d]">{master}</button>)}
      </div>
    </section> : <section aria-label="Legacy master records" className="border bg-white">
      <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
        <h2 className="font-semibold">{selected} legacy records</h2>
        <button onClick={() => setSelected('')} className="rounded border bg-white px-3 py-1.5 text-sm">Back to Other Masters</button>
      </div>
      <fieldset disabled className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs">Code *<input aria-label="Code" className="inp mt-1" /></label>
        <label className="text-xs">Name *<input aria-label="Name" className="inp mt-1" /></label>
        <button className="self-end rounded bg-slate-300 px-5 py-2 text-sm text-slate-700">Save</button>
      </fieldset>
      {error && <p role="alert" className="px-4 pb-3 text-sm text-red-700">{error}</p>}
      <table className="w-full text-sm">
        <thead className="bg-slate-100"><tr><th className="p-3 text-left">Code</th><th className="p-3 text-left">Name</th><th className="p-3 text-left">Status</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={3} className="p-10 text-center">Loading records…</td></tr>
          : rows.length ? rows.map((row) => <tr key={row.id} className="border-t"><td className="p-3">{row.code}</td><td className="p-3">{row.name}</td><td className="p-3">{row.status}</td></tr>)
          : <tr><td colSpan={3} className="p-10 text-center text-slate-400">No records to view</td></tr>}</tbody>
      </table>
    </section>}
  </Shell>;
}
