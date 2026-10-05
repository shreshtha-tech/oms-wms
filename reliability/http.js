import { connectionRequestOriginAllowed } from '../inventory/connection-origin.js';
import { metricSnapshot, requestTelemetry } from './telemetry.js';
export { requestTelemetry };
export function mutationOriginGuard(req, res, next) {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  // Non-browser webhook/agent clients use signature/token authentication.
  const origin = req.get('origin');
  if (!origin) {
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'ORIGIN_DENIED', message: 'Request origin is not allowed.' });
    return next();
  }
  if (!connectionRequestOriginAllowed(req)) return res.status(403).json({ error: 'ORIGIN_DENIED', message: 'Request origin is not allowed.' });
  next();
}
export function protectAsyncRoutes(router) {
  for (const layer of router.stack || router._router?.stack || []) {
    if (layer.route?.stack) protectAsyncRoutes({ stack: layer.route.stack });
    if (layer.handle?.stack) protectAsyncRoutes(layer.handle);
    const handler = layer.handle;
    if (typeof handler !== 'function' || handler.length === 4 || handler.reliabilityWrapped) continue;
    const wrapped = function(req, res, next) { try { const result = handler(req, res, next); if (result?.then) result.catch(next); } catch (error) { next(error); } };
    wrapped.reliabilityWrapped = true;
    layer.handle = wrapped;
  }
}
export function internalMetrics(_req, res) { res.json({ metrics: metricSnapshot() }); }
