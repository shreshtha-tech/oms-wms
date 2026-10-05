import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import Shell from '../Shell';
import { Btn, Panel, Toast } from '../parts';
import OrderGrid, { GCol } from '../OrderGrid';
import Modal from '../../components/Modal';
import { apiGet, apiSend } from '../../lib/api';

const auditCols: GCol[] = [
  { key: 'source_delivery', label: 'Outbound Delivery' },
  { key: 'new_delivery', label: 'New Outbound Delivery' },
  { key: 'order_no', label: 'Order No' },
  { key: 'sku_code', label: 'SKU Code' },
  { key: 'split_qty', label: 'Split Qty' },
  { key: 'remaining_qty', label: 'Remaining Qty' },
  { key: 'modified_by', label: 'Modified By' },
  { key: 'modified_date', label: 'Modified Date' },
  { key: 'trust', label: 'Record Trust' },
];

export default function DeliverySplit() {
  const [meta, setMeta] = useState<any>({ deliveries: [] });
  const [outDelNo, setOutDelNo] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 20 });
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState(false);
  const [audit, setAudit] = useState<any[] | null>(null);
  const [toast, setToast] = useState<any>(null);

  useEffect(() => {
    apiGet('/api/delivery-split')
      .then(setMeta)
      .catch(() => setToast({ msg: 'Unable to load Delivery Split', type: 'err' }));
  }, []);

  async function search(page = 1, size = pager.pageSize) {
    setLoading(true);
    try {
      const result: any = await apiSend('/api/delivery-split', 'POST', {
        action: 'search', outDelNo, rows: size, page, sidx: 'orderNo', sord: 'asc',
      });
      setRows(result.rowDTOListFromUpdate);
      setStatus(result.outboundP.status);
      setPager({ page: result.page, total: result.total, records: result.records, pageSize: size });
    } catch (error: any) {
      setRows([]);
      setStatus('');
      setToast({ msg: error.message, type: 'err' });
    } finally {
      setLoading(false);
    }
  }

  async function showAudit() {
    try {
      const result: any = await apiSend('/api/delivery-split', 'POST', { action: 'audit', outDelNo });
      setAudit(result.rows);
    } catch (error: any) {
      setToast({ msg: error.message, type: 'err' });
    }
  }

  function reset() {
    setOutDelNo('');
    setStatus('');
    setRows([]);
    setPager({ page: 0, total: 0, records: 0, pageSize: 20 });
    setToast(null);
  }

  const cols: GCol[] = [
    ['obCode', 'Outbound Del No'], ['orderNo', 'Order No'], ['externOrderNo', 'Ext Order No'],
    ['orderTypeText', 'Order Type'], ['orderTypeCode', 'orderTypeCode'], ['sku', 'SKU Code'],
    ['displaySku', 'SKU Code'], ['uomCode', 'uomCode'], ['skuDesc', 'SKU Desc'], ['uomDesc', 'Uom'],
    ['qty', 'Quantity'], ['fromId', 'FromId'], ['toId', 'ToId'], ['statusText', 'Status'],
    ['statusCode', 'statusCode'], ['lineno', 'lineno'], ['uniqueLineNo', 'uniqueLineNo'],
    ['hasDecimal', 'hasDecimal'], ['fromBin', 'From Bin'], ['lot', 'Lot'],
    ['scannedUniqueNo', 'Scanned Unique'], ['selectedSerialNo', 'IMEI No'], ['inDate', 'In Date'],
    ['serialLineNo', 'Serail Line No'], ['sortationBy', 'sortationBy'], ['sortationDate', 'sortationDate'],
    ['cntRowAs1Qty', 'cntRowAs1Qty'],
  ].map(([key, label]) => ({ key, label }));

  return (
    <Shell active="wms" breadcrumb="WMS > Order Processing > Delivery Split" openScreens={[{ label: 'Delivery Split', to: '#' }]}>
      <div className="mb-2 flex justify-end">
        <Btn variant="ghost" onClick={() => void showAudit()}>Audit</Btn>
      </div>
      <Panel title="Delivery Split">
        <div role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Delivery splitting is unavailable until Central Inventory supports an atomic order-line split and fulfillment reservation. This screen is read-only; it will not change order quantities or create a new delivery. Search results come from legacy fulfillment records, not authoritative inventory balances.
        </div>
        <div className="grid items-end gap-3 md:grid-cols-[minmax(260px,1fr)_auto_auto_auto]">
          <label className="text-xs text-slate-600">
            Outbound Del No
            <input aria-label="Outbound Del No" className="inp mt-1" value={outDelNo} onChange={event => setOutDelNo(event.target.value)} onKeyDown={event => event.key === 'Enter' && void search()} />
          </label>
          <Btn variant="ghost" onClick={() => setPicker(true)}>...</Btn>
          <Btn onClick={() => void search()}><Search size={14} /> Search</Btn>
          <Btn variant="ghost" onClick={reset}>Reset</Btn>
        </div>
        {status && (
          <div className="mt-4 grid gap-3 rounded border bg-slate-50 p-3 text-sm md:grid-cols-2">
            <span>Outbound Del No<br /><b>{outDelNo}</b></span>
            <span>Current status<br /><b>{status}</b></span>
          </div>
        )}
        <OrderGrid cols={cols} rows={rows} loading={loading} empty="No records to view" />
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>{pager.records ? `View ${(pager.page - 1) * pager.pageSize + 1} - ${Math.min(pager.page * pager.pageSize, pager.records)} of ${pager.records}` : 'No records to view'}</span>
          <label>Records per Page <select aria-label="Records per Page" value={pager.pageSize} onChange={event => void search(1, +event.target.value)} className="rounded border px-2 py-1">{[20, 50, 100, 200].map(size => <option key={size}>{size}</option>)}</select></label>
        </div>
      </Panel>
      <Modal title="Select Outbound Delivery" open={picker} onClose={() => setPicker(false)} wide>
        <OrderGrid cols={[
          { key: 'outDelNo', label: 'Outbound Del No' }, { key: 'orderNo', label: 'Order No' },
          { key: 'status', label: 'Status' }, { key: 'skuCode', label: 'SKU Code' }, { key: 'qty', label: 'Quantity' },
          { key: 'pick', label: '', render: (row: any) => <Btn onClick={() => { setOutDelNo(row.outDelNo); setPicker(false); }}>Select</Btn> },
        ]} rows={meta.deliveries || []} empty="No outbound deliveries" />
      </Modal>
      <Modal title="Delivery Split Audit" open={audit !== null} onClose={() => setAudit(null)} wide>
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Legacy split audit rows are unverified and do not prove a Central Inventory transaction or physical stock movement.</p>
        <OrderGrid cols={auditCols} rows={audit || []} empty="No audit records" />
      </Modal>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </Shell>
  );
}
