// Resolve database selection without exposing connection credentials.
export function resolveMongoConfiguration(env = process.env) {
  const configuredDatabase = env.MONGODB_DB?.trim();
  const explicitDatabase = Boolean(configuredDatabase);
  const required = env.NODE_ENV === 'production' || env.DMILLS_REQUIRE_PERSISTENCE === 'true';
  // Production may use the documented default database when MONGODB_DB is
  // absent; Render's Blueprint sets it explicitly, but the app must not fail
  // if a service was created outside that Blueprint.
  const selectedDatabase = explicitDatabase ? configuredDatabase : 'd_mills_global';
  if (/[\/\\. "$\x00]/.test(selectedDatabase) || Buffer.byteLength(selectedDatabase) > 63) {
    throw new Error('MONGODB_DB must be a valid database name, not a connection string.');
  }
  let uriDatabase = null;
  let maskedHost = null;
  if (env.MONGODB_URI) {
    try {
      const uri = new URL(env.MONGODB_URI);
      if (!['mongodb:', 'mongodb+srv:'].includes(uri.protocol)) throw new Error('Invalid Mongo protocol');
      for (const [key, value] of uri.searchParams) {
        if ((['tlsinsecure', 'tlsallowinvalidcertificates', 'tlsallowinvalidhostnames'].includes(key.toLowerCase()) && value.toLowerCase() === 'true') || (['tls', 'ssl'].includes(key.toLowerCase()) && value.toLowerCase() === 'false')) {
          throw Object.assign(new Error('MongoDB TLS verification must remain enabled.'), { code: 'UNSAFE_MONGO_TLS' });
        }
      }
      uriDatabase = decodeURIComponent(uri.pathname.slice(1)) || null;
      maskedHost = uri.hostname.endsWith('.mongodb.net') ? '[masked-cluster].mongodb.net' : '[masked-host]';
    } catch (error) {
      if (error.code === 'UNSAFE_MONGO_TLS') throw error;
      // Never propagate URL parser errors: they can include the supplied URI.
      maskedHost = '[masked-host]';
    }
  }
  const warnings = [];
  if (!explicitDatabase) warnings.push('MONGODB_DB_UNSET_DEFAULT_USED');
  if (uriDatabase && uriDatabase !== selectedDatabase) warnings.push('MONGODB_URI_DATABASE_OVERRIDDEN');
  return { selectedDatabase, maskedHost, warnings };
}
