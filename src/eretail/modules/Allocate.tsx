import { useEffect, useState } from 'react';
import { Download, Search, Upload } from 'lucide-react';
import Modal from '../../components/Modal';
import { apiGet, apiSend } from '../../lib/api';
import EnquiryScreen from '../EnquiryScreen';
import Shell from '../Shell';
import { Btn, Toast } from '../parts';

function downloadCsv(rows: any[]) {
  const columns = [
    ['Client', 'clientId'], ['Order No', 'orderNo'], ['Ext Order No', 'fromExternOrderNo'],
    ['Status', 'status'], ['Order Date', 'orderDate'], ['SKU', 'skuCode'], ['Line Qty', 'lineQty'],
    ['Open Qty', 'openQty'], ['Line Amount', 'lineAmount'], ['Line No', 'lineNo'],
    ['Site Location', 'siteLocation'], ['Customer Name', 'customerCode'], ['Order Type', 'orderType'],
    ['Order Qty', 'orderQty'], ['On Hold', 'holdFlag'], ['Record Trust', 'trust'],
  ];
  const csv = [columns.map(([label]) => label), ...rows.map(row => columns.map(([, key]) => row[key] ?? ''))]
    .map(values => values.map(value => {
      const raw = String(value);
      const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'order-allocation-legacy-unverified.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export default function Allocate() {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>({ locations: [], clients: [] });
  const [pager, setPager] = useState({ page: 1, total: 0, records: 0, pageSize: 50 });
  const [loading, setLoading] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [orderText, setOrderText] = useState('');
  const [notice, setNotice] = useState<any>(null);

  useEffect(() => {
    apiGet('/api/order-allocation')
      .then(setMeta)
      .catch((error: Error) => setNotice({ msg: error.message || 'Unable to load allocation enquiry', type: 'err' }));
    void search({}, 1, 50);
  }, []);

  async function search(filters: any = {}, page = 1, size = pager.pageSize) {
    setLoading(true);
    try {
      const result: any = await apiSend('/api/order-allocation', 'POST', {
        action: 'search', REQ_SEARCH_FLAG: true, rows: size, page, sidx: 'orderNo', sord: 'asc',
        siteLocation: filters.siteLocation || '-1', fromMagentoOrderNo: filters.fromExternOrderNo || '',
        fromOrderNo: filters.orderNo || '', onHold: filters.holdFlag || '-1', orderType: filters.orderType || '-1',
        fromOrderDate: filters.fromOrderDate || '', toOrderDate: filters.toOrderDate || '',
        status: filters.status || '', skuCode: filters.skuCode || '', customerName: filters.customerCode || '',
        customerEmail: filters.customerEmail || '', customerPh: filters.customerPh || '', clientId: filters.clientId || '',
        filteredOrderArr: filters.filteredOrderArr || '', searchType: false, sku: filters.skuCode || '',
      });
      setRows(result.gridModel);
      setPager({ page: result.page, total: result.total, records: result.records, pageSize: size });
    } catch (error: any) {
      setRows([]);
      setNotice({ msg: error.message, type: 'err' });
    } finally {
      setLoading(false);
    }
  }

  async function findOrders() {
    try {
      const orders = orderText.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      const result: any = await apiSend('/api/order-allocation', 'POST', { action: 'import', orders });
      setRows(result.rows || []);
      setPager({ page: 1, total: 1, records: (result.rows || []).length, pageSize: pager.pageSize });
      setNotice({ msg: result.notFound?.length ? `Found ${(result.rows || []).length}; not found: ${result.notFound.join(', ')}` : `Found ${(result.rows || []).length} legacy order row(s). No allocation was performed.`, type: result.notFound?.length ? 'err' : 'ok' });
      setSearchOpen(false);
    } catch (error: any) {
      setNotice({ msg: error.message, type: 'err' });
    }
  }

  const cols: any[] = [
    { key: 'clientId', label: 'Client', filter: 'select', options: (meta.clients || []).map((row: any) => row[1]) },
    { key: 'orderNo', label: 'Order No' }, { key: 'fromExternOrderNo', label: 'Ext Order No' },
    { key: 'status', label: 'Status', filter: 'select', options: ['Part Allocated', 'Allocated', 'Part Picked', 'Pick complete', 'Partially Shipped', 'Confirmed'] },
    { key: 'orderDate', label: 'Order Date' }, { key: 'skuCode', label: 'SKU' },
    { key: 'lineQty', label: 'Line Qty', filter: 'none' }, { key: 'openQty', label: 'Open Qty', filter: 'none' },
    { key: 'lineAmount', label: 'Line Amount', filter: 'none' }, { key: 'lineNo', label: 'Line No', filter: 'none' },
    { key: 'siteLocation', label: 'Site Location', filter: 'select', options: (meta.locations || []).slice(1).map((row: any) => row[1]) },
    { key: 'customerCode', label: 'Customer Name' },
    { key: 'orderType', label: 'Order Type', filter: 'select', options: ['Normal', 'Cash On Delivery', 'Prepaid', 'COD'] },
    { key: 'orderQty', label: 'Order Qty', filter: 'none' },
    { key: 'holdFlag', label: 'On Hold', filter: 'select', options: ['Yes', 'No'] },
    { key: 'trust', label: 'Record Trust', filter: 'none' },
  ];
  const fields = advanced ? [
    { key: 'customerEmail', label: 'Customer Email' }, { key: 'customerPh', label: 'Customer Phone' },
    { key: 'filteredOrderArr', label: 'Multiple Order No. (comma separated)' },
    { key: 'fromOrderDate', label: 'From Order Date' }, { key: 'toOrderDate', label: 'To Order Date' },
  ] : [];
  const actions = [
    { label: 'Advance Search', onClick: () => setAdvanced(value => !value) },
    { label: 'Find Orders', icon: Search, onClick: () => setSearchOpen(true) },
    { label: 'Export CSV', icon: Download, onClick: () => rows.length ? downloadCsv(rows) : setNotice({ msg: 'No data found', type: 'err' }) },
  ];

  return (
    <Shell active="wms" breadcrumb="WMS > Order Processing > Order Allocate/Unallocate" openScreens={[{ label: 'Order Allocate/Unallocate', to: '#' }]}>
      <div role="status" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        This screen reads legacy fulfillment rows only. Allocate, UnAllocate, and Close SO are disabled until Central Inventory can reserve and release order lines. No stock or order status changes are available here.
      </div>
      <EnquiryScreen
        sectionTitle="Order Allocate/Unallocate" breadcrumb={[{ label: 'WMS' }, { label: 'Order Processing' }, { label: 'Order Allocate/Unallocate' }]}
        cols={cols} fields={fields} rows={rows} loading={loading} remote={pager}
        pageSizes={[50, 100, 200]} onSearch={search}
        onReset={() => { setAdvanced(false); void search({}, 1, 50); }}
        actionsBeforeResetCount={1} actions={actions}
      />
      <Modal title="Find Order Numbers (Read Only)" open={searchOpen} onClose={() => setSearchOpen(false)}>
        <p className="mb-2 text-xs text-slate-600">Enter up to 100 order numbers to find matching legacy rows. This does not allocate them.</p>
        <textarea aria-label="Find Order Numbers" className="inp mt-2 h-40" value={orderText} onChange={event => setOrderText(event.target.value)} placeholder={'orderno1\norderno2'} />
        <div className="mt-3 flex justify-end gap-2"><Btn onClick={() => void findOrders()}>Find</Btn><Btn variant="ghost" onClick={() => setSearchOpen(false)}>Close</Btn></div>
      </Modal>
      {notice && <Toast {...notice} onClose={() => setNotice(null)} />}
    </Shell>
  );
}
