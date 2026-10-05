import { increment, logEvent } from './telemetry.js';
const circuits = new Map();
const transientStatus = status => status === 429 || [500,502,503,504].includes(status);
const transientError = error => ['ECONNRESET','ETIMEDOUT','EAI_AGAIN','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT'].includes(error?.code) || error?.name === 'TimeoutError' || (error?.name === 'AbortError' && error?.cause?.name === 'TimeoutError');
export async function providerCall(operation, { provider, name = 'request', safeToRetry = false, maxAttempts = 3, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random, now = Date.now, circuitKey = provider } = {}) {
  maxAttempts = Number.isInteger(maxAttempts) ? Math.max(1, Math.min(5, maxAttempts)) : 3;
  const breaker = circuits.get(circuitKey) || { failures: 0, openUntil: 0, probe: false };
  if (circuits.size < 500 || circuits.has(circuitKey)) circuits.set(circuitKey, breaker);
  if (breaker.openUntil > now() || (breaker.openUntil && breaker.probe)) throw Object.assign(new Error('Provider service is temporarily unavailable.'), { status: 503, code: 'PROVIDER_CIRCUIT_OPEN' });
  if (breaker.openUntil) breaker.probe = true;
  try {
    for (let attempt = 1; attempt <= (safeToRetry ? maxAttempts : 1); attempt++) {
      const start = performance.now();
      let response, failure;
      try { response = await operation(attempt); } catch (error) { failure = error; }
      if (!failure && (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599)) {
        failure = Object.assign(new Error('The provider returned an invalid response.'), { status: 502, code: 'PROVIDER_INVALID_RESPONSE' });
      }
      const transient = failure ? transientError(failure) : transientStatus(response?.status);
      increment('provider_calls_total', { provider, operation: name, result: failure ? 'error' : String(response?.status) });
      increment('provider_duration_ms_total', { provider, operation: name }, performance.now() - start);
      logEvent('provider_call', { provider, operation: name, attempt, duration_ms: Math.round(performance.now() - start), result: failure ? 'error' : String(response?.status) });
      if (!transient) { breaker.failures = 0; breaker.openUntil = 0; if (failure) throw failure; return response; }
      if (!safeToRetry || attempt === maxAttempts) {
        if (++breaker.failures >= 5) breaker.openUntil = now() + 30000;
        if (failure) throw failure;
        return response;
      }
      const header = response?.headers?.get?.('retry-after');
      const retryAfter = header && /^\d+$/.test(header) ? Number(header) * 1000 : 0;
      const delay = Math.min(5000, Math.max(retryAfter, 250 * 2 ** (attempt - 1) * (0.5 + random())));
      increment('provider_retries_total', { provider, operation: name });
      await sleep(delay);
    }
  } finally { breaker.probe = false; }
}
