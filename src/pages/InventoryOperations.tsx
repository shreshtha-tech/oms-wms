import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';
import PageHeader from '../components/PageHeader';
import { useActiveLocations } from '../hooks/useActiveLocations';

const titles: Record<string, string> = {
  'inv-move': 'Inventory Move',
  'inv-move-scan': 'Inventory Move By Scan',
  'inv-move-history': 'Inventory Move History',
  'intercompany-move': 'Intercompany Move',
  'bulk-lottables': 'Bulk update Lottables',
  'stock-adjustment': 'Stock Adjustment',
  'outbound-gate-pass': 'Outbound Gate Pass',
  'outbound-memo': 'Manage Outbound Memo',
  'sku-transaction-history': 'SKU Transaction History',
  'sku-lot-transfer': 'Manage SKU Lot Transfer',
};

type InventoryRow = { id: string; master_sku_id: string; location_id: string; sku_code: string; warehouse: string; available: number };
const cls = 'inp w-full';

export default function InventoryOperations({ operation }: { operation: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const { locations, loading: locationsLoading, error: locationsError } = useActiveLocations();
  const [form, setForm] = useState({ sku_code: '', inventory_id: '', from_warehouse: '', to_warehouse: '', quantity: '', reason: '', reference: '' });
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'ok'|'err'|'pending'>('err');
  const pendingRequestId = useRef<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const title = titles[operation] || operation;
  const move = ['inv-move', 'inv-move-scan', 'intercompany-move'].includes(operation);
  const adjust = operation === 'stock-adjustment';

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const entity = operation === 'inv-move-history' ? 'history' : operation;
      const [records, stock] = await Promise.all([
        apiGet<Record<string, unknown>[]>(`/api/inventory-ops?entity=${entity}`),
        apiGet<InventoryRow[]>('/api/inventory-ops?entity=view'),
      ]);
      setRows(records);
      setInventory(stock);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load inventory operation data.');
    }
  }, [operation]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    setMessage('');
    try {
      const entity = operation === 'stock-adjustment' ? 'adjustments' : operation === 'inv-move-history' ? 'moves' : operation;
      const stockChanging = move || adjust;
      const storageKey = `wms-stock-request:${operation}`;
      const requestId = stockChanging ? (pendingRequestId.current ||= sessionStorage.getItem(storageKey) || crypto.randomUUID()) : undefined;
      if (stockChanging && requestId) sessionStorage.setItem(storageKey, requestId);
      const selectedBalance = inventory.find(row => row.id === form.inventory_id);
      if (adjust && !selectedBalance) throw new Error('Select a Central Inventory SKU and location.');
      const payload = entity === 'adjustments'
        ? { entity, masterSkuId: selectedBalance!.master_sku_id, locationId: selectedBalance!.location_id, quantity: form.quantity, reason: form.reason, requestId }
        : { entity, ...form, requestId };
      const result = await apiSend<any>('/api/inventory-ops', 'POST', payload);
      pendingRequestId.current = null;
      if (stockChanging) sessionStorage.removeItem(storageKey);
      if (result.status === 'Pending') {
        setMessageType('pending');
        setMessage(`${title} was recorded as Pending. No completed inventory or downstream action is confirmed.`);
      } else {
        setMessageType('ok');
        setMessage(`${title} committed to Central Inventory.`);
      }
      setForm((current) => ({ ...current, quantity: '', reason: '', reference: '' }));
      await load();
    } catch (error) {
      setMessageType('err');
      setMessage(error instanceof Error ? error.message : 'Unable to save this operation. Retry the unchanged stock request to preserve its request ID.');
    }
  };

  const showForm = move || adjust || !['inv-move-history'].includes(operation);
  return <div>
    <PageHeader title={title} breadcrumb={`WMS / ${title}`} actions={<button onClick={() => void load()} className="rounded border bg-white px-3 py-2 text-sm">Refresh</button>} />
    {showForm && <div className="mb-4 rounded border bg-white p-4">
      <div className="grid gap-3 md:grid-cols-4">
        {adjust
          ? <select aria-label="Inventory record" className={cls} value={form.inventory_id} onChange={(event) => setForm({ ...form, inventory_id: event.target.value })}>
            <option value="">Select inventory record</option>
            {inventory.map((row) => <option key={row.id} value={row.id}>{row.sku_code} — {row.warehouse} ({row.available})</option>)}
          </select>
          : <input className={cls} placeholder="SKU Code" value={form.sku_code} onChange={(event) => setForm({ ...form, sku_code: event.target.value })} />}
        {move && <>
          <select aria-label="Source location" className={cls} value={form.from_warehouse} onChange={(event) => setForm({ ...form, from_warehouse: event.target.value })}>
            <option value="">Select source location</option>
            {locations.map((location) => <option key={location.location_code} value={location.location_name}>{location.location_name} ({location.location_code})</option>)}
          </select>
          <select aria-label="Destination location" className={cls} value={form.to_warehouse} onChange={(event) => setForm({ ...form, to_warehouse: event.target.value })}>
            <option value="">Select destination location</option>
            {locations.map((location) => <option key={location.location_code} value={location.location_name}>{location.location_name} ({location.location_code})</option>)}
          </select>
        </>}
        <input className={cls} type="number" min={adjust ? undefined : 1} step="1" placeholder="Quantity" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
        <input className={cls} placeholder="Reason / Reference" value={form.reason || form.reference} onChange={(event) => setForm({ ...form, reason: event.target.value, reference: event.target.value })} />
      </div>
      <button onClick={() => void submit()} className="mt-3 rounded bg-[#2f9e9e] px-4 py-2 text-sm text-white">Save</button>
      {(loadError || (move && locationsError)) && <p role="alert" className="mt-2 text-sm text-rose-600">{loadError || locationsError}</p>}
      {message && <p role="status" className={`mt-2 text-sm ${messageType === 'ok' ? 'text-emerald-700' : messageType === 'pending' ? 'text-amber-700' : 'text-rose-600'}`}>{message}</p>}
      {move && !locationsLoading && !locationsError && locations.length === 0 && <p className="mt-2 text-sm text-slate-600">No active locations are configured. Add a location before moving inventory.</p>}
    </div>}
    {loadError && !showForm && <p role="alert" className="mb-3 text-sm text-rose-600">{loadError}</p>}
    <div className="overflow-auto rounded border bg-white">
      <table className="w-full text-left text-xs">
        <thead><tr className="bg-slate-100">{(rows[0] ? Object.keys(rows[0]) : ['SKU', 'Warehouse', 'Quantity', 'Status', 'Created']).map((key) => <th key={key} className="border-b px-3 py-2">{key}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map((row, index) => <tr key={String(row.id ?? index)}>{Object.keys(row).filter((key) => key !== 'id').map((key) => <td key={key} className="border-b px-3 py-2">{String(row[key] ?? '')}</td>)}</tr>) : <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No records to view</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}
