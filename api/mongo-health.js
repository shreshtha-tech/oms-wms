// Shared response decisions keep status and HTTP contracts testable offline.
export function mongoReadinessSatisfied(required, probeSucceeded, mongo) {
  return !required || (probeSucceeded && mongo.state === 'READY' && mongo.datasetState === 'POPULATED');
}
export function mongoHealthPayload(configuration, connection, dataset) {
  return { selectedDatabase: configuration.selectedDatabase, maskedHost: configuration.maskedHost,
    warnings: [...configuration.warnings], database: 'mongodb', state: connection.state,
    reason: connection.reason, ...dataset };
}
export function applyMongoDatasetHeader(response, mongo) {
  if (mongo.datasetEmpty === true) response.set('X-Mongo-Dataset-Empty', 'true');
}

// Public health responses contain classifications only, never configuration.
export function publicReadiness({ shuttingDown, schemaReady, postgresState, mongoRequired, probeSucceeded, mongo, authenticationRequired, authenticationConfigured }) {
  const ready = !shuttingDown && schemaReady && mongoReadinessSatisfied(mongoRequired, probeSucceeded, mongo) && (!authenticationRequired || authenticationConfigured);
  const mongodb = mongo.datasetState === 'AUTHENTICATION_FAILED' ? 'AUTH_FAILED'
    : !probeSucceeded ? 'UNREACHABLE'
    : mongo.state === 'READY' && mongo.datasetState === 'POPULATED' ? 'READY'
    : mongo.state === 'READY' && mongo.datasetEmpty === true ? 'EMPTY'
    : ['ACCESS_DENIED', 'INSPECTION_UNAVAILABLE', 'UNCONFIGURED'].includes(mongo.datasetState) ? mongo.datasetState : 'UNREACHABLE';
  return { ready, status: ready ? 'ready' : 'not_ready', dependencies: {
    mongodb, postgres: schemaReady ? 'READY' : postgresState === 'READY' ? 'SCHEMA_UNAVAILABLE' : 'UNREACHABLE',
    authentication: authenticationRequired && !authenticationConfigured ? 'UNCONFIGURED' : 'READY',
  } };
}

// Headers are diagnostic only. Start a single bounded refresh and immediately
// serve the last observation; handlers retain their own fail-closed DB checks.
export function createDatasetHeaderObserver(inspect, { cacheMs = 15000, timeoutMs = 750 } = {}) {
  let cached = {}, refreshedAt = 0, pending, inspecting = false;
  return response => {
    if (!pending && !inspecting && Date.now() - refreshedAt >= cacheMs) {
      let timer;
      inspecting = true;
      const inspection = Promise.resolve().then(inspect).finally(() => { inspecting = false; });
      pending = Promise.race([
        inspection,
        new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); timer.unref?.(); }),
      ]).then(value => { if (value) cached = value; }, () => {}).finally(() => {
        clearTimeout(timer); refreshedAt = Date.now(); pending = null;
      });
    }
    applyMongoDatasetHeader(response, cached);
  };
}
