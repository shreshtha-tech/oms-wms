import { sendDatabaseUnavailable, find, findOne, insert, update, cors } from './mongo.js';
import { currentUser } from './auth-session.js';
import { activeLocations } from './catalogs.js';

const collections = {
  config: 'amazon_mfn_config', mappings: 'amazon_mfn_mappings', orders: 'amazon_mfn_orders',
  inventoryLogs: 'amazon_mfn_inventory_logs', returns: 'amazon_mfn_returns', shipments: 'amazon_mfn_shipments',
};
const text = (value) => String(value ?? '').trim();
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const secretFields = ['access_key', 'secret_key', 'mws_token', 'panel_password'];
const marketplaceActions = new Set([
  'verify-otp', 'submit-inventory', 'process-feed', 'reconcile-inventory',
  'pull-orders', 'confirm-order', 'prefetch-label', 'pack-order', 'process-label',
  'ship-order', 'cancel-order', 'pull-returns',
]);

const MARKETPLACES = {
  India: { country_code: 'IN', endpoint: 'https://sellingpartnerapi-eu.amazon.com', marketplace_id: 'A21TJRUUN4KGV' },
  UAE: { country_code: 'AE', endpoint: 'https://sellingpartnerapi-eu.amazon.com', marketplace_id: 'A2VIGQ35RCS4UG' },
  US: { country_code: 'US', endpoint: 'https://sellingpartnerapi-na.amazon.com', marketplace_id: 'ATVPDKIKX0DER' },
};

async function getConfig() {
  const existing = (await find('amazon_mfn_config'))[0];
  if (existing) return existing;
  return {
    region: '', channel_name: '', order_fulfillment_wh: '', status: 'Inactive',
    interface_status: 'Not Configured', single_warehouse: true,
    order_sync: false, return_sync: false, inventory_sync: false,
    access_key_configured: false, secret_key_configured: false,
    mws_token_configured: false, panel_password_configured: false,
  };
}
function publicConfig(config) {
  const { access_key, secret_key, mws_token, panel_password, ...safe } = config;
  const legacySecretsPresent = secretFields.some(key => Boolean(text(config[key])));
  return {
    ...safe,
    endpoint: MARKETPLACES[config.region]?.endpoint || '',
    interface_status: config.id ? 'Configuration Recorded - Connector Not Configured' : 'Not Configured',
    access_key_configured: false,
    secret_key_configured: false,
    mws_token_configured: false,
    panel_password_configured: false,
    legacy_secret_values_present: legacySecretsPresent,
    credential_storage_status: 'Credentials are not accepted or stored by this module.',
  };
}
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const entity = text(req.query.entity || req.body?.entity);
    if (req.method === 'GET') {
      if (entity === 'marketplaces') return res.status(200).json(MARKETPLACES);
      if (!collections[entity]) return res.status(400).json({ error: 'Unknown Amazon MFN entity.' });
      if (entity === 'config') return res.status(200).json([publicConfig(await getConfig())]);
      return res.status(200).json(await find(collections[entity], {}, { sort: { id: -1 } }));
    }
    const action = text(req.body?.action);
    if (marketplaceActions.has(action)) fail('Amazon marketplace actions are unavailable: no live connector is configured or tested.', 503);
    if (req.method === 'POST') return res.status(501).json({ error: 'Amazon MFN provider actions require a configured and verified connector.' });
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
    if (req.method === 'PUT' && action === 'save-config') {
      const current = await getConfig(); const body = req.body; const region = text(body.region);
      if (!MARKETPLACES[region]) fail('Select India, UAE, or US & Other Countries configuration.');
      if (!text(body.channel_name) || !text(body.order_fulfillment_wh)) fail('Channel Name and Order Fulfillment WH are required.');
      const locations = (await activeLocations()).map(location => location.name);
      if (!locations.includes(text(body.order_fulfillment_wh))) fail('Select a configured active fulfillment location.');
      if (body.single_warehouse !== true) fail('Amazon MFN supports a single Order Fulfillment WH per seller account.');
      if (body.order_sync === true && !text(body.order_sync_from_date)) fail('Order Sync From Date is required when Order Sync is Yes.');
      if (body.return_sync === true && !text(body.return_sync_from_date)) fail('Return Sync From Date is required when Return Order Sync is Yes.');
      if (!text(body.seller_id) || !text(body.marketplace_id)) fail('Seller ID and Marketplace ID are required.');
      if (region === 'India' && !text(body.panel_user_id)) fail('Panel User Id is required for Amazon India.');
      if (!/^\d+$/.test(text(body.developer_id)) || !text(body.developer_name)) fail('Enter the numeric Developer ID and Developer Name issued for your Amazon developer account.');
      if (region === 'India' && body.need_invoice !== true) fail('Need Invoice must be Yes for Amazon India Easy Ship.');
      const { access_key: _access, secret_key: _secret, mws_token: _token, panel_password: _panelPassword,
        access_key_configured: _accessConfigured, secret_key_configured: _secretConfigured,
        mws_token_configured: _tokenConfigured, panel_password_configured: _panelConfigured,
        legacy_secret_values_present: _legacySecretsPresent, credential_storage_status: _credentialStorageStatus,
        entity: _entity, action: _action, id: _id, ...fields } = body;
      fields.access_key_configured = false;
      fields.secret_key_configured = false;
      fields.mws_token_configured = false;
      fields.panel_password_configured = false;
      fields.endpoint = MARKETPLACES[region].endpoint;
      fields.country_code = MARKETPLACES[region].country_code;
      fields.interface_status = 'Configuration Recorded - Connector Not Configured';
      fields.updated_by = currentUser(req)?.username || 'unknown'; fields.updated_date = today();
      const saved = current.id ? (await update('amazon_mfn_config', current.id, fields))[0] : await insert('amazon_mfn_config', fields);
      const channel = await findOne('channels', { channel_code: saved.channel_code });
      if (channel) await update('channels', channel.id, { channel_name: saved.channel_name, location: saved.order_fulfillment_wh, status: saved.status, fulfilment_status: 'Not Connected', channel_configured: 'No' });
      return res.status(200).json(publicConfig(saved));
    }
    if (req.method === 'PUT' && action === 'map-sku') {
      const mapping = await findOne('amazon_mfn_mappings', { id: Number(req.body.id) }); const sku = await findOne('skus', { sku_code: text(req.body.sku_code) });
      if (!mapping || !sku) fail('Select a valid Amazon listing and local SKU.', 404);
      const merchantSku = text(req.body.channel_sku_code || mapping.merchant_sku); const asin = text(req.body.channel_product_id || mapping.asin);
      if (!merchantSku) fail('Amazon Merchant SKU must be mapped in ChannelSKUCode.');
      if (!/^B[A-Z0-9]{9}$/.test(asin)) fail('Amazon ASIN mapped in ChannelProductId must be 10 alphanumeric characters beginning with B.');
      return res.status(200).json((await update('amazon_mfn_mappings', mapping.id, { merchant_sku: merchantSku, asin, sku_code: sku.sku_code, product_name: sku.name, mapping_status: 'Mapped', feed_status: 'Not Submitted', last_sync: '' }))[0]);
    }
    return res.status(400).json({ error: 'Unsupported Amazon MFN action.' });
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Amazon MFN API error:', { name: error?.name, code: error?.code });
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
}
