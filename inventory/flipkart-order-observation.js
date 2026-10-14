import { createHash } from 'node:crypto';
import { inventoryPool, transaction } from './db.js';
import { currentCredentials } from './connection-setup.js';
import { recordIncomingOrder } from './unified-orders.js';
import { fetchFlipkartRange, normalizeFlipkartOrders, flipkartSearches } from './flipkart-orders.js';

export const flipkartHistoryStart = '1970-01-01T00:00:00.000Z';
export async function pollFlipkartOrderObservations(tenantId, { accountId, pool = inventoryPool(), transact = transaction, credentials = currentCredentials, fetchRange = fetchFlipkartRange, record = recordIncomingOrder, now = () => new Date() } = {}) {
 const accounts = (await pool.query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND platform='flipkart' AND settings->>'orderObservationEnabled'='true' AND ($2::uuid IS NULL OR id=$2::uuid)",[tenantId,accountId || null])).rows;
 const summary = { accounts: 0, orders: 0, errors: [] };
 for (const candidate of accounts) {
  const lease = await pool.connect(); let locked = false;
  try {
   locked = (await lease.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",[`flipkart-orders:${tenantId}:${candidate.id}`])).rows[0].acquired;
   if (!locked) continue;
   const account = (await pool.query("SELECT * FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 AND settings->>'orderObservationEnabled'='true'",[tenantId,candidate.id])).rows[0];
   if (!account) continue;
   const settings = account.settings || {};
   if (settings.flipkartOrderRetryAt && Date.parse(settings.flipkartOrderRetryAt) > now().getTime()) continue;
   const fromLimit = settings.flipkartHistoryFrom || flipkartHistoryStart;
   const historyFrom = Date.parse(fromLimit), highWater = now().getTime();
   if (!Number.isFinite(historyFrom) || historyFrom > highWater) throw Object.assign(new Error('Invalid history range'),{code:'FLIPKART_INVALID_RANGE'});
   const fields = await credentials(account);
   // Refresh recent observations every cycle, plus one restart-safe historical
   // window. No reservation/publication work or historical alerts are enqueued.
   const until = settings.flipkartBackfillBefore ? Date.parse(settings.flipkartBackfillBefore) : highWater;
   const cancellationUntil = settings.flipkartCancellationBackfillBefore ? Date.parse(settings.flipkartCancellationBackfillBefore) : highWater;
   if (!Number.isFinite(until)) throw Object.assign(new Error('Invalid checkpoint'),{code:'FLIPKART_INVALID_RANGE'});
   if (!Number.isFinite(cancellationUntil)) throw Object.assign(new Error('Invalid cancellation checkpoint'),{code:'FLIPKART_INVALID_RANGE'});
   const oldest = Math.max(historyFrom, until-365*86400000);
   const ranges = [{ from:new Date(Math.max(historyFrom,highWater-7*86400000)).toISOString(), to:new Date(highWater).toISOString(), kind:'recent', dateField:'orderDate' }, { from:new Date(Math.max(historyFrom,highWater-7*86400000)).toISOString(), to:new Date(highWater).toISOString(), kind:'recent-cancellations', dateField:'cancellationDate' }];
   if (!settings.flipkartHistoryCompletedAt && until > historyFrom) ranges.push({ from:new Date(oldest).toISOString(), to:new Date(until).toISOString(), kind:'history' });
   const cancellationOldest=Math.max(historyFrom,cancellationUntil-365*86400000);
   if (!settings.flipkartCancellationHistoryCompletedAt && cancellationUntil>historyFrom) ranges.push({from:new Date(cancellationOldest).toISOString(),to:new Date(cancellationUntil).toISOString(),kind:'cancellation-history',dateField:'cancellationDate'});
   const observedOrderIds = new Set();
   for (const range of ranges) {
    // Categories are fetched and committed independently to bound memory. A
    // partial category retry is safe because order/item keys are stable.
    const searches=range.dateField==='cancellationDate'?flipkartSearches.slice(4):flipkartSearches;
    for (const search of searches) {
     const result = await fetchRange({ ...range, dateField:range.dateField||'orderDate', accessToken: fields.accessToken, searches:[search] });
     const observations = normalizeFlipkartOrders(result.shipments);
     await transact(async db => {
      const current = (await db.query('SELECT settings FROM ci_channel_account WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,account.id])).rows[0]?.settings;
      if (!current?.orderObservationEnabled || current.flipkartHistoryFrom !== settings.flipkartHistoryFrom || current.flipkartBackfillBefore !== settings.flipkartBackfillBefore || current.flipkartCancellationBackfillBefore !== settings.flipkartCancellationBackfillBefore) throw Object.assign(new Error('Order scan configuration changed'),{code:'FLIPKART_SCAN_CHANGED'});
      for (const event of observations) {
       const orderId = await record(db,{tenantId,accountId:account.id,platform:'flipkart',event,topic:'poll_observed',notify:false,packingAlerts:false});
       if (!orderId) continue;
       const digest = createHash('sha256').update(JSON.stringify(event)).digest('hex');
       await db.query("INSERT INTO ci_order_timeline(tenant_id,order_id,event_key,event_type,detail) VALUES($1,$2,$3,'flipkart_shipment_observed',$4) ON CONFLICT(tenant_id,event_key) DO NOTHING",[tenantId,orderId,`flipkart:${account.id}:${event.id}:${digest}`,JSON.stringify({lines:event.line_items.map(({id,providerStatus,shipmentId,locationId})=>({id,providerStatus,shipmentId,locationId})),readOnly:true})]);
      }
     });
     for (const event of observations) observedOrderIds.add(event.id);
    }
    if (range.kind==='history' || range.kind==='cancellation-history') {
     const cancellation = range.kind==='cancellation-history';
     const cursor = cancellation ? cancellationUntil : until;
     const next = Math.max(historyFrom,cursor-365*86400000);
     const completed = next <= historyFrom;
     const cursorKey=cancellation?'flipkartCancellationBackfillBefore':'flipkartBackfillBefore';
     const completedKey=cancellation?'flipkartCancellationHistoryCompletedAt':'flipkartHistoryCompletedAt';
     const update={lastFlipkartOrderObservationAt:new Date(highWater).toISOString(),[cursorKey]:completed ? new Date(historyFrom).toISOString() : new Date(next).toISOString(),...(completed?{[completedKey]:new Date(highWater).toISOString()}:{}),flipkartOrderError:null,flipkartOrderRetryAt:null};
     const saved = await pool.query(`UPDATE ci_channel_account SET settings=settings||$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND settings->>'orderObservationEnabled'='true' AND settings->>'flipkartBackfillBefore' IS NOT DISTINCT FROM $4 AND settings->>'flipkartHistoryFrom' IS NOT DISTINCT FROM $5 AND settings->>'flipkartCancellationBackfillBefore' IS NOT DISTINCT FROM $6`,[tenantId,account.id,JSON.stringify(update),settings.flipkartBackfillBefore || null,settings.flipkartHistoryFrom || null,settings.flipkartCancellationBackfillBefore || null]);
     if (saved.rowCount !== 1) throw Object.assign(new Error('Order scan configuration changed'),{code:'FLIPKART_SCAN_CHANGED'});
    }
   }
   summary.accounts++; summary.orders+=observedOrderIds.size;
  } catch (error) {
   const code = /^FLIPKART_[A-Z_]+$/.test(error?.code || '') ? error.code : 'FLIPKART_ORDER_FETCH_FAILED';
   summary.errors.push({accountId:candidate.id,code});
   await pool.query("UPDATE ci_channel_account SET settings=settings||$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,candidate.id,JSON.stringify({flipkartOrderError:code,flipkartOrderRetryAt:new Date(now().getTime()+60000).toISOString()})]);
  } finally {
   if (locked) { try { await lease.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`flipkart-orders:${tenantId}:${candidate.id}`]); } catch {} }
   lease.release(true);
  }
 }
 return summary;
}
