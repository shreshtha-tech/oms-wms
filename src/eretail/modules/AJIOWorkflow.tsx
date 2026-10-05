/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState } from 'react';
import { Download, FileText, PackageCheck, Play, RefreshCw, Save, ScanLine, Split, Truck } from 'lucide-react';
import Shell from '../Shell';
import { Btn, Pill, Toast } from '../parts';
import Modal from '../../components/Modal';
import { apiGet, apiSend } from '../../lib/api';
import { useActiveLocations } from '../../hooks/useActiveLocations';

const TABS = [
  ['configuration', '1. Channel Maintenance'], ['catalog', '2. Product & Inventory'], ['backorders', '3. Backorder Pull'],
  ['orders', '4. PO & Order Creation'], ['picking', '5a. Manage Picking'], ['packing', '5b. Order Packing'], ['shipment', '6. Order Shipment'],
] as const;
const input = 'w-full rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-cyan-500 disabled:bg-slate-100 disabled:text-slate-400';
const Th = ({ children }: { children?: React.ReactNode }) => <th className="border-r border-slate-300 bg-[#e7edf2] px-2 py-2 text-left text-[11px] font-semibold text-slate-600">{children}</th>;
const Td = ({ children }: { children?: React.ReactNode }) => <td className="border-r border-t border-slate-200 px-2 py-2 text-xs text-slate-600">{children}</td>;
const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => <label className="grid grid-cols-[170px_minmax(0,1fr)] items-center gap-3 text-xs text-slate-500"><span className="text-right">{label}{required && <b className="text-rose-500"> *</b>}</span>{children}</label>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border border-slate-300 bg-white"><h2 className="border-b-4 border-cyan-600 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">{title}</h2><div className="p-4">{children}</div></section>;
}

