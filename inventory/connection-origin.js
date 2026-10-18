const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const localVitePorts = new Set(['5173', '5174']);

function loopbackAddress(address = '') {
  return address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.');
}

export function connectionRequestOriginAllowed(req, { publicOrigin = process.env.INVENTORY_PUBLIC_ORIGIN, renderOrigin = process.env.RENDER_EXTERNAL_URL, production = process.env.NODE_ENV === 'production' } = {}) {
  const origin = req.get('origin');
  if (!origin) return true;
  if (origin === 'null') return false;

  // The browser can reach the same service through its Render URL or a custom
  // domain. A same-origin mutation is valid even when OAuth uses another URL.
  if (origin === `${req.protocol}://${req.get('host')}`) return true;
  // Render supplies its public URL independently of Express proxy settings.
  if (renderOrigin && origin === renderOrigin) return true;
  if (publicOrigin) return origin === publicOrigin;
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
