import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import Shell from '../Shell';
import EnquiryScreen from '../EnquiryScreen';
import { apiGet, apiSend } from '../../lib/api';
import { Toast } from '../parts';

type Tab = 'pending' | 'history';

export default function OrderAcknowledgement() {
  const [meta, setMeta] = useState<any>({});
  const [tab, setTab] = useState<Tab>('pending');
  const [rows, setRows] = useState<any[]>([]);
  const [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 100 });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<any>(null);

  useEffect(() => {
    apiGet('/api/order-acknowledgement')
      .then(setMeta)
      .catch((error: Error) => setToast({ msg: error.message || 'Unable to load Order Acknowledgement', type: 'err' }));
  }, []);

  async function search(filters: any = {}, page = 1, size = pager.pageSize, nextTab = tab) {
    setLoading(true);
    try {
      const result: any = await apiSend('/api/order-acknowledgement', 'POST', {
        action: 'search', REQ_SEARCH_FLAG: true, tab: nextTab, rows: size, page,
        sidx: 'updDate', sord: 'desc', extOrderNo: filters.extOrderNo || '',
        orderNo: filters.orderNo || '', channelName: filters.channelName || '',
        orderType: filters.orderType || '', fromOrderDate: filters.fromOrderDate || '',
        toOrderDate: filters.toOrderDate || '', skuCode: filters.skuCode || '',
      });
      setRows(result.gridModel);
      setPager({ page: result.page, total: result.total, records: result.records, pageSize: size });
    } catch (error: any) {
      setRows([]);
      setToast({ msg: error.message, type: 'err' });
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setRows([]);
    setPager({ page: 0, total: 0, records: 0, pageSize: 100 });
    setToast(null);
  }

  function changeTab(next: Tab) {
    setTab(next);
    reset();
    void search({}, 1, 100, next);
  }

  const cols: any[] = [
    { key: 'extOrderNo', label: 'Ext Order No' }, { key: 'orderNo', label: 'Order No' },
    { key: 'channelName', label: 'Channel Name', filter: 'select', options: meta.channels || [] },
    { key: 'orderType', label: 'Order Type', filter: 'select', options: meta.orderTypes || [] },
    { key: 'orderDate', label: 'Order Date' }, { key: 'skuCode', label: 'SKU Code' },
    { key: 'skuDesc', label: 'SKU Desc' }, { key: 'walkinLocation', label: 'Walkin Location' },
    { key: 'fulfillmentLocation', label: 'Fulfillment Location' }, { key: 'orderQty', label: 'Order Qty' },
    { key: 'lineNo', label: 'Line No' }, { key: 'lineAmount', label: 'Line Amount' },
    { key: 'image', label: 'Image', filter: 'none', render: (row: any) => row.image ? <img src={row.image} alt="SKU" className="h-9 w-9 object-cover" /> : '' },
    { key: 'customerAddress', label: 'Customer Address' }, { key: 'lot', label: 'Lot' }, { key: 'udfs', label: 'UDFs' },
    ...(tab === 'history' ? [
      { key: 'ackStatus', label: 'Acknowledgement Status' }, { key: 'acknowledgedBy', label: 'Acknowledged By' },
      { key: 'acknowledgedDate', label: 'Acknowledged Date' }, { key: 'rejectionReason', label: 'Rejection Reason' },
      { key: 'rejectionRemarks', label: 'Rejection Remarks' }, { key: 'trust', label: 'Record Trust' },
    ] : []),
  ];

  const actions = [{
    label: 'Export', icon: Download,
    onClick: () => {
      if (!rows.length) {
        setToast({ msg: 'No Data In Grid To Export', type: 'err' });
        return;
      }
      const columns = cols.filter(column => column.key !== 'image');
      const csv = [columns.map(column => column.label), ...rows.map(row => columns.map(column => row[column.key] ?? ''))]
        .map(values => values.map(value => {
          const raw = String(value);
          const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
          return `"${safe.replaceAll('"', '""')}"`;
        }).join(',')).join('\r\n') + '\r\n';
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `order-acknowledgement-${tab}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },
  }];

  return (
    <Shell active="wms" breadcrumb="WMS > Order Processing > Order Acknowledgement" openScreens={[{ label: 'Order Acknowledgement', to: '#' }]}>
      <div role="status" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        Provider acknowledgement is unavailable until an authenticated channel connector can submit and verify responses. Rows and existing history are legacy records; Accept and Reject are disabled.
      </div>
      <div className="mb-3 flex border-b bg-white">
        <button onClick={() => changeTab('pending')} className={`px-4 py-3 text-sm ${tab === 'pending' ? 'border-b-2 border-cyan-600 font-semibold text-cyan-700' : 'text-slate-600'}`}>Pending Acknowledgement ({meta.counts?.pending || 0})</button>
        <button onClick={() => changeTab('history')} className={`px-4 py-3 text-sm ${tab === 'history' ? 'border-b-2 border-cyan-600 font-semibold text-cyan-700' : 'text-slate-600'}`}>Acknowledgement History ({meta.counts?.history || 0})</button>
      </div>
      <EnquiryScreen
        sectionTitle={tab === 'pending' ? 'Pending Acknowledgement' : 'Acknowledgement History'}
        breadcrumb={[{ label: 'WMS' }, { label: 'Order Processing' }, { label: 'Order Acknowledgement' }]}
        cols={cols} fields={[]} rows={rows} loading={loading} remote={pager}
        pageSizes={[20, 50, 100, 200]} onSearch={search} onReset={reset} actions={actions}
      />
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </Shell>
  );
}