export default function AJIOWorkflow() {
  const { locations, loading: locationsLoading } = useActiveLocations();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('configuration');
  const [data, setData] = useState<any>({ config: {}, mappings: [], backorders: [], orders: [], deliveries: [], invoices: [], manifests: [], skus: [] });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<number[]>([]); const [selectedDeliveries, setSelectedDeliveries] = useState<number[]>([]);
  const [activeDeliveryId, setActiveDeliveryId] = useState<number | ''>('');
  const [scan, setScan] = useState({ lpn: '', sku_code: '', qty: 1 }); const [password, setPassword] = useState('');
  const [configureInterface, setConfigureInterface] = useState(false); const [eInvoicePassword, setEInvoicePassword] = useState('');
  const [mappingSku, setMappingSku] = useState<Record<number, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [config, mappings, backorders, orders, deliveries, invoices, manifests, skus] = await Promise.all([
        apiGet<any[]>('/api/ajio?entity=config'), apiGet<any[]>('/api/ajio?entity=mappings'), apiGet<any[]>('/api/ajio?entity=backorders'),
        apiGet<any[]>('/api/ajio?entity=orders'), apiGet<any[]>('/api/ajio?entity=deliveries'), apiGet<any[]>('/api/ajio?entity=invoices'),
        apiGet<any[]>('/api/ajio?entity=manifests'), apiGet<any[]>('/api/skus'),
      ]);
      setData({ config: config[0] || {}, mappings, backorders, orders, deliveries, invoices, manifests, skus });
      if (!activeDeliveryId && deliveries.length) setActiveDeliveryId(deliveries[0].id);
    } catch (error: any) { setNotice({ msg: error.message, type: 'err' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const act = async (body: any) => {
    const { method = 'POST', ...payload } = body;
    setBusy(true); try { const result = await apiSend('/api/ajio', method, payload); const message = String(result.message || '').trim(); if (!message) throw new Error('The AJIO service returned no completion message.'); setNotice({ msg: message, type: 'ok' }); await load(); return result; }
    catch (error: any) { setNotice({ msg: error.message, type: 'err' }); return null; } finally { setBusy(false); }
  };
  const activeDelivery = data.deliveries.find((row: any) => row.id === Number(activeDeliveryId));
  const packed = data.deliveries.filter((row: any) => row.status === 'Packed');
  const mappedCount = data.mappings.filter((row: any) => row.mapping_status === 'Mapped').length;

  const saveConfig = async () => {
    const result = await act({ method: 'PUT', action: 'save-config', ...data.config, password, e_invoicing_password: eInvoicePassword });
    if (result) { setPassword(''); setEInvoicePassword(''); setConfigureInterface(false); }
  };
  const setConfig = (fields: any) => setData({ ...data, config: { ...data.config, ...fields } });
  const pickAll = async () => setNotice({ msg: 'AJIO Pick All is unavailable until the seller connector and Central Inventory reservation workflow are connected.', type: 'err' });
  const unavailableDocument = (name: string) => setNotice({ msg: `${name} is unavailable until the AJIO connector and document service are connected.`, type: 'err' });
  const printPackingSlip = () => unavailableDocument('AJIO packing slip');
  const printLabel = (_delivery: any) => unavailableDocument('AJIO shipping label');
  const downloadManifest = (_manifest: any) => unavailableDocument('AJIO manifest download');

  return <Shell active="wms" breadcrumb="WMS > Order Processing > AJIO Process Workflow" openScreens={[{ label: 'AJIO Process Workflow', to: '#' }]}>
    <p role="status" className="mb-3 border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">AJIO is not connected to a live seller account or Central Inventory workflow. Configuration and SKU mappings are local metadata only; order, inventory, fulfillment, label, manifest and document actions are unavailable. Existing AJIO rows have not been verified as provider data.</p>
    <div className="mb-3 flex flex-wrap items-center gap-1 border border-slate-300 bg-white p-2">
      {TABS.map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`border-b-2 px-3 py-2 text-xs font-semibold ${tab === key ? 'border-cyan-600 bg-cyan-50 text-cyan-700' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>{label}</button>)}
      <button onClick={load} className="ml-auto rounded border px-3 py-2 text-xs text-slate-500"><RefreshCw className="inline" size={13}/> Refresh</button>
    </div>

    {tab === 'configuration' && <><Section title="Channel Maintenance">
      <div className="mb-4 flex items-center justify-between border-b pb-3"><div><span className="text-xs text-slate-400">Channel Type</span><h3 className="text-2xl font-semibold text-slate-700">AJIO JIT <span className="text-sm font-bold text-slate-500">◉ AJIO</span></h3></div><div className="flex gap-2"><span className={`px-3 py-2 text-xs font-semibold ${data.config.interface_status === 'Configured' ? 'bg-emerald-500 text-white' : data.config.interface_status?.startsWith('Credentials Saved') ? 'bg-amber-500 text-white' : 'bg-rose-500 text-white'}`}>{data.config.interface_status || 'Not Configured'}</span><Btn variant="ghost" onClick={() => setConfigureInterface(true)}>Configuring Interface</Btn><Btn variant="warn" onClick={saveConfig} disabled={busy}><Save size={14}/>Save</Btn></div></div>
      <Accordion title="Channel Detail">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <Field label="Channel Code"><input className={`${input} bg-slate-100`} disabled value={data.config.channel_code || ''}/></Field><Field label="Channel Name" required><input className={input} value={data.config.channel_name || ''} onChange={(event) => setConfig({ channel_name: event.target.value })}/></Field>
          <Field label="Order Fulfillment WH" required><select className={input} value={data.config.order_fulfillment_wh || ''} onChange={(event) => setConfig({ order_fulfillment_wh: event.target.value })}><option value="">Select configured location</option>{locations.map(location=><option key={location.location_code} value={location.location_name}>{location.location_name} ({location.location_code})</option>)}</select></Field><Field label="Status"><select className={input} value={data.config.status || 'Active'} onChange={(event) => setConfig({ status: event.target.value })}><option>Active</option><option>Inactive</option></select></Field>
          <Field label="Channel SLA(in hrs)"><input type="number" className={input} value={data.config.channel_sla_hours || 48} onChange={(event) => setConfig({ channel_sla_hours: Number(event.target.value) })}/></Field><Field label="Auto Range SKU"><select className={input} value={data.config.auto_range_sku || 'No'} onChange={(event) => setConfig({ auto_range_sku: event.target.value })}><option>No</option><option>Yes</option></select></Field>
          <Field label="Customer"><input className={input} value={data.config.customer || ''} onChange={(event) => setConfig({ customer: event.target.value })}/></Field><Field label="Tax Type"><select className={input} value={data.config.tax_type || 'Tax Inclusive'} onChange={(event) => setConfig({ tax_type: event.target.value })}><option>Tax Inclusive</option><option>Tax Exclusive</option></select></Field>
        </div>
        {!locationsLoading&&!locations.length&&<p className="mt-3 text-sm text-slate-600">No active locations are configured. Add a location before saving AJIO fulfillment settings.</p>}
      </Accordion>
      <Accordion title="Orders">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <Field label="Order Sync" required><YesNo value={data.config.order_sync} onChange={(value) => setConfig({ order_sync: value })}/></Field><Field label="Order Sync From Date" required={data.config.order_sync}><input type="date" className={input} value={data.config.order_sync_from_date || ''} onChange={(event) => setConfig({ order_sync_from_date: event.target.value })}/></Field>
          <Field label="Shipping By"><select className={input} value={data.config.shipping_by || 'Ship By Marketplace'} onChange={(event) => setConfig({ shipping_by: event.target.value })}><option>Ship By Marketplace</option><option>Ship By Seller</option></select></Field><Field label="Bill To Party & Its Master"><input className={input} value={data.config.bill_to_party || ''} onChange={(event) => setConfig({ bill_to_party: event.target.value })}/></Field>
          <Field label="Invoice No By"><select className={input} value={data.config.invoice_no_by || 'Self'} onChange={(event) => setConfig({ invoice_no_by: event.target.value })}><option>Self</option><option>Marketplace</option></select></Field><Field label="PrePack Enabled"><Check value={data.config.prepack_enabled} onChange={(value) => setConfig({ prepack_enabled: value })}/></Field>
          <Field label="Mark ReadyToShip At"><select className={input} value={data.config.ready_to_ship_at || 'Manifest'} onChange={(event) => setConfig({ ready_to_ship_at: event.target.value })}><option>Manifest</option><option>Pack</option></select></Field><Field label="Each Qty Per Line"><Check value={data.config.each_qty_per_line} onChange={(value) => setConfig({ each_qty_per_line: value })}/></Field>
          <Field label="Return Order Sync"><YesNo value={data.config.return_sync} onChange={(value) => setConfig({ return_sync: value })}/></Field><Field label="Return Sync From Date" required={data.config.return_sync}><input type="date" className={input} disabled={!data.config.return_sync} value={data.config.return_sync_from_date || ''} onChange={(event) => setConfig({ return_sync_from_date: event.target.value })}/></Field>
          <Field label="Use Marketplace Invoice"><Check value={data.config.use_marketplace_invoice} onChange={(value) => setConfig({ use_marketplace_invoice: value })}/></Field><Field label="Use Marketplace Shipping Label"><Check value={data.config.use_marketplace_shipping_label} onChange={(value) => setConfig({ use_marketplace_shipping_label: value })}/></Field>
          <Field label="Shipping Label"><select className={input} value={data.config.shipping_label || 'ShippingLabel_AJIO'} onChange={(event) => setConfig({ shipping_label: event.target.value })}><option>ShippingLabel_AJIO</option></select></Field><Field label="B2B Invoice Series" required><input className={input} value={data.config.b2b_invoice_series || ''} onChange={(event) => setConfig({ b2b_invoice_series: event.target.value })}/></Field>
        </div>
      </Accordion>
      <Accordion title="Channel SKU">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3"><Field label="SKU Sync"><input className={`${input} bg-slate-100`} disabled value="Pull"/></Field><Field label="SKU Create"><input className={`${input} bg-slate-100`} disabled value="Moderate"/></Field></div>
      </Accordion>
      <Accordion title="Inventory">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3"><Field label="Inventory Sync"><select className={input} value={data.config.inventory_sync_method || 'Pull'} onChange={(event) => setConfig({ inventory_sync_method: event.target.value })}><option>Pull</option><option>Push</option></select></Field><Field label="Enable Inventory Recon"><YesNo value={data.config.enable_inventory_reconciliation} onChange={(value) => setConfig({ enable_inventory_reconciliation: value })}/></Field><Field label="Reconciliation Schedule"><input className={`${input} bg-slate-100`} disabled value="Once Daily"/></Field></div>
      </Accordion>
      <Note>Sales &gt; Manage Channels &gt; Add New &gt; AJIO JIT. SKU Pull with Moderate creation is mandatory. If Order Sync is No, order pull, marketplace invoice/shipping-label and manifest generation are disabled.</Note>
    </Section>
    <Modal title="Channel Configure" open={configureInterface} onClose={() => setConfigureInterface(false)} wide>
      <h3 className="mb-3 border-b pb-2 text-xs font-semibold text-slate-500">Seller Credentials</h3><div className="grid grid-cols-2 gap-3">
        <Field label="UserName" required><input className={input} value={data.config.seller_id || ''} onChange={(event) => setConfig({ seller_id: event.target.value })} placeholder="DV followed by alphanumeric characters"/></Field><Field label="Password" required><input className={input} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={data.config.password_configured ? 'Configured — enter only to replace' : 'Required'}/></Field>
        <Field label="Is B2B" required><select className={input} value={data.config.is_b2b ? 'Yes' : 'No'} onChange={(event) => setConfig({ is_b2b: event.target.value === 'Yes' })}><option>Yes</option><option>No</option></select></Field><Field label="Enable E-Invoicing"><select className={input} value={data.config.enable_e_invoicing ? 'Yes' : 'No'} onChange={(event) => setConfig({ enable_e_invoicing: event.target.value === 'Yes' })}><option>No</option><option>Yes</option></select></Field>
        <Field label="E Invoicing UserName" required={data.config.enable_e_invoicing}><input className={input} disabled={!data.config.enable_e_invoicing} value={data.config.e_invoicing_username || ''} onChange={(event) => setConfig({ e_invoicing_username: event.target.value })}/></Field><Field label="E Invoicing Password" required={data.config.enable_e_invoicing}><input className={input} disabled={!data.config.enable_e_invoicing} type="password" value={eInvoicePassword} onChange={(event) => setEInvoicePassword(event.target.value)} placeholder={data.config.e_invoicing_password_configured ? 'Configured — enter only to replace' : ''}/></Field>
      </div><Note>Enable E-Invoicing defaults to No and may be enabled only after confirmation with the client and AJIO Account Manager. Newly entered passwords are not stored or returned by this screen. Use approved secret management for a live connector and migrate or rotate any legacy credential before go-live.</Note><div className="mt-4 flex justify-end gap-2"><Btn variant="warn" onClick={saveConfig} disabled={busy}>OK</Btn><Btn variant="ghost" onClick={() => setConfigureInterface(false)}>Close</Btn></div>
    </Modal></>}

    {tab === 'catalog' && <Section title="Product Creation, SKU Pull and Inventory Sync">
      <div className="mb-3 flex justify-end gap-2"><Btn onClick={() => act({ action: 'inventory-sync' })} disabled={busy}><RefreshCw size={14}/>Synchronize Inventory</Btn><Btn variant="ghost" onClick={() => act({ action: 'inventory-reconciliation' })} disabled={busy || !data.config.enable_inventory_reconciliation}>Reconcile Inv</Btn></div>
      <table className="w-full"><thead><tr><Th>AJIO Article</Th><Th>ChannelSKUCode</Th><Th>ChannelProductId</Th><Th>Vin SKU</Th><Th>SKU Mapping</Th><Th>Inventory Sync</Th><Th>Published Inventory</Th><Th>Last Sync</Th><Th>Action</Th></tr></thead><tbody>{data.mappings.map((row: any) => <tr key={row.id}><Td>{row.article_code}<br/><span className="text-slate-400">{row.article_name}</span></Td><Td>{row.channel_sku_code}</Td><Td>{row.channel_product_id}</Td><Td>{row.sku_code || '—'}</Td><Td><Pill status={row.mapping_status}/></Td><Td>{row.inventory_sync}</Td><Td>{row.published_inventory ?? '—'}</Td><Td>{row.last_sync ? new Date(row.last_sync).toLocaleString() : '—'}</Td><Td>{row.mapping_status === 'Un-Mapped' ? <span className="flex gap-1"><select className={input} value={mappingSku[row.id] || ''} onChange={(event) => setMappingSku({ ...mappingSku, [row.id]: event.target.value })}><option value="">Select SKU</option>{data.skus.map((sku: any) => <option key={sku.id} value={sku.sku_code}>{sku.sku_code}</option>)}</select><Btn onClick={() => act({ method: 'PUT', action: 'map-sku', id: row.id, sku_code: mappingSku[row.id], channel_sku_code: row.channel_sku_code, channel_product_id: row.channel_product_id })}>Map</Btn></span> : 'Mapped'}</Td></tr>)}</tbody></table>
      <Note>{mappedCount} article(s) mapped locally. AJIO SKU Code maps to ChannelSKUCode; ProductId~VariantId maps to ChannelProductId. This mapping does not establish an AJIO connection or publish inventory. Pulled-SKU mappings require Pull with Moderate creation. Reconciliation remains unavailable until the connector is tested.</Note>
    </Section>}

    {tab === 'backorders' && <Section title="Back Order Inventory Pull (Order Pendency Pull)">
      <div className="mb-3 flex justify-end"><Btn onClick={() => act({ action: 'pull-backorders' })} disabled={busy}><Download size={14}/>Fetch Backorder Inventory</Btn></div>
      <table className="w-full"><thead><tr><Th>AJIO PO</Th><Th>Seller Order</Th><Th>Warehouse</Th><Th>Received At</Th><Th>Items</Th><Th>Reservation</Th><Th>Status</Th></tr></thead><tbody>{data.backorders.map((row: any) => <tr key={row.id}><Td>{row.ajio_po_no}</Td><Td>{row.seller_order_no}</Td><Td>{row.warehouse}</Td><Td>{new Date(row.received_at).toLocaleString()}</Td><Td>{row.lines.map((line: any) => `${line.sku_code} × ${line.qty}`).join(', ')}</Td><Td>{row.reservation_status}</Td><Td><Pill status={row.status}/></Td></tr>)}</tbody></table><Note>Customer orders generate AJIO order pendency. Pulling pendency reserves inventory locally; repeat pulls are blocked when the order already exists.</Note>
    </Section>}

    {tab === 'orders' && <Section title="AJIO PO Release and Order Creation">
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">Reserved PO Pendencies</h3><table className="mb-5 w-full"><thead><tr><Th>AJIO PO</Th><Th>Reservation</Th><Th>Released</Th><Th>Action</Th></tr></thead><tbody>{data.backorders.map((row: any) => <tr key={row.id}><Td>{row.ajio_po_no}</Td><Td>{row.reservation_status}</Td><Td>{row.released ? row.sales_order_no : 'No'}</Td><Td><Btn variant="ghost" disabled={row.status !== 'Reserved' || row.released || busy} onClick={() => act({ action: 'release-po', id: row.id })}>Create Order</Btn></Td></tr>)}</tbody></table>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">AJIO Sales Orders</h3><table className="w-full"><thead><tr><Th></Th><Th>AJIO PO</Th><Th>Sales Order</Th><Th>Warehouse</Th><Th>Line Items</Th><Th>Qty</Th><Th>Status</Th></tr></thead><tbody>{data.orders.map((row: any) => <tr key={row.id}><Td><input type="checkbox" disabled={row.status !== 'Allocated'} checked={selectedOrders.includes(row.id)} onChange={() => setSelectedOrders(selectedOrders.includes(row.id) ? selectedOrders.filter((id) => id !== row.id) : [...selectedOrders, row.id])}/></Td><Td>{row.ajio_po_no}</Td><Td>{row.sales_order_no}</Td><Td>{row.warehouse}</Td><Td>{row.lines.length}</Td><Td>{row.lines.reduce((sum: number, line: any) => sum + Number(line.qty), 0)}</Td><Td><Pill status={row.status}/></Td></tr>)}</tbody></table><div className="mt-3 flex justify-end"><Btn disabled={!selectedOrders.length || busy} onClick={async () => { const result = await act({ action: 'generate-picklist', order_ids: selectedOrders }); if (result) { setSelectedOrders([]); setTab('picking'); } }}><Play size={14}/>Generate Picklist</Btn></div>
    </Section>}

    {tab === 'picking' && <Section title="Manage Picking">
      <div className="mb-3 grid grid-cols-[220px_1fr] gap-4"><label className="text-xs text-slate-500">Scan Picklist / Delivery<select className={`${input} mt-1`} value={activeDeliveryId} onChange={(event) => setActiveDeliveryId(Number(event.target.value))}><option value="">Select delivery</option>{data.deliveries.map((row: any) => <option key={row.id} value={row.id}>{row.picklist_no} / {row.delivery_no}</option>)}</select></label>{activeDelivery && <div className="grid grid-cols-5 gap-2 border bg-slate-50 p-2 text-xs"><span>Picklist Qty<br/><b>{activeDelivery.lines.reduce((sum: number, line: any) => sum + line.qty, 0)}</b></span><span>Picklist Status<br/><b>{activeDelivery.status}</b></span><span>AJIO PO<br/><b>{activeDelivery.ajio_po_no}</b></span><span>Delivery No<br/><b>{activeDelivery.delivery_no}</b></span><span>Prefetch Label<br/><b>{activeDelivery.label_prefetch_status || 'Not Enabled'}</b></span></div>}</div>
      {activeDelivery && <><div className="mb-3 flex flex-wrap items-end gap-2 border border-rose-300 bg-white p-3"><label className="text-xs">To LPN / Box ID<input className={`${input} mt-1 w-44`} value={scan.lpn} onChange={(event) => setScan({ ...scan, lpn: event.target.value })}/></label><label className="text-xs">Scan SKU<select className={`${input} mt-1 w-64`} value={scan.sku_code} onChange={(event) => setScan({ ...scan, sku_code: event.target.value })}><option value="">Select SKU</option>{activeDelivery.lines.map((line: any) => <option key={line.sku_code}>{line.sku_code}</option>)}</select></label><label className="text-xs">Qty<input type="number" min="1" className={`${input} mt-1 w-24`} value={scan.qty} onChange={(event) => setScan({ ...scan, qty: Number(event.target.value) })}/></label><Btn disabled={busy} onClick={() => act({ action: 'scan', delivery_id: activeDelivery.id, ...scan })}><ScanLine size={14}/>Scan</Btn><Btn variant="ghost" disabled={!scan.lpn || busy} onClick={() => act({ action: 'close-box', delivery_id: activeDelivery.id, lpn: scan.lpn })}>Close Box</Btn><Btn variant="ghost" onClick={pickAll}>Pick All</Btn><Btn variant="ghost" onClick={printPackingSlip}>Print Packing Slip</Btn><Btn variant="ghost" disabled={!data.config.prepack_enabled || !['Pending', 'Processing'].includes(activeDelivery.status)} onClick={() => act({ action: 'prefetch-label', delivery_id: activeDelivery.id })}>Prefetch Shipment Label</Btn><Btn variant="warn" disabled={activeDelivery.status !== 'Processing'} onClick={() => act({ action: 'delivery-split', delivery_id: activeDelivery.id })}><Split size={14}/>Delivery Split</Btn></div>
        <div className="grid grid-cols-[1fr_300px] gap-3"><table className="w-full"><thead><tr><Th>Ext Order No</Th><Th>Delivery No</Th><Th>SKU</Th><Th>Qty</Th><Th>Picked Qty</Th><Th>Pending Qty</Th></tr></thead><tbody>{activeDelivery.lines.map((line: any) => <tr key={line.sku_code}><Td>{activeDelivery.ajio_po_no}</Td><Td>{activeDelivery.delivery_no}</Td><Td>{line.sku_code}<br/><span className="text-slate-400">{line.sku_name}</span></Td><Td>{line.qty}</Td><Td>{line.picked_qty}</Td><Td>{line.qty - line.picked_qty}</Td></tr>)}</tbody></table><aside className="border"><h3 className="bg-cyan-600 p-2 text-xs font-semibold text-white">Pending SKUs</h3>{activeDelivery.lines.map((line: any) => <div key={line.sku_code} className="border-b p-2 text-xs"><b>{line.sku_code}</b><br/>Qty: {line.qty} · Pending: {line.qty - line.picked_qty}</div>)}<h3 className="bg-slate-100 p-2 text-xs font-semibold">Boxes</h3>{activeDelivery.boxes.map((box: any) => <div key={box.lpn} className="border-b p-2 text-xs">{box.lpn} — <b>{box.status}</b></div>)}</aside></div></>}
    </Section>}

    {tab === 'packing' && <Section title="Order Packing">
      <table className="w-full"><thead><tr><Th>AJIO PO</Th><Th>Delivery</Th><Th>Boxes</Th><Th>Status</Th><Th>Invoice</Th><Th>Master AWB</Th><Th>Child AWBs</Th><Th>Action</Th></tr></thead><tbody>{data.deliveries.map((row: any) => <tr key={row.id}><Td>{row.ajio_po_no}</Td><Td>{row.delivery_no}</Td><Td>{row.boxes.length}</Td><Td><Pill status={row.status}/></Td><Td>{row.invoice_no || '—'}</Td><Td>{row.master_awb || '—'}</Td><Td>{row.child_awbs?.join(', ') || '—'}</Td><Td><span className="flex gap-1"><Btn disabled={row.status !== 'Picked' || busy} onClick={() => act({ action: 'pack', delivery_id: row.id }) }><PackageCheck size={14}/>Order Pack</Btn>{row.invoice_no && <Btn variant="ghost" onClick={() => printLabel(row)}><FileText size={14}/>Shipping Label</Btn>}</span></Td></tr>)}</tbody></table><Note>One child AWB is generated per closed box. The first child AWB acts as the master AWB. Closed boxes cannot be changed, Un-Packing is unavailable, and cancellation is blocked after packing/invoice generation.</Note>
    </Section>}

    {tab === 'shipment' && <Section title="Order Shipment">
      <div className="mb-2 flex justify-end"><Btn variant="warn" disabled={!selectedDeliveries.length || busy} onClick={async () => { const result = await act({ action: 'request-manifest', delivery_ids: selectedDeliveries }); if (result) setSelectedDeliveries([]); }}><Truck size={14}/>Request Manifest</Btn></div>
      <div className="mb-3 flex gap-2 border-b text-xs font-semibold text-slate-500"><span className="border-b-2 border-cyan-600 px-3 py-2">New ({packed.length})</span><span className="px-3 py-2">Picklist Created</span><span className="px-3 py-2">Pick-Pack</span><span className="px-3 py-2">MP Label Refetch</span><span className="px-3 py-2">Manifested ({data.manifests.length})</span><span className="px-3 py-2">Shipped</span><span className="px-3 py-2">Download Marketplace Manifest</span></div>
      <table className="w-full"><thead><tr><Th></Th><Th>Marketplace</Th><Th>AJIO PO</Th><Th>Delivery</Th><Th>Invoice</Th><Th>Master AWB</Th><Th>Boxes</Th><Th>Status</Th></tr></thead><tbody>{packed.map((row: any) => <tr key={row.id}><Td><input type="checkbox" checked={selectedDeliveries.includes(row.id)} onChange={() => setSelectedDeliveries(selectedDeliveries.includes(row.id) ? selectedDeliveries.filter((id) => id !== row.id) : [...selectedDeliveries, row.id])}/></Td><Td>Ajio FK</Td><Td>{row.ajio_po_no}</Td><Td>{row.delivery_no}</Td><Td>{row.invoice_no}</Td><Td>{row.master_awb}</Td><Td>{row.boxes.length}</Td><Td><Pill status={row.status}/></Td></tr>)}</tbody></table>
      <h3 className="mt-5 mb-2 text-xs font-semibold uppercase text-slate-500">Manifest Documents</h3><table className="w-full"><thead><tr><Th>Manifest No</Th><Th>Date</Th><Th>Shipments</Th><Th>Boxes</Th><Th>Status</Th><Th>Manifest Document</Th><Th>Action</Th></tr></thead><tbody>{data.manifests.map((row: any) => <tr key={row.id}><Td>{row.manifest_no}</Td><Td>{row.manifest_date}</Td><Td>{row.shipment_count}</Td><Td>{row.box_count}</Td><Td><Pill status={row.status}/></Td><Td><button onClick={() => downloadManifest(row)} className="text-sky-600"><Download className="inline" size={13}/> Download</button></Td><Td><Btn variant="ghost" disabled={row.status !== 'Manifested'} onClick={() => act({ action: 'handover', manifest_id: row.id })}>Handover</Btn></Td></tr>)}</tbody></table><Note>Only complete, invoiced shipments can be included. AJIO returns one consolidated manifest for the selected deliveries; 3PL will not pick a partial shipment.</Note>
    </Section>}
    {loading && <div className="fixed inset-0 z-40 grid place-items-center bg-white/50"><div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-cyan-600"/></div>}
    {notice && <Toast {...notice} onClose={() => setNotice(null)}/>}</Shell>;
}

function Accordion({ title, children }: { title: string; children: React.ReactNode }) { return <div className="mb-2 border border-slate-300"><h3 className="bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">{title}</h3><div className="p-3">{children}</div></div>; }
function YesNo({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) { return <select className={input} value={value ? 'Yes' : 'No'} onChange={(event) => onChange(event.target.value === 'Yes')}><option>Yes</option><option>No</option></select>; }
function Check({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) { return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-cyan-600"/>; }
function Note({ children }: { children: React.ReactNode }) { return <p className="mt-4 border-l-4 border-sky-400 bg-sky-50 p-3 text-xs leading-5 text-slate-600">{children}</p>; }
