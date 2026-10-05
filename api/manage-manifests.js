import { sendDatabaseUnavailable, cors, find, insert } from './mongo.js';
import { channelRows, clientPairs, locationPairs, transporterPairs } from './catalogs.js';
import { currentUser } from './auth-session.js';

const text = value => String(value ?? '').trim();
const has = (value, query) => !text(query) || text(query) === '-1' || text(value).toLowerCase().includes(text(query).toLowerCase());
const days = (start, end) => Math.abs(new Date(end) - new Date(start)) / 86400000;
const normalize = row => ({
  ...row,
  delManifestNo: row.manifest_no || row.del_manifest_no || '',
  manifestDate: row.manifest_date || row.created_at || row.handover_date || '',
  transporter: row.transporter || row.courier || '',
  transporterCode: row.transporter_code || '',
  extTransporterName: row.ext_transporter_name || '',
  createdBy: row.created_by || '',
  status: row.status ?? '',
  statusCode: row.status_code ?? '',
  siteLocName: row.location || row.warehouse || '',
  siteLocCode: row.site_loc_code || row.location_code || '',
  clientId: row.client_id || '',
  channelType: row.channel_type || '',
  orderCount: row.order_count ?? row.shipment_count ?? '',
  handoverId: row.handover_id || '',
  vehicleNo: row.vehicle_no || '',
  remarks: row.remarks || '',
  isB2B: row.is_b2b ?? '',
  isB2BId: row.is_b2b_id ?? '',
  deliveries: Array.isArray(row.deliveries) ? row.deliveries : [],
  recordTrust: row.record_trust || 'legacy-unverified',
});

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const [locations, clients, transporters, channels, partners] = await Promise.all([
        locationPairs(), clientPairs(), transporterPairs(), channelRows(), find('partners'),
      ]);
      const transporterTypes = [...new Set(partners.filter(row => row.type === 'Transporter' || row.partner_type === 'Transporter')
        .map(row => text(row.transporter_type)).filter(Boolean))].map(value => [value, value]);
      const transporterDetails = partners.filter(row => row.type === 'Transporter' || row.partner_type === 'Transporter')
        .map(row => ({ code: text(row.transporter_code || row.code || row.id), type: text(row.transporter_type) }));
      return res.json({
        locations, clients, transporters, transporterTypes, transporterDetails,
        channelTypes: channels.filter(row => row.channel_code && row.channel_name)
          .map(row => [String(row.channel_code), String(row.channel_name)]),
        statuses: [['7', 'Cancelled'], ['1', 'Confirmed'], ['10', 'Invoiced'], ['5', 'InvoiceInProcess'], ['0', 'Pending']],
        providerDispatchAvailable: false,
        dataTrust: 'legacy-unverified',
        notice: 'Manifest drafts are local metadata; confirmation and carrier dispatch are not connected.',
      });
    }

    const body = req.body || {};
    const all = await find('shipments');
    if (req.method === 'POST' && (body.REQ_SEARCH_FLAG || body.action === 'search')) {
      if (!text(body.manifestNo) && !text(body.frmMnaifestDate)) {
        return res.status(400).json({ error: 'Either Manifest No Or Manifest Date is mandatory' });
      }
      if (body.frmMnaifestDate && body.toManifestDate && days(body.frmMnaifestDate, body.toManifestDate) > 90) {
        return res.status(400).json({ error: 'Date range cannot be greater than 90 days' });
      }
      const filtered = all.map(normalize).filter(row =>
        has(row.delManifestNo, body.manifestNo)
        && (has(row.transporterCode, body.transporter) || has(row.transporter, body.transporter))
        && (!text(body.frmMnaifestDate) || row.manifestDate.slice(0, 10) >= body.frmMnaifestDate)
        && (!text(body.toManifestDate) || row.manifestDate.slice(0, 10) <= body.toManifestDate)
        && has(row.createdBy, body.userId) && has(row.status, body.status)
        && (has(row.siteLocCode, body.location) || has(row.siteLocName, body.location))
        && has(row.clientId, body.clientId) && has(row.channelType, body.channelType)
        && has(row.handoverId, body.handoverId) && has(row.isB2BId, body.isB2B)
        && (!text(body.deliveryNo) || row.deliveries.some(value => has(value, body.deliveryNo)))
        && (!text(body.trackingNo) || row.deliveries.some(value => has(value, body.trackingNo)))
      );
      const size = [20, 50, 100, 200].includes(Number(body.rows)) ? Number(body.rows) : 20;
      const page = Math.max(1, Number(body.page) || 1);
      const manifestDTOList = filtered.slice((page - 1) * size, page * size)
        .map(row => ({ ...row, recordTrust: row.recordTrust || 'legacy-unverified' }));
      return res.json({ manifestDTOList, rows: manifestDTOList, page, total: Math.ceil(filtered.length / size), records: filtered.length });
    }

    if (req.method === 'POST' && body.action !== 'draft-save') {
      return res.status(501).json({ error: 'Only local manifest draft metadata can be saved. Provider dispatch actions are unavailable.' });
    }

    if (req.method === 'POST' && body.action === 'draft-save') {
      const [locations, clients, transporters, channels, deliveries] = await Promise.all([
        locationPairs(), clientPairs(), transporterPairs(), channelRows(), find('fulfillment_orders'),
      ]);
      const location = locations.find(([code]) => code === text(body.siteLocCode));
      if (!location) return res.status(400).json({ error: 'Select a configured location.' });
      const transporter = transporters.find(([code]) => code === text(body.transporter));
      if (!transporter) return res.status(400).json({ error: 'Please Select Transporter' });
      const client = clients.find(([code]) => code === text(body.clientId));
      if (text(body.clientId) && body.clientId !== '-1' && !client) return res.status(400).json({ error: 'Select a configured client.' });
      const channel = channels.find(row => String(row.channel_code) === text(body.channelType));
      if (text(body.channelType) && body.channelType !== '-1' && !channel) return res.status(400).json({ error: 'Select a configured channel.' });
      const selected = Array.isArray(body.deliveries) ? [...new Set(body.deliveries.map(text).filter(Boolean))] : [];
      if (!selected.length) return res.status(400).json({ error: 'Please Add Delivery No/Tracking No' });
      const missing = selected.find(value => !deliveries.some(row => [row.delivery_no, row.ob_del_no, row.awb].some(identifier => text(identifier) === value)));
      if (missing) return res.status(400).json({ error: `Delivery or tracking number ${missing} was not found.` });
      const next = Math.max(0, ...all.map(row => Number(text(normalize(row).delManifestNo).replace(/\D/g, '')) || 0)) + 1;
      const manifestNo = `MNF${String(next).padStart(6, '0')}`;
      const created = await insert('shipments', {
        manifest_no: manifestNo, manifest_date: new Date().toISOString(),
        transporter: transporter[1], transporter_code: transporter[0],
        status: 'Pending', status_code: '0', location: location[1], site_loc_code: location[0],
        client_id: client?.[0] || '', channel_type: channel ? String(channel.channel_code) : '',
        order_count: selected.length, deliveries: selected,
        vehicle_no: text(body.vehicleNo), driver_name: text(body.driverName),
        driver_number: text(body.driverNumber), remarks: text(body.remarks),
        is_b2b: body.businessType === '1' ? 'B2B Flow' : 'B2C Flow',
        is_b2b_id: body.businessType || '0',
        record_trust: 'local-draft-metadata',
        created_by: currentUser(req)?.username || 'unknown', created_at: new Date().toISOString(),
      });
      return res.status(201).json({ row: normalize(created), jsonMessage: 'Manifest Saved Successfully' });
    }

    if (req.method === 'PUT') {
      return res.status(501).json({ error: 'Manifest confirmation, ready-for-shipping, cancellation, and reopen actions are paused until provider dispatch and Central Inventory custody are integrated.' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Manage Manifest error:', { name: error?.name, code: error?.code });
    return res.status(500).json({ error: error.message });
  }
}
