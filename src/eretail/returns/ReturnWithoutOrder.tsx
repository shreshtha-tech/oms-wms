/* eslint-disable @typescript-eslint/no-explicit-any -- Existing return records have variable SKU attributes. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDownload } from '../../context/DownloadContext';
import { apiGet, apiSend } from '../../lib/api';
import Shell from '../Shell';
import { Btn, Toast } from '../parts';

type Meta = { reasons: [string, string][]; columns: string[]; maxSkus: number };
const blank = () => ({ customerCode: '', clientId: '', lpn: '', sku: '', qty: '1', reason: '', remarks: '' });
const inputClass = 'inp mt-1';

export default function ReturnWithoutOrder() {
  const navigate = useNavigate();
  const { requestDownload } = useDownload();
  const [meta, setMeta] = useState<Meta>({ reasons: [], columns: [], maxSkus: 200 });
  const [form, setForm] = useState(blank);
  const [customerOk, setCustomerOk] = useState(false);
  const [document, setDocument] = useState<any>(null);
  const [newReason, setNewReason] = useState('');
  const [notice, setNotice] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const locked = Boolean(document && document.status !== 'Open');

  useEffect(() => {
    void apiGet<Meta>('/api/return-without-order').then(setMeta)
      .catch((error: Error) => setNotice({ msg: error.message, type: 'err' }));
  }, []);
  const set = (key: keyof ReturnType<typeof blank>, value: string) => setForm(previous => ({ ...previous, [key]: value }));

  async function lookupCustomer() {
    try {
      const result = await apiSend<any>('/api/return-without-order', 'POST', { action: 'customer', custCode: form.customerCode });
      setForm(previous => ({ ...previous, customerCode: result.map.CustCode, clientId: result.map.ClientId }));
      setCustomerOk(true);
    } catch (error) {
      setNotice({ msg: error instanceof Error ? error.message : 'Customer lookup failed', type: 'err' });
    }
  }

  async function addReason() {
    try {
      const result = await apiSend<any>('/api/return-without-order', 'POST', { action: 'create-reason', name: newReason });
      setMeta(previous => ({ ...previous, reasons: result.reasons }));
      setForm(previous => ({ ...previous, reason: result.code }));
      setNewReason('');
      setNotice({ msg: 'Return reason added.', type: 'ok' });
    } catch (error) {
      setNotice({ msg: error instanceof Error ? error.message : 'Unable to add reason', type: 'err' });
    }
  }

  async function scan() {
    if ((document?.lines?.length || 0) >= meta.maxSkus) return setNotice({ msg: `A return may contain at most ${meta.maxSkus} SKU lines.`, type: 'err' });
    setBusy(true);
    try {
      const result = await apiSend<any>('/api/return-without-order', 'POST', {
        action: 'scan', custCode: form.customerCode, scannedSkuCode: form.sku,
        scannQty: form.qty, reason: form.reason, lpn: form.lpn, returnNo: document?.returnCode || '',
      });
      setDocument(result);
      setForm(previous => ({ ...previous, sku: '', lpn: '', qty: '1' }));
    } catch (error) {
      setNotice({ msg: error instanceof Error ? error.message : 'Unable to scan SKU', type: 'err' });
    } finally {
      setBusy(false);
    }
  }

  async function action(kind: 'confirm' | 'cancel') {
    if (!document || !window.confirm(`Do you really want to ${kind}?`)) return;
    try {
      const result = await apiSend<any>('/api/return-without-order', 'POST', { action: kind, returnNo: document.returnCode, remarks: form.remarks });
      setDocument(result);
      if (kind === 'confirm' && result.workflowNotice) setNotice({ msg: result.workflowNotice, type: 'ok' });
    } catch (error) {
      setNotice({ msg: error instanceof Error ? error.message : `Unable to ${kind} return`, type: 'err' });
    }
  }

  async function remove(id: number) {
    try {
      const lineIds = document.lines.filter((line: any) => line.id !== id).map((line: any) => line.id);
      setDocument(await apiSend<any>('/api/return-without-order', 'POST', { action: 'updateLines', returnNo: document.returnCode, lineIds }));
    } catch (error) {
      setNotice({ msg: error instanceof Error ? error.message : 'Unable to remove SKU', type: 'err' });
    }
  }

  function print() {
    if (!document) return;
    requestDownload({ title: `Customer Return ${document.returnCode}`, module: 'return-without-order',
      baseName: `return-${document.returnCode}`, formats: ['pdf'],
      data: { columns: ['Return No', 'Customer Code', 'SKU Code', 'Quantity', 'Reason', 'Unit Price', 'Line Amount', 'Status'],
        rows: document.lines.map((line: any) => [document.returnCode, document.customerCode, line.skuCode, line.returnQty, line.reason, line.unitPrice, line.lineamount, document.status]) } });
  }

  function reset() { setForm(blank()); setCustomerOk(false); setDocument(null); setNotice(null); }
  return <Shell active="returns" breadcrumb="RETURNS & TRANSFERS > Returns > Return Without Order" openScreens={[{ label: 'Return Without Order', to: '#' }]}>
    <div className="border bg-white">
      <p role="note" className="border-b border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">This screen records a return without an order. Confirm changes the document status only; it does not receive, inspect, or restock goods in Central Inventory.</p>
      <div className="flex justify-end gap-2 border-b p-3">
        {document && <><Btn onClick={() => void action('confirm')} disabled={locked}>Confirm</Btn><Btn variant="ghost" onClick={reset}>Reset</Btn><Btn variant="ghost" onClick={() => void action('cancel')} disabled={locked}>Cancel</Btn><Btn variant="ghost" onClick={print}>Print</Btn></>}
      </div>
      <fieldset className="m-3 border p-3"><legend className="px-2 text-sm font-semibold">Return Without Order</legend>
        <div className="flex max-w-xl items-end gap-2"><label className="flex-1 text-sm">Customer Code
          <input aria-label="Customer Code" className={inputClass} readOnly={customerOk} value={form.customerCode} onChange={event => set('customerCode', event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void lookupCustomer(); } }} />
        </label>{!customerOk && <Btn onClick={() => void lookupCustomer()}>Find Customer</Btn>}</div>
        {!customerOk && <p className="mt-2 text-xs text-slate-500">Enter a configured customer code. <button className="text-sky-700 underline" onClick={() => navigate('/app/customers')}>Add customer</button></p>}
      </fieldset>
      {customerOk && !locked && <fieldset className="m-3 border p-3"><legend className="px-2 text-sm font-semibold">Scan SKU</legend>
        <div className="grid gap-3 md:grid-cols-5">
          <label className="text-xs">LPN<input aria-label="LPN" className={inputClass} value={form.lpn} onChange={event => set('lpn', event.target.value)} /></label>
          <label className="text-xs">Scan SKU<input aria-label="Scan SKU" className={inputClass} value={form.sku} onChange={event => set('sku', event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void scan(); } }} /></label>
          <label className="text-xs">Qty<input aria-label="Qty" type="number" min="0.001" step="any" className={inputClass} value={form.qty} onChange={event => set('qty', event.target.value)} /></label>
          <label className="text-xs">Reason<select aria-label="Reason" className={inputClass} value={form.reason} onChange={event => set('reason', event.target.value)}><option value="">Select reason</option>{meta.reasons.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <div className="self-end"><Btn onClick={() => void scan()} disabled={busy}>Scan</Btn></div>
        </div>
        <div className="mt-3 flex items-end gap-2"><label className="text-xs">New return reason<input aria-label="New return reason" className={inputClass} value={newReason} onChange={event => setNewReason(event.target.value)} /></label><Btn variant="ghost" onClick={() => void addReason()}>Add Reason</Btn></div>
        {!meta.reasons.length && <p className="mt-2 text-xs text-slate-500">Add a return reason before scanning. SKUs are configured in <button className="text-sky-700 underline" onClick={() => navigate('/app/skus')}>SKU Master</button>.</p>}
      </fieldset>}
      {document && <><div className="overflow-auto border-y"><table className="min-w-[1400px] w-full text-xs"><thead><tr>{meta.columns.map(column => <th className="border p-2" key={column}>{column}</th>)}</tr></thead><tbody>{document.lines.map((line: any) => <tr key={line.id}>
        <td className="border p-2"><b>{line.displaySku}</b><br />{line.skuDesc}</td><td className="border p-2">{line.skuImgUrlToShow ? <img src={line.skuImgUrlToShow} alt="SKU" className="h-14" /> : 'No image'}</td>
        <td className="border p-2">{line.returnQty}</td><td className="border p-2">{line.lpn}</td><td className="border p-2">{line.attributes}<br />{line.barCode && `Barcode ${line.barCode}`}<br />UOM {line.uomName}</td>
        <td className="border p-2">{Number(line.unitPrice).toFixed(2)}</td><td className="border p-2">{Number(line.lineamount).toFixed(2)}</td><td className="border p-2">{line.reason}</td>
        <td className="border p-2">{line.orderNo}</td><td className="border p-2">{line.delNOs}</td><td className="border p-2">{!locked && <button className="text-rose-600" onClick={() => void remove(line.id)}>Delete</button>}</td>
      </tr>)}</tbody></table></div>
        <div className="grid gap-3 p-3 md:grid-cols-4"><label className="text-xs">Remarks<textarea aria-label="Remarks" className={inputClass} disabled={locked} value={form.remarks || document.remarks || ''} onChange={event => set('remarks', event.target.value)} /></label>
          <div className="text-sm"><b>Return No</b><br />{document.returnCode}</div><div className="text-sm"><b>Return Qty</b><br />{document.returnQty}</div><div className="text-sm"><b>Return Amt</b><br />{Number(document.returnAmount).toFixed(2)}</div>
          <div className="text-sm"><b>Return Date</b><br />{document.createDateText}</div><div className="text-sm"><b>Status</b><br />{document.status}</div>{document.inboundNo && <div className="text-sm"><b>Inbound No</b><br />{document.inboundNo}</div>}
        </div></>}
      {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
    </div>
  </Shell>;
}
