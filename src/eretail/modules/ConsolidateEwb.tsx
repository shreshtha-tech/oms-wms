import { useEffect, useState } from 'react';
import Shell from '../Shell';
import EnquiryScreen from '../EnquiryScreen';
import OrderGrid, { GCol } from '../OrderGrid';
import Modal from '../../components/Modal';
import { apiGet, apiSend } from '../../lib/api';
import { Toast } from '../parts';

type Tab = 'generate' | 'history';

export default function ConsolidateEwb() {
  const [meta, setMeta] = useState<any>({});
  const [tab, setTab] = useState<Tab>('generate');
  const [rows, setRows] = useState<any[]>([]);
  const [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 20 });
  const [loading, setLoading] = useState(false);
  const [deliveries, setDeliveries] = useState<any[] | null>(null);
  const [toast, setToast] = useState<any>(null);

  useEffect(() => {
    apiGet('/api/consolidate-ewb')
      .then(setMeta)
      .catch((error: Error) => setToast({ msg: error.message || 'Unable to load Consolidate EWB', type: 'err' }));
  }, []);

  async function search(filters: any = {}, page = 1, size = pager.pageSize, nextTab = tab) {
    setLoading(true);
    try {
      const result: any = await apiSend('/api/consolidate-ewb', 'POST', {
        action: 'search', REQ_SEARCH_FLAG: true, tab: nextTab, rows: size, page,
        sidx: nextTab === 'generate' ? 'updDate' : 'crtDate', sord: 'desc', ...filters,
      });
      setRows(result.transmitLogDTOs);
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
    setPager({ page: 0, total: 0, records: 0, pageSize: 20 });
    setToast(null);
  }

  function change(next: Tab) {
    setTab(next);
    reset();
    void search({}, 1, 20, next);
  }

  async function viewDeliveries(row: any) {
    try {
      const result: any = await apiSend('/api/consolidate-ewb', 'POST', {
        action: 'deliveries', id: row.id, cewbNo: row.cewbNo,
      });
      setDeliveries(result.transmitLogDTOs);
    } catch (error: any) {
      setToast({ msg: error.message, type: 'err' });
    }
  }

  const generateCols: any[] = [
    { key: 'integrationType', label: 'Integration Type', filter: 'select', options: meta.integrationTypes || [] },
    { key: 'updDate', label: 'Txn Date' }, { key: 'documentNo', label: 'Invoice No' },
    { key: 'referenceNo', label: 'Delivery No' }, { key: 'referenceNo2', label: 'Order No' },
    { key: 'vehicleNo', label: 'Vehicle No' }, { key: 'ewbNo', label: 'E-way Bill' },
    { key: 'ewbValidity', label: 'EWB Validity', filter: 'none' },
    { key: 'referenceType', label: 'Ref Type', filter: 'select', options: ['SO', 'STO', 'RTV'] },
    { key: 'isCewbGenerated', label: 'CEWB Generated', filter: 'select', options: ['Yes', 'No'] },
    { key: 'consolidateEwbNo', label: 'CEWB No' },
  ];
  const historyCols: any[] = [
    { key: 'cewbNo', label: 'CEWB No' }, { key: 'cewbVehicleNo', label: 'Vehicle No' },
    { key: 'transMode', label: 'Mode of Transport', filter: 'select', options: ['Road', 'Rail', 'Air', 'Ship'] },
    { key: 'trust', label: 'Record Trust' },
    { key: 'viewDeliveries', label: 'Linked Delivery', filter: 'none', render: (row: any) => <button className="font-semibold text-sky-700 underline" onClick={() => void viewDeliveries(row)}>View Deliveries</button> },
  ];
  const deliveryCols: GCol[] = [
    { key: 'documentNo', label: 'Document Number' }, { key: 'referenceNo', label: 'Reference No' },
    { key: 'ewbNo', label: 'E-way Bill' },
  ];

  return (
    <Shell active="wms" breadcrumb="WMS > Order Processing > Consolidate EWB" openScreens={[{ label: 'Consolidate EWB', to: '#' }]}>
      <div role="status" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        CEWB generation and regeneration are unavailable until a verified government e-way bill connector can create and read back the document. Existing rows are legacy and unverified; this screen is read-only.
      </div>
      <div className="mb-3 flex border-b bg-white">
        <button onClick={() => change('generate')} className={`px-4 py-3 text-sm ${tab === 'generate' ? 'border-b-2 border-cyan-600 font-semibold text-cyan-700' : 'text-slate-600'}`}>Generate CEWB</button>
        <button onClick={() => change('history')} className={`px-4 py-3 text-sm ${tab === 'history' ? 'border-b-2 border-cyan-600 font-semibold text-cyan-700' : 'text-slate-600'}`}>Re-generate/View CEWB</button>
      </div>
      <EnquiryScreen
        sectionTitle={tab === 'generate' ? 'Generate CEWB' : 'Re-generate/View CEWB'}
        breadcrumb={[{ label: 'WMS' }, { label: 'Order Processing' }, { label: 'Consolidate EWB' }]}
        cols={tab === 'generate' ? generateCols : historyCols} rows={rows} loading={loading} remote={pager}
        pageSizes={[20, 50, 100, 200]} onSearch={search} onReset={reset} actions={[]}
      />
      <Modal title="Linked Deliveries (Legacy Record)" open={deliveries !== null} onClose={() => setDeliveries(null)} wide>
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">These stored links are unverified and do not establish a government CEWB response.</p>
        <OrderGrid cols={deliveryCols} rows={deliveries || []} empty="No records to view" />
      </Modal>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </Shell>
  );
}
