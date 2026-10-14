import { providerFetch, jsonResponse } from './connection-security.js';

const endpoint = 'https://api.flipkart.net/sellers/v3/shipments/filter/';
export const flipkartSearches = [
 { type: 'preDispatch', states: ['APPROVED','PACKING_IN_PROGRESS','PACKED','FORM_FAILED','READY_TO_DISPATCH'], hold: false },
 { type: 'preDispatch', states: ['APPROVED','PACKING_IN_PROGRESS','PACKED','FORM_FAILED','READY_TO_DISPATCH'], hold: true },
 ...['NORMAL','SELF'].map(kind => ({ type: 'postDispatch', states: ['SHIPPED','DELIVERED','PICKUP_COMPLETE'], shipmentTypes: [kind] })),
 ...['marketplaceCancellation','sellerCancellation','buyerCancellation'].map(cancellationType => ({ type: 'cancelled', states: ['CANCELLED'], cancellationType })),
];
function failure(code) { return Object.assign(new Error('Flipkart retrieval incomplete; inspect the safe error code and retry the same range.'), { code }); }
export function flipkartPageUrl(value) {
 let url; try { url = new URL(value, endpoint); } catch { throw failure('FLIPKART_INVALID_CURSOR'); }
 if (url.origin !== 'https://api.flipkart.net' || url.username || url.password || url.hash || !/^\/sellers\/v3\/shipments\/(?:filter|search)(?:\/|$)/.test(url.pathname)) throw failure('FLIPKART_INVALID_CURSOR');
 return url.href;
}
// Reads are buffered until the entire category/window succeeds. A capped range
// is bisected before any observations are committed, avoiding silent truncation.
export async function fetchFlipkartRange({ accessToken, from, to, dateField = 'orderDate', fetcher = providerFetch, searches = flipkartSearches, maxRequests = 2000 }) {
 const start = Date.parse(from), end = Date.parse(to);
 if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || !accessToken || !['orderDate','cancellationDate'].includes(dateField)) throw failure('FLIPKART_INVALID_RANGE');
 let requests = 0;
 async function scan(a,b,search) {
  let url = endpoint, first = true, count = 0; const seen = new Set(), rows = [];
  while (url) {
   if (++requests > maxRequests) throw failure('FLIPKART_REQUEST_BUDGET');
   url = flipkartPageUrl(url);
   if (seen.has(url)) throw failure('FLIPKART_CURSOR_LOOP');
   seen.add(url);
   const options = { method: first ? 'POST' : 'GET', retrySafe: true, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } };
   if (first) options.body = JSON.stringify({ filter: { ...search, [dateField]: { from: new Date(a).toISOString(), to: new Date(b).toISOString() } }, pagination: { pageSize: 20 } });
   const data = await jsonResponse(await fetcher(url,options),'Flipkart'); first = false;
   if (!Array.isArray(data.shipments) || typeof data.hasMore !== 'boolean') throw failure('FLIPKART_INVALID_PAGE');
   count += data.shipments.length; rows.push(...data.shipments);
   if (count >= 5000) {
    if (b-a < 2) throw failure('FLIPKART_UNSPLITTABLE_RANGE');
    const mid = Math.floor((a+b)/2);
    return [...await scan(a,mid,search), ...await scan(mid,b,search)];
   }
   if (data.hasMore && (!data.shipments.length || typeof data.nextPageUrl !== 'string' || !data.nextPageUrl)) throw failure('FLIPKART_INVALID_CURSOR');
   url = data.hasMore ? data.nextPageUrl : null;
  }
  return rows;
 }
 const rows = [];
 for (const search of searches) rows.push(...await scan(start,end,search));
 return { shipments: rows, requests, from: new Date(start).toISOString(), to: new Date(end).toISOString(), dateField };
}

// Group all shipments/categories before projection: split shipments are not
// separate orders, and one cancelled line must not cancel an entire mixed order.
export function normalizeFlipkartOrders(shipments) {
 const orders = new Map();
 for (const shipment of shipments) {
  if (typeof shipment?.shipmentId !== 'string' || !shipment.shipmentId || !Array.isArray(shipment.orderItems) || !Number.isFinite(Date.parse(shipment.updatedAt))) throw failure('FLIPKART_INVALID_SHIPMENT');
  for (const line of shipment.orderItems) {
   if (typeof line?.orderId !== 'string' || !line.orderId || typeof line.orderItemId !== 'string' || !line.orderItemId || typeof line.sku !== 'string' || !line.sku || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || typeof line.status !== 'string' || !line.status || !Number.isFinite(Date.parse(line.orderDate))) throw failure('FLIPKART_INVALID_ORDER_ITEM');
   if ([line.orderId,line.orderItemId,line.sku].some(value => value.length > 120)) throw failure('FLIPKART_ID_TOO_LONG');
   let order = orders.get(line.orderId);
   if (!order) { order = { id: line.orderId, lines: new Map() }; orders.set(line.orderId,order); }
   const normalized = { id: line.orderItemId, sku: line.sku, quantity: line.quantity, title: line.title, providerStatus: line.status, shipmentId: shipment.shipmentId, locationId: shipment.locationId, updatedAt: new Date(shipment.updatedAt).toISOString(), orderedAt: new Date(line.orderDate).toISOString() };
   const prior = order.lines.get(line.orderItemId);
   if (prior && prior.updatedAt === normalized.updatedAt && JSON.stringify(prior) !== JSON.stringify(normalized)) throw failure('FLIPKART_CONFLICTING_ITEM');
   if (!prior || prior.updatedAt <= normalized.updatedAt) order.lines.set(line.orderItemId,normalized);
  }
 }
 return [...orders.values()].map(order => {
  const lines = [...order.lines.values()].sort((a,b)=>a.id.localeCompare(b.id)), statuses = [...new Set(lines.map(line=>line.providerStatus))];
  return { id: order.id, status: statuses.every(status=>status==='CANCELLED') ? 'cancelled' : statuses.length===1 ? statuses[0] : 'MIXED', created_at: lines.map(line=>line.orderedAt).sort()[0], updated_at: lines.map(line=>line.updatedAt).sort().at(-1), line_items: lines };
 });
}
