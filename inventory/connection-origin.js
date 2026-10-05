const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const localVitePorts = new Set(['5173', '5174']);

function loopbackAddress(address = '') {
  return address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.');
}

export function connectionRequestOriginAllowed(req, { publicOrigin = process.env.INVENTORY_PUBLIC_ORIGIN, production = process.env.NODE_ENV === 'production' } = {}) {
  const origin = req.get('origin');
  if (!origin) return true;
  if (origin === 'null') return false;

  // The configured public URL is authoritative behind a production proxy.
  if (publicOrigin) return origin === publicOrigin;
  if (origin === `${req.protocol}://${req.get('host')}`) return true;
  if (production || !loopbackAddress(req.socket.remoteAddress)) return false;

  // Vite forwards local browser requests to the API with its own Host header.
  // Only accept the two local Vite ports; this never applies to remote clients.
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && localHosts.has(url.hostname) && localVitePorts.has(url.port) && url.origin === origin;
  } catch {
    return false;
  }
}
