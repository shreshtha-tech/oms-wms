import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '../../lib/api';
import { Printer, X } from 'lucide-react';
import { AdminParityHeader, AdminParityNotice } from './AdminParityParts';

type Pair = [string, string];

export default function ForceOrderPullReplica() {
  const [location, setLocation] = useState('-1');
  const [orders, setOrders] = useState('');
  const [addWh, setAddWh] = useState(false);
  const [channels, setChannels] = useState<Pair[]>([]);
  const [warehouses, setWarehouses] = useState<Pair[]>([]);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void apiGet<{ channels: Pair[]; warehouses: Pair[] }>('/api/admin?action=force-pull-catalog')
      .then(data => { setChannels(data.channels); setWarehouses(data.warehouses); })
      .catch(error => setNotice(error instanceof Error ? error.message : 'Unable to load locations'));
  }, []);

  const reset = () => { setAddWh(false); setLocation('-1'); setOrders(''); setNotice(''); };
  const save = async () => {
    if (location === '-1') { document.getElementById('force-location')?.focus(); return setNotice('Location is Mandatory'); }
    if (!orders.trim()) { document.getElementById('force-orders')?.focus(); return setNotice('Order Number is Mandatory'); }
    setSaving(true);
    try {
      await apiSend('/api/admin', 'POST', { action: 'force-pull', location, orders: orders.trim().toUpperCase(), addWhHo: addWh });
      setOrders('');
      setNotice('Orders Pulled Successfully');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to pull orders');
    } finally { setSaving(false); }
  };

  return <div className="admin-parity">
    <AdminParityHeader title="Force Order Pull"><button className="admin-parity-button save" disabled={saving} onClick={() => void save()}><Printer size={12} />Save</button><button className="admin-parity-button" onClick={reset}><X size={12} strokeWidth={4} />Reset</button></AdminParityHeader>
    <AdminParityNotice message={notice} close={() => setNotice('')} />
    <div className="admin-force-panel"><div className="admin-force-fields">
      <label htmlFor="force-location">Location</label>
      <select id="force-location" aria-label="Location" value={location} onChange={event => setLocation(event.target.value)}><option value="-1">--- Select ---</option>{(addWh ? [...channels, ...warehouses] : channels).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
      <label className="admin-force-wh">Add WH/HO<input aria-label="Add WH/HO" type="checkbox" checked={addWh} onChange={event => { setAddWh(event.target.checked); setLocation('-1'); }} /></label>
      <label htmlFor="force-orders">Order Number</label><input id="force-orders" aria-label="Order Number" value={orders} onChange={event => setOrders(event.target.value)} /><span />
    </div>
    <p>(Enter comma separated order numbers if more than one order numbers, Max 20 order numbers are allowed)</p></div>
  </div>;
}
