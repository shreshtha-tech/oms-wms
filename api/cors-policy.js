const methods = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const headers = 'Content-Type, Authorization';

export function allowedCorsOrigins(configured = process.env.CORS_ORIGINS || '') {
  const entries = configured.split(',').map(value => value.trim()).filter(Boolean);
  const origins = new Set();
  for (const entry of entries) {
    let url;
    try { url = new URL(entry); } catch { return new Set(); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== entry || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return new Set();
    origins.add(entry);
  }
  return origins;
}

export function cors(req, res) {
  const origin = req.get?.('origin') ?? req.headers?.origin;
  if (origin) {
    const prior = String(res.getHeader?.('Vary') || '');
    if (!prior.split(',').some(value => value.trim().toLowerCase() === 'origin')) res.setHeader('Vary', prior ? `${prior}, Origin` : 'Origin');
  }
  const allowed = typeof origin === 'string' && allowedCorsOrigins().has(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', headers);
  }
  if (req.method === 'OPTIONS') {
    if (origin && !allowed) res.status(403).end();
    else res.status(204).end();
    return true;
  }
  return false;
}
