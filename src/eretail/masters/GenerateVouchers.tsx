import { useEffect, useState } from 'react';
import Shell from '../Shell';
import { apiGet } from '../../lib/api';

type LegacyVoucher = {
  id: number;
  code?: string;
  voucher_value?: string | number;
  voucher_type?: string;
  max_cap?: string | number;
  start_date?: string;
  end_date?: string;
  location?: string;
  extra?: Partial<LegacyVoucher>;
};

const recordedValue = (row: LegacyVoucher, key: keyof LegacyVoucher) =>
  String(row[key] ?? row.extra?.[key] ?? '');

export default function GenerateVouchers() {
  const [rows, setRows] = useState<LegacyVoucher[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiGet<LegacyVoucher[]>('/api/generic?module=vouchers')
      .then((result) => { if (active) setRows(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load voucher records.'); });
    return () => { active = false; };
  }, []);

  const shown = rows.filter((row) => String(row.code || '').toLowerCase().includes(query.toLowerCase()));

  return <Shell active="master" breadcrumb="MASTER > POS Setup > Generate Vouchers" openScreens={[{ label: 'Generate Vouchers', to: '#' }]}>
    <div className="space-y-4">
      <p role="status" className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        Voucher generation is unavailable until issuance, eligibility, redemption, audit, and permissions are connected and verified. Existing rows below are legacy metadata; they are not verified as redeemable vouchers.
      </p>
      <section aria-label="Voucher generation" className="rounded border bg-white p-4">
        <fieldset disabled className="grid gap-3 md:grid-cols-4">
          <label className="lbl">Voucher Prefix<input className="inp" /></label>
          <label className="lbl">Voucher Value<input className="inp" /></label>
          <label className="lbl">Voucher Count<input className="inp" /></label>
          <label className="lbl">Voucher Type<select className="inp" defaultValue=""><option value="">--- Select ---</option><option>Absolute</option><option>Percentage</option></select></label>
          <label className="lbl">Max Cap<input className="inp" /></label>
          <label className="lbl">StartDate<input type="date" className="inp" /></label>
          <label className="lbl">End Date<input type="date" className="inp" /></label>
          <label className="lbl">Location<input className="inp" /></label>
          <button className="rounded bg-slate-300 px-4 py-2 text-sm text-slate-700 md:col-span-4 md:justify-self-start">Generate Vouchers</button>
        </fieldset>
      </section>
      <section aria-label="Legacy voucher records" className="rounded border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">Legacy voucher records</h2>
        <input aria-label="Search legacy voucher codes" className="inp mb-3" value={query} onChange={(event) => setQuery(event.target.value)} />
        {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr>{['Voucher Code', 'Voucher Value', 'Voucher Type', 'Max Cap', 'StartDate', 'End Date', 'Location'].map((heading) => <th key={heading} className="p-2 text-left">{heading}</th>)}</tr></thead>
          <tbody>{shown.length ? shown.map((row) => <tr key={row.id} className="border-t">
            <td className="p-2">{row.code}</td><td>{recordedValue(row, 'voucher_value')}</td><td>{recordedValue(row, 'voucher_type')}</td>
            <td>{recordedValue(row, 'max_cap')}</td><td>{recordedValue(row, 'start_date')}</td><td>{recordedValue(row, 'end_date')}</td><td>{recordedValue(row, 'location')}</td>
          </tr>) : <tr><td colSpan={7} className="p-6 text-center text-slate-500">No records to view</td></tr>}</tbody>
        </table></div>
      </section>
    </div>
  </Shell>;
}
