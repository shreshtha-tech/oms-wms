const timestamp = value => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now() ? time : null;
};
const at = value => { const time = timestamp(value); return time === null ? null : new Date(time).toISOString(); };
const isFresh = (value, minutes) => { const time = timestamp(value); return time !== null && Date.now() - time <= minutes * 60_000; };

const item = (state, label, detail, lastConfirmedAt = null) => ({
  state,
  label,
  detail,
  lastConfirmedAt: at(lastConfirmedAt),
});

/**
 * Describes what the code and this account's persisted runtime evidence support.
 * `verified` credentials alone never imply that an order or stock feed is live.
 */
export function connectionReadiness(account, runtime = {}) {
  const settings = account.settings || {};
  const platform = account.platform;
  const verified = timestamp(account.verified_at) !== null && !['token_expired', 'error'].includes(account.connection_state);
  const workerHealthy = runtime.workerHealthy === true;
  const activeMappings = Number(runtime.activeMappings || 0);
  const orderCursorAt = runtime.orderCursorAt || settings.lastOrderObservationAt || null;
  const webhookAt = at(runtime.lastWebhookAt);
  const webhookReady = settings.webhooksReady === true;
  const orderEnabled = settings.orderObservationEnabled === true;

  let orders = item('unsupported', 'No automatic order feed', 'This platform has no complete automated order intake in this project.');
  let returns = item('unsupported', 'No automatic returns feed', 'Returns require a provider-approved feed and a platform-specific adapter.');
  let inventoryRead = item('unsupported', 'No live inventory readback', 'No scheduled full inventory readback is implemented for this platform.');
  let inventoryWrite = item('unsupported', 'No automatic stock publication', 'No verified stock-write flow is enabled for this platform.');

  if (platform === 'shopify') {
    orders = !verified
      ? item('blocked', 'Verify Shopify access', 'The current provider authorization is not verified.')
      : orderEnabled && webhookReady && webhookAt
        ? item('live', 'Order webhook delivery confirmed', workerHealthy ? 'Signed order events are accepted; the one-minute API poll is available for recovery.' : 'Signed order events are accepted, but the recovery poll worker is offline or stale.', webhookAt || orderCursorAt)
        : orderEnabled && workerHealthy && isFresh(orderCursorAt, 20)
          ? item('live', 'Order polling active', 'The worker has completed a recent Shopify order read.', orderCursorAt)
          : orderEnabled && webhookReady
            ? item('starting', 'Order webhook registered; delivery unconfirmed', 'Registration is recorded, but no accepted signed order callback has been confirmed.')
          : orderEnabled && workerHealthy
            ? item('starting', 'Order polling starting', 'Order polling is enabled; the worker must complete its first successful provider read before this feed is marked operational.')
          : orderEnabled
            ? item('setup_required', 'Order feed armed; runtime not confirmed', settings.orderFeedSetupError || 'A healthy worker must complete its first successful Shopify order read, or the signed webhook must be registered.')
            : item('setup_required', 'Order feed not armed', 'Enable read-only order monitoring and register the signed webhook.');
    returns = verified && webhookReady
      ? item('partial', 'Refund events only', 'The connector imports Shopify refunds/create records; Shopify return requests, reverse fulfillment, and return-receipt lifecycle are not connected.')
      : item('setup_required', 'Refund feed not armed', 'Refund events require a verified account and registered Shopify webhook.');
    inventoryRead = verified && account.status === 'active' && activeMappings > 0 && workerHealthy && isFresh(runtime.lastInventoryReadAt, 20)
      ? item('partial', 'Recent mapped stock read task completed', 'A mapped Shopify read task succeeded within 20 minutes. A mismatch may remain; this timestamp does not prove account-wide readback or reconciliation.', runtime.lastInventoryReadAt)
      : verified && account.status === 'active' && activeMappings > 0 && workerHealthy
        ? item('starting', 'Stock readback awaiting confirmation', 'Mappings and worker are active, but a recent Shopify quantity readback has not completed yet.', runtime.lastInventoryReadAt)
        : item('setup_required', 'Stock readback not active', 'Requires approved SKU/location mappings, verified physical balances, activation, and a healthy worker.', runtime.lastInventoryReadAt);
    inventoryWrite = verified && account.status === 'active' && activeMappings > 0 && workerHealthy
      ? isFresh(runtime.lastInventoryWriteAt, 20)
        ? item('partial', 'Publication task completed; readback unproven', 'A mapped publication task succeeded within 20 minutes. Provider acceptance, final quantity readback and reconciliation require separate mapping-level evidence.', runtime.lastInventoryWriteAt)
        : item('starting', 'Stock publishing enabled; success unconfirmed', 'Activation, mappings and worker health permit queued publication, but no successful publication is recorded within 20 minutes.', runtime.lastInventoryWriteAt)
      : item('blocked', 'Stock publishing remains gated', 'Credentials alone do not publish stock. Physical counts, exact SKU/location approval, activation, and a healthy worker are required.', runtime.lastInventoryWriteAt);
  } else if (platform === 'woocommerce') {
    orders = verified && settings.orderObservationEnabled === true && webhookReady && webhookAt
      ? item('live', 'Signed order webhook delivery confirmed', workerHealthy ? 'Read-only order events are accepted; the inventory worker is healthy for stock processing.' : 'Read-only order events are accepted directly; inventory reservation and stock tasks need the worker.', webhookAt)
      : verified && settings.orderObservationEnabled === true && webhookReady
        ? item('starting', 'Order webhook registered; delivery unconfirmed', 'Registration is recorded, but no accepted signed order callback has been confirmed.')
      : item(verified ? 'setup_required' : 'blocked', verified ? 'Order feed not active' : 'Verify WooCommerce access', settings.orderFeedSetupError || 'Register the signed WooCommerce order webhooks.', webhookAt);
    returns = verified && webhookReady
      ? item('partial', 'Refund status only', 'A WooCommerce order with refunded status is recorded; return requests, parcels, and physical receipt are not imported.')
      : item('setup_required', 'Refund status feed not armed', 'Registered WooCommerce webhooks are required.');
    inventoryRead = item('partial', 'Connection test only', 'The provider probe verifies a product; no scheduled full stock readback job is implemented for WooCommerce.', runtime.lastInventoryReadAt);
    inventoryWrite = verified && account.status === 'active' && activeMappings > 0 && workerHealthy
      ? isFresh(runtime.lastInventoryWriteAt, 20)
        ? item('partial', 'Publication task completed; coverage unproven', 'A mapped WooCommerce task succeeded within 20 minutes. This account-level task timestamp does not independently prove provider state, readback coverage or reconciliation.', runtime.lastInventoryWriteAt)
        : item('starting', 'Stock publishing enabled; success unconfirmed', 'Activation, mappings and worker health permit queued publication, but no successful publication/readback is recorded within 20 minutes.', runtime.lastInventoryWriteAt)
      : item('blocked', 'Stock publishing remains gated', 'Requires approved SKU/location mappings, verified physical balances, activation, and a healthy worker.', runtime.lastInventoryWriteAt);
  } else if (platform === 'amazon' || platform === 'amazon_fba') {
    orders = item('setup_required', 'Amazon queue setup required', 'An order notification processor exists, but this app has no account-level UI flow to register/verify its SQS subscription and queue worker.');
    returns = item('unsupported', 'No Amazon returns feed', 'No Amazon return notification/API ingestion is wired into the unified returns service.');
    inventoryRead = settings.observationEnabled === true && verified && isFresh(runtime.lastObservationAt, 20)
      ? item('partial', platform === 'amazon_fba' ? 'FBA custody observation' : 'MFN listing sample observation', 'A scheduled sample/provider response is fresh; it is not a complete SKU inventory reconciliation.', runtime.lastObservationAt)
      : settings.observationEnabled === true && verified
        ? item('starting', 'Scheduled observation awaiting confirmation', 'The provider sample has not been refreshed within the 20-minute expected window.', runtime.lastObservationAt)
      : item('setup_required', 'Read-only observation not enabled', 'Verify the SP-API account, then enable its scheduled observation.');
    inventoryWrite = item('blocked', 'Activation is not available', 'An Amazon publish adapter exists, but the connection activation flow currently permits only Shopify and WooCommerce.');
  } else if (platform === 'flipkart' || platform === 'snapdeal' || platform === 'zoho_pos') {
    orders = item('unsupported', 'No automatic order feed', 'The current connector verifies a provider sample; it does not ingest live orders.');
    returns = item('unsupported', 'No automatic returns feed', 'No return-event connector is implemented for this platform.');
    inventoryRead = settings.observationEnabled === true && verified && isFresh(runtime.lastObservationAt, 20)
      ? item('partial', 'Sample observation only', 'The scheduled job rechecked the verified sample; it does not reconcile the full SKU/location catalog.', runtime.lastObservationAt)
      : settings.observationEnabled === true && verified
        ? item('starting', 'Scheduled observation awaiting confirmation', 'The provider sample has not been refreshed within the 20-minute expected window.', runtime.lastObservationAt)
      : item('setup_required', 'Read-only observation not enabled', 'Verify the provider account, then enable its scheduled observation.');
    inventoryWrite = item('blocked', 'Stock publication is not enabled', 'This platform has no complete activated stock-write and readback flow in the current project.');
  } else if (platform === 'meesho') {
    orders = item('partial', 'Authorized report import only', 'Imported Supplier Panel reports appear as read-only observations; they are not a live API/webhook feed.');
    returns = item('unsupported', 'No automatic returns feed', 'Meesho return reports are not currently imported.');
    inventoryRead = item('partial', 'Authorized report import only', 'A provider-approved stock report is an observation and does not replace physical central stock.');
    inventoryWrite = item('blocked', 'No approved stock-write adapter', 'A Meesho integration contract and implemented, verified write/readback adapter are required.');
  } else if (platform === 'tally') {
    orders = item('partial', 'Local voucher feed requires review', 'The paired bridge exports locally; vouchers are held until item/godown mapping and processing are approved.');
    returns = item('unsupported', 'No automatic return feed', 'Tally return voucher transformation is not activated.');
    inventoryRead = item('partial', 'Local catalog export only', 'The agent is local; exported vouchers do not update balances until reviewed and mapped.');
    inventoryWrite = item('blocked', 'No outbound Tally stock write', 'No approved Tally voucher-writing flow is implemented.');
  } else if (account.connection_state === 'report_observed' || settings.applicationStatus === 'details_recorded') {
    orders = item('partial', 'Report/partner setup only', 'Saved partner details or an authorized report do not authenticate a seller feed.');
    returns = item('unsupported', 'No automatic returns feed', 'A partner-approved returns contract and adapter are required.');
    inventoryRead = item('partial', 'Report observations only', 'Uploaded reports remain observations; they do not establish a live stock read.');
    inventoryWrite = item('blocked', 'No automatic stock publication', 'Partner authorization, a machine-readable stock contract, and a verified write/readback adapter are required.');
  }

  return {
    credentials: item(verified ? 'verified' : account.connection_state === 'token_expired' ? 'blocked' : 'not_verified', verified ? 'Provider credentials verified' : account.connection_state === 'token_expired' ? 'Provider authorization expired' : 'Provider credentials not verified', verified ? 'Identity and provider access were checked.' : 'Saving setup information is not provider authentication.', account.verified_at),
    orders,
    returns,
    inventoryRead,
    inventoryWrite,
  };
}
