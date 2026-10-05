/* eslint-disable @typescript-eslint/no-explicit-any -- Delivery search rows contain module-specific fields from existing orders. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { apiGet, apiSend } from '../../lib/api';
import { useDownload } from '../../context/DownloadContext';
import EnquiryScreen from '../EnquiryScreen';
import Shell from '../Shell';
import { Toast } from '../parts';

type Pair = [string, string];
type Catalog = {
  locations: Pair[];
  clients: Pair[];
  channels: string[];
  transporters: Pair[];
  statuses: string[];
  orderTypes: string[];
};

const emptyCatalog: Catalog = {
  locations: [], clients: [], channels: [], transporters: [], statuses: [], orderTypes: [],
};

const exportColumns = [
  ['deliveryInfo', 'Delivery Info'], ['orderNo', 'Order No'], ['extOrderNo', 'External Order No'],
  ['siteLoc', 'Site Location'], ['channelType', 'Channel'], ['status', 'Status'],
  ['transporter', 'Transporter'], ['awpNo', 'Tracking No'], ['manifestNo', 'Manifest No'],
  ['shipDate', 'Ship Date'], ['orderDate', 'Order Date'],
] as const;

export default function DeliveryShipping() {
  const navigate = useNavigate();
  const { requestDownload } = useDownload();
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Catalog>(emptyCatalog);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [searched, setSearched] = useState(false);
  const [pager, setPager] = useState({ page: 0, total: 0, records: 0, pageSize: 50 });
  const [loading, setLoading] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [last, setLast] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    void apiGet<Catalog>('/api/delivery-shipping')
      .then(setMeta)
      .catch((error: Error) => setToast({ msg: error.message, type: 'err' }))
      .finally(() => setCatalogLoaded(true));
  }, []);

  async function search(filters: Record<string, string> = {}, page = 1, size = pager.pageSize) {
    setLast(filters);
    setLoading(true);
    try {
      const result = await apiSend<any>('/api/delivery-shipping', 'POST', {
        action: 'search', REQ_SEARCH_FLAG: true, rows: size, page, sidx: 'orderDate', sord: 'desc',
        orderNo: filters.orderNo || '', externOrderNo: filters.extOrderNo || '',
        orderListExportFull: filters.orderListExportFull || '', status: filters.status || '-1',
        outBoundDeliveryNo: filters.deliveryInfo || '', trackingNo: filters.awpNo || '',
        awbNoListExportFull: filters.awbNoListExportFull || '',
        siteLocation: filters.orderSWLoc || '-1', orderSiteLoc: filters.siteLoc || '-1',
        customerCode: filters.custName || '', orderTypeCode: filters.orderTypeText || '-1',
        manifestNo: filters.manifestNo || '', orderTransporter: filters.transporter || '-1',
        orderTagTmp: filters.orderTagVal || '', clientId: filters.clientId || '-1',
        fromOrderDate: filters.fromOrderDate || '', toOrderDate: filters.toOrderDate || '',
        fromShipDate: filters.fromShipDate || '', toShipDate: filters.toShipDate || '',
        pickListNo: filters.picklistNo || '', channelType: filters.channelType || '-1',
        orderStatus: filters.orderStatusText || '-1', picklistFor: filters.picklistFor || '-1',
        manifest: '-1', currentTab: 'allLi', pigeonHoleId: filters.pigeonHoleId || '',
        lpnNo: filters.lpnNo || '', pickupSlot: filters.pickupSlot || '',
        fullFilledBy: filters.fullFilledBy || '-1', reAssigned: filters.reassigned || '-1',
        oldAwbNo: filters.oldAwbNo || '', extTransporterName: filters.extTransporterName || '',
      });
      setRows(result.gridModel);
      setPager({ page: result.page, total: result.total, records: result.records, pageSize: size });
      setSelected([]);
      setSearched(true);
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Search failed', type: 'err' });
    } finally {
      setLoading(false);
    }
  }

  async function act(action: string) {
    if (action === 'export') {
      if (!rows.length) return setToast({ msg: 'No data found', type: 'err' });
      requestDownload({
        title: 'Delivery Shipping', module: 'delivery-shipping', baseName: 'delivery-shipping',
        data: { columns: exportColumns.map(([, label]) => label), rows: rows.map(row => exportColumns.map(([key]) => row[key] ?? '')) },
      });
      return;
    }
    if (action === 'bulk' || action === 'print') {
      setToast({ msg: action === 'bulk' ? 'Manifest bulk download requires a configured report service.' : 'Picklist printing requires a configured print template.', type: 'err' });
      return;
    }
    try {
      const result = await apiSend<any>('/api/delivery-shipping', 'PUT', { action, ids: selected });
      setToast({ msg: result.jsonMessage, type: 'ok' });
      setSelected([]);
      await search(last);
    } catch (error) {
      setToast({ msg: error instanceof Error ? error.message : 'Action failed', type: 'err' });
    }
  }

  const locationCodes = meta.locations.map(([code]) => code);
  const cols: any[] = [
    { key: 'clientId', label: 'Client', filter: 'select', options: meta.clients.map(([id]) => id) },
    { key: 'deliveryInfo', label: 'Delivery Info' }, { key: 'orderNo', label: 'Order No' },
    { key: 'extOrderNo', label: 'Extern Order No' }, { key: 'obDelNo', label: 'Outbound Delivery No' },
    { key: 'deliveryQTY', label: 'Delivery Qty', filter: 'none' },
    { key: 'siteLoc', label: 'Site Location', filter: 'select', options: locationCodes },
    { key: 'channelType', label: 'Channel', filter: 'select', options: meta.channels },
    { key: 'orderTypeText', label: 'Order Type', filter: 'select', options: meta.orderTypes },
    { key: 'paymentMode', label: 'paymentMode' },
    { key: 'picklistFor', label: 'PickList For', filter: 'select', options: ['RTV', 'SO', 'STO'] },
    { key: 'pickPackFlag', label: 'Pick-Pack Flag' },
    { key: 'orderStatusText', label: 'Order Status', filter: 'select', options: ['Allocated', 'Part Allocated'] },
    { key: 'status', label: 'Status', filter: 'select', options: meta.statuses },
    { key: 'transporter', label: 'Transporter', filter: 'select', options: meta.transporters.map(([, name]) => name) },
    { key: 'extTransporterName', label: 'Ext Transporter Name' },
    { key: 'reassigned', label: 'Re-assigned', filter: 'select', options: ['Yes', 'No'] },
    { key: 'oldAwbNo', label: 'Old Tracking No' }, { key: 'awpNo', label: 'Tracking No' },
    { key: 'pigeonHoleId', label: 'Pigeon Hole' }, { key: 'lpnNo', label: 'LPN' },
    { key: 'weight', label: 'Weight', filter: 'none' }, { key: 'length', label: 'L', filter: 'none' },
    { key: 'breadth', label: 'B', filter: 'none' }, { key: 'height', label: 'H', filter: 'none' },
    { key: 'boxes', label: 'No of Boxes', filter: 'none' }, { key: 'manifestNo', label: 'Manifest No' },
    { key: 'shipDate', label: 'Ship Date' }, { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'picklistNo', label: 'Picklist No' }, { key: 'packDate', label: 'Pack Date' },
    { key: 'orderDate', label: 'Order Date' }, { key: 'pickDate', label: 'Pick Date' },
    { key: 'pickupSlot', label: 'Pickup Slot' }, { key: 'reqShipDates', label: 'Ship by date' },
    { key: 'slaStatus', label: 'SLA Status' }, { key: 'orderTagVal', label: 'OrderTag', filter: 'select', options: [] },
    { key: 'deliveryDate', label: 'Delivery Date' },
    { key: 'orderSWLoc', label: 'Dispatch Loc', filter: 'select', options: locationCodes },
    { key: 'custName', label: 'Customer' }, { key: 'transporterInfo', label: 'Transporter Info' },
    { key: 'vehicleNo', label: 'Vehicle No', filter: 'none' },
    { key: 'extManifestNo', label: 'Ext Manifest No', filter: 'none' },
    { key: 'shipErrorRemarks', label: 'Error Description', filter: 'none' },
    { key: 'sortationDate', label: 'Sortation Date', filter: 'none' },
    { key: 'fullFilledBy', label: 'Fulfilled By', filter: 'select', options: ['Marketplace', 'Self Ship'] },
  ];
  const fields: any[] = advanced ? [
    { key: 'orderListExportFull', label: 'Ext Order No' },
    { key: 'masterOrderNo', label: 'Master Order No' },
    { key: 'awbNoListExportFull', label: 'Tracking No*' },
    { key: 'fromOrderDate', label: 'From Order Date' }, { key: 'toOrderDate', label: 'To Order Date' },
    { key: 'fromShipDate', label: 'From Ship Date' }, { key: 'toShipDate', label: 'To Ship Date' },
  ] : [];

  return <Shell active="wms" breadcrumb="WMS > Order Processing > Delivery Shipping" openScreens={[{ label: 'Delivery Shipping', to: '#' }]}>
    {catalogLoaded && !locationCodes.length && <div className="mb-3 flex items-center justify-between rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <span>No locations configured. Add your first location to process deliveries.</span>
      <button className="font-semibold underline" onClick={() => navigate('/app/m/location-create')}>Add location</button>
    </div>}
    {catalogLoaded && !meta.channels.length && <div className="mb-3 flex items-center justify-between rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <span>No channels configured. Add a channel before connecting a marketplace account.</span>
      <button className="font-semibold underline" onClick={() => navigate('/app/channels')}>Add channel</button>
    </div>}
    {searched && !pager.records && <div className="mb-3 flex items-center justify-between rounded border border-slate-200 bg-white p-3 text-sm text-slate-700">
      <span>No matching deliveries. You can create an order to begin fulfillment.</span>
      <button className="font-semibold text-sky-700 underline" onClick={() => navigate('/app/order-maintenance')}>Create order</button>
    </div>}
    <div role="status" className="mb-3 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Search and export show legacy fulfillment metadata. Picklist generation, pack, manifest request and refetch are disabled until Central Inventory reservations and a verified carrier/provider connector are connected.</div>
    <EnquiryScreen sectionTitle="Delivery Shipping" breadcrumb={[{ label: 'WMS' }, { label: 'Order Processing' }, { label: 'Delivery Shipping' }]}
      cols={cols} fields={fields} rows={rows} loading={loading} remote={pager}
      pageSizes={[5, 10, 15, 20, 30, 40, 50, 100, 200, 500]}
      selectedIds={selected} onSelectionChange={setSelected} onSearch={search}
      emptyText="No deliveries found. Create an order and configure a channel to begin shipping."
      onReset={() => { setRows([]); setSelected([]); setAdvanced(false); setSearched(false); setPager({ page: 0, total: 0, records: 0, pageSize: 50 }); }}
      actionsBeforeResetCount={1}
      actions={[
        { label: 'Advance Search', onClick: () => setAdvanced(value => !value) },
        { label: 'Export', icon: Download, onClick: () => void act('export') },
        { label: 'Bulk Download', onClick: () => void act('bulk') },
        { label: 'Print Picklist', onClick: () => void act('print') },
      ]} />
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </Shell>;
}
