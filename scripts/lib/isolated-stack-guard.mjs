// Loaded before application imports; never loads dotenv or configured clients.
export function validateTestStores(env) {
  if (env.NODE_ENV !== 'test' || !/^[a-z][a-z0-9_]*_test$/.test(env.MONGODB_DB || '')) throw new Error('Isolated test configuration required');
  for (const [key, protocol] of [['MONGODB_URI', 'mongodb:'], ['INVENTORY_DATABASE_URL', 'postgresql:']]) {
    let url;
    try { url = new URL(env[key]); } catch { throw new Error('Invalid isolated store configuration'); }
    if (url.protocol !== protocol || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.hash || !/^[a-z][a-z0-9_]*_test$/.test(url.pathname.slice(1))) throw new Error('Non-isolated store refused');
    const allowed = key === 'MONGODB_URI' ? new Set(['replicaSet']) : new Set();
    if ([...url.searchParams.keys()].some(key => !allowed.has(key))) throw new Error('Store override refused');
    if (key === 'MONGODB_URI' && url.pathname.slice(1) !== env.MONGODB_DB) throw new Error('Mongo test identity mismatch');
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined || env.PGHOST !== undefined || env.PGSERVICE !== undefined) throw new Error('Connection override refused');
  return true;
}
