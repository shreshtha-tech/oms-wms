import { sendDatabaseUnavailable, cors, find, findOne, insert, update } from './mongo.js';
import { activeLocations } from './catalogs.js';
import { currentUser } from './auth-session.js';

const entities = {
  config: 'ajio_config',
  mappings: 'ajio_sku_mappings',
  backorders: 'ajio_backorders',
  orders: 'ajio_orders',
  deliveries: 'ajio_deliveries',
  invoices: 'ajio_invoices',
  manifests: 'ajio_manifests',
};
const trim = value => String(value ?? '').trim();
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const emptyConfig = () => ({
  channel_name: '',
  order_fulfillment_wh: '',
  status: 'Inactive',
  interface_status: 'Not Configured',
  password_configured: false,
  e_invoicing_password_configured: false,
});

async function getConfig() {
  const row = (await find('ajio_config'))[0];
  return row || emptyConfig();
}

function publicConfig(config) {
  const { password, e_invoicing_password, ...fields } = config;
  return {
    ...fields,
    interface_status: config.interface_status === 'Configured' ? 'Credentials Saved - Connection Not Tested' : config.interface_status,
    password_configured: Boolean(config.password_configured || password),
    e_invoicing_password_configured: Boolean(config.e_invoicing_password_configured || e_invoicing_password),
  };
}

function publicMapping(mapping) {
  return { ...mapping, inventory_sync: 'Not Connected', published_inventory: null, last_sync: null };
}

function connectorUnavailable(res) {
  return res.status(503).json({ error: 'AJIO orders, inventory publication, reservations, labels, fulfillment, and shipment actions are unavailable until the seller connector and Central Inventory workflows are connected and verified.' });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const entity = trim(req.query?.entity || req.body?.entity);
    if (req.method === 'GET') {
      if (!entities[entity]) return res.status(400).json({ error: 'Unknown AJIO entity.' });
      if (entity === 'config') return res.status(200).json([publicConfig(await getConfig())]);
      const rows = await find(entities[entity], {}, { sort: { id: -1 } });
      return res.status(200).json(entity === 'mappings' ? rows.map(publicMapping) : rows);
    }

    if (req.method !== 'PUT' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    const action = trim(body.action);

    if (req.method === 'PUT' && action === 'save-config') {
      const current = await getConfig();
      const sellerId = trim(body.seller_id);
      if (!/^DV[A-Za-z0-9]+$/.test(sellerId) || sellerId.includes('@')) fail('Seller ID must be an alphanumeric value starting with DV and cannot be an email address.');
      if (!trim(body.channel_name) || !trim(body.order_fulfillment_wh)) fail('Channel Name and Order Fulfillment WH are required.');
      if (!(await activeLocations()).some(location => location.name === trim(body.order_fulfillment_wh))) fail('Select a configured active fulfillment location.');
      if (body.order_sync === true && !trim(body.order_sync_from_date)) fail('Order Sync From Date is required when Order Sync is Yes.');
      if (body.return_sync === true && !trim(body.return_sync_from_date)) fail('Return Sync From Date is required when Return Order Sync is Yes.');
      if (!trim(body.b2b_invoice_series)) fail('B2B Invoice Series is required.');
      if (body.is_b2b !== true) fail('Is B2B must always be Yes for AJIO JIT.');
      if (body.sku_sync !== 'Pull' || body.sku_create !== 'Moderate') fail('AJIO JIT Channel Mappings require SKU Sync Pull with SKU Create Moderate.');
      if (!trim(body.password) && !current.password_configured && !current.password) fail('Seller password is required before saving the AJIO configuration.');
      if (body.enable_e_invoicing === true && (!trim(body.e_invoicing_username) || (!body.e_invoicing_password && !current.e_invoicing_password_configured && !current.e_invoicing_password))) fail('E-Invoicing Username and Password are required when Enable E-Invoicing is Yes.');
      if (body.scan_lpn_on_picking !== true || body.lpn_reuse_after_ship !== true) fail('Scan LPN on Picking and LPN reuse after ship are mandatory for AJIO.');
      if (body.unpack_access !== false) fail('Un-Packing access must remain revoked for AJIO users.');

      const {
        password, e_invoicing_password, entity: _entity, action: _action, id: _id, ...fields
      } = body;
      fields.password_configured = Boolean(password) || Boolean(current.password_configured || current.password);
      fields.e_invoicing_password_configured = Boolean(e_invoicing_password) || Boolean(current.e_invoicing_password_configured || current.e_invoicing_password);
      fields.interface_status = 'Credentials Saved - Connection Not Tested';
      fields.updated_date = today();
      fields.updated_by = currentUser(req)?.username || 'unknown';
      const saved = current.id
        ? (await update('ajio_config', current.id, fields))[0]
        : await insert('ajio_config', fields);

      const channel = await findOne('channels', { channel_code: saved.channel_code });
      if (channel) await update('channels', channel.id, {
        channel_name: saved.channel_name,
        location: saved.order_fulfillment_wh,
        status: saved.status,
        fulfilment_status: 'Not Connected',
        channel_configured: 'No',
      });
      return res.status(200).json({ ...publicConfig(saved), message: 'Configuration saved locally; AJIO connection not tested.' });
    }

    if (req.method === 'PUT' && action === 'map-sku') {
      const mapping = await findOne('ajio_sku_mappings', { id: Number(body.id) });
      const sku = await findOne('skus', { sku_code: trim(body.sku_code) });
      if (!mapping || !sku) fail('Select a valid AJIO article and local SKU.', 404);
      const channelSkuCode = trim(body.channel_sku_code || mapping.channel_sku_code);
      const channelProductId = trim(body.channel_product_id || mapping.channel_product_id);
      if (!channelSkuCode) fail('AJIO SKU Code must be mapped in ChannelSKUCode.');
      if (!/^[^~]+~[^~]+$/.test(channelProductId)) fail('ChannelProductId must contain ProductId~VariantId.');
      const [saved] = await update('ajio_sku_mappings', mapping.id, {
        channel_sku_code: channelSkuCode,
        channel_product_id: channelProductId,
        sku_code: sku.sku_code,
        article_name: sku.name,
        mapping_status: 'Mapped',
        inventory_sync: 'Not Connected',
        published_inventory: null,
        last_sync: null,
        mapping_updated_at: now(),
      });
      return res.status(200).json({ ...saved, message: 'SKU mapping saved locally; AJIO connection not tested.' });
    }

    if (req.method === 'POST') return connectorUnavailable(res);
    return res.status(405).json({ error: 'Unsupported AJIO operation.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('AJIO API error:', { name: error?.name, code: error?.code });
    res.status(error.status || 500).json({ error: error.message || 'AJIO operation failed.' });
  }
}
