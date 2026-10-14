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
        ? item('partial', 'Signed order webhook delivery observed', workerHealthy ? 'Signed order events were accepted. The Shopify poll currently records observations and does not recover missed reservation work.' : 'Signed order events were accepted, but the inventory worker is offline or stale; polling does not recover missed reservation work.', webhookAt || orderCursorAt)
        : orderEnabled && workerHealthy && isFresh(orderCursorAt, 20)
          ? item('partial', 'Order observation poll completed', 'The worker completed a recent Shopify order read, but this poll does not enqueue reservation work for missed webhooks.', orderCursorAt)
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
      ? item('partial', 'Signed order webhook delivery observed', workerHealthy ? 'Signed order events were accepted and the inventory worker is healthy; general missed-event recovery polling is not implemented.' : 'Signed order events were accepted, but the inventory worker is offline or stale and general recovery polling is not implemented.', webhookAt)
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
    orders = platform==='flipkart' && orderEnabled
      ? settings.flipkartOrderError
        ? item('blocked', 'Flipkart retrieval incomplete', settings.flipkartOrderError, settings.lastFlipkartOrderObservationAt)
      : settings.flipkartHistoryCompletedAt && settings.flipkartCancellationHistoryCompletedAt
          ? item('partial', 'Flipkart history scan completed', workerHealthy && isFresh(settings.lastFlipkartOrderObservationAt,20) ? 'Seller-fulfilled order-date and cancellation-date history was scanned for the configured range and recent observations are fresh. Stock reservations and Flipkart Advantage coverage require separate contracts.' : 'Historical scans completed, but recent polling or worker health is unconfirmed. Start the inventory worker and inspect the last successful observation.', settings.lastFlipkartOrderObservationAt)
          : item('starting', 'Flipkart historical retrieval in progress', workerHealthy ? `Scanning order and cancellation history backwards to ${settings.flipkartHistoryFrom || '1970-01-01'}. Progress is saved only after a complete date window.` : 'Start the inventory worker to retrieve queued Flipkart history.', settings.lastFlipkartOrderObservationAt)
      : platform==='flipkart'
        ? item('setup_required', 'Flipkart order retrieval not enabled', 'Enable historical order retrieval from Manage Connection.')
        : item('unsupported', 'No automatic order feed', 'The current connector verifies a provider sample; it does not ingest live orders.');
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

  const readiness = {
    credentials: item(verified ? 'verified' : account.connection_state === 'token_expired' ? 'blocked' : 'not_verified', verified ? 'Provider credentials verified' : account.connection_state === 'token_expired' ? 'Provider authorization expired' : 'Provider credentials not verified', verified ? 'Identity and provider access were checked.' : 'Saving setup information is not provider authentication.', account.verified_at),
    orders,
    returns,
    inventoryRead,
    inventoryWrite,
  };
  const providerLocationObserved = Array.isArray(account.verification?.locations) && account.verification.locations.length > 0;
  const webhookPlatform = ['shopify','woocommerce'].includes(platform);
  const webhook = webhookPlatform
    ? webhookAt && webhookReady && verified
      ? item('partial','Signed order delivery observed','An accepted signed order callback was recorded; missed-event recovery is not yet proven.',webhookAt)
      : item('setup_required','Signed order webhook unconfirmed','Registration and accepted order delivery must both be verified.',webhookAt)
    : item('unverified','Webhook capability unverified','No provider-specific signed webhook contract and hosted delivery evidence are established.');
  const polling = platform === 'shopify'
    ? orderEnabled && workerHealthy && isFresh(orderCursorAt,20)
      ? item('partial','Observation poll completed','Recent provider order observation does not recover missed reservation work.',orderCursorAt)
      : item('setup_required','Observation poll not confirmed','A recent provider read is required; this poll still cannot replace webhook recovery.',orderCursorAt)
    : item('unverified','Order recovery polling unverified','No complete provider-specific missed-order recovery poll is established.');
  return {
    ...readiness,
    capabilities: {
      AUTH: readiness.credentials,
      IDENTITY: verified && account.external_account_id
        ? item('partial','Account identity recorded','A credential probe and external account identifier are recorded; account ownership and full scope remain separate checks.',account.verified_at)
        : item('unverified','Account identity unverified','No current provider identity evidence is recorded.'),
      CATALOG: item('unverified','Catalog coverage unverified','Provider catalog discovery and complete SKU matching are not proven for this account.'),
      LOCATION: providerLocationObserved
        ? item('partial','Provider locations observed','Returned provider locations do not establish approved Central Inventory location mappings.',account.verified_at)
        : item('unverified','Location contract unverified','No provider location read and approved internal mapping are established.'),
      LISTING: item('unverified','Listing coverage unverified','Exact provider listing, pack and SKU mapping coverage is not proven.'),
      ORDER_FEED: orders,
      RETURN_FEED: returns,
      CANCELLATION: item('unverified','Cancellation lifecycle unverified','Provider cancellation delivery, authorization and stock release are not proven end to end.'),
      FULFILLMENT: item('unverified','Fulfillment lifecycle unverified','Package custody, provider shipment evidence and exact deduction are not proven end to end.'),
      INVENTORY_READ: inventoryRead,
      INVENTORY_WRITE: inventoryWrite,
      INVENTORY_READBACK: item('unverified','Independent readback unverified','A successful read or publication task does not prove mapping-level post-write quantity reconciliation.'),
      WEBHOOK: webhook,
      POLLING: polling,
      RECONCILIATION: item('unverified','Reconciliation unverified','No complete target, acknowledgement, independent readback and mismatch-repair cycle is proven.'),
    },
  };
}
