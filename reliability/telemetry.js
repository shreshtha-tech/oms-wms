import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
export const requestContext = new AsyncLocalStorage();
const metrics = new Map();
const histograms = new Map();
const latencyBounds = Object.freeze([1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]);
export function observeLatency(name, labels = {}, milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
  const key = `${name}:${JSON.stringify(labels)}`;
  let record = histograms.get(key);
  if (!record) {
    if (histograms.size >= 512) { increment('latency_series_dropped_total'); return; }
    record = { name, labels: { ...labels }, count: 0, sumMs: 0, maxMs: 0, buckets: latencyBounds.map(le => ({ le, count: 0 })), overflow: 0 };
    histograms.set(key, record);
  }
  record.count++; record.sumMs += milliseconds; record.maxMs = Math.max(record.maxMs, milliseconds);
  for (const bucket of record.buckets) if (milliseconds <= bucket.le) bucket.count++;
  if (milliseconds > latencyBounds.at(-1)) record.overflow++;
}
export function latencySnapshot() { return [...histograms.values()].map(record => ({ ...record, labels: { ...record.labels }, buckets: record.buckets.map(bucket => ({ ...bucket })) })); }
export function increment(name, labels = {}, value = 1) {
  const key = `${name}:${JSON.stringify(labels)}`;
  const prior = metrics.get(key) || { name, labels, value: 0 };
  prior.value += value;
  if (metrics.size < 2000 || metrics.has(key)) metrics.set(key, prior);
}
export function metricSnapshot() { return [...metrics.values()]; }
// Deliberately allowlisted fields; never serialize payloads, errors or URLs.
export function logEvent(event, fields = {}) {
  const allowed = ['database','state','previous','code','provider','operation','attempt','duration_ms','result','method','route','status','request_id','tenant_id','operator_id'];
  const context = requestContext.getStore() || {};
  const safe = Object.fromEntries(Object.entries({ ...context, ...fields }).filter(([key]) => allowed.includes(key)));
  try { console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...safe })); } catch {}
}
export function requestTelemetry(req, res, next) {
  const request_id = /^[a-zA-Z0-9_-]{8,80}$/.test(req.get('x-request-id') || '') ? req.get('x-request-id') : randomUUID();
  const start = performance.now();
  res.set('X-Request-Id', request_id);
  requestContext.run({ request_id }, () => {
    res.once('finish', () => {
      // Express matched patterns avoid storing query strings or account IDs.
      const route = req.route?.path?.toString() || (req.path.startsWith('/api') ? '/api/unmatched' : '/static');
      const labels = { method: req.method, route, status: res.statusCode };
      increment('http_requests_total', labels);
      increment('http_duration_ms_total', { method: req.method, route }, performance.now() - start);
      observeLatency('http_duration_ms', { method: req.method, route }, performance.now() - start);
      logEvent('http_request', { ...labels, duration_ms: Math.round(performance.now() - start), tenant_id: req.inventoryTenantId, operator_id: req.user?.username, request_id });
    });
    next();
  });
}
