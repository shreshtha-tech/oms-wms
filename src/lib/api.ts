import { recordRequestFailure } from './requestFailures';
type ApiBody = { kind: 'json'; value: unknown } | { kind: 'form'; value: Record<string, unknown> };
const mutations = new Map<string, Promise<unknown>>();
export function apiRequest<T = any>(path: string, method = 'GET', body?: ApiBody, timeoutMs = 30000): Promise<T> {
  const read = method === 'GET' || (body?.kind === 'json' && !!(body.value as Record<string, unknown>)?.REQ_SEARCH_FLAG) || (body?.kind === 'form' && !!body.value.REQ_SEARCH_FLAG);
  const key = `${method}:${path}:${JSON.stringify(body)}`;
  if (!read && mutations.has(key)) return mutations.get(key) as Promise<T>;
  const request = performRequest<T>(path, method, body, timeoutMs, read);
  if (!read) {
    mutations.set(key, request);
    void request.finally(() => mutations.delete(key)).catch(() => {});
  }
  return request;
}
async function performRequest<T>(path: string, method: string, body: ApiBody | undefined, timeoutMs: number, tracksRead: boolean): Promise<T> {
  const requestPage = window.location.pathname;
  const requestKey = `${method}:${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body?.kind === 'json') { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body.value); }
  else if (body?.kind === 'form') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body.value)) if (value !== undefined && value !== null) form.set(key, String(value));
    payload = form;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal: controller.signal });
    let malformed = false;
    const result = await response.json().catch(() => { malformed = true; return null; });
    if (!response.ok || malformed) {
      const error = new Error(result?.message || result?.jsonMessage || result?.error || (response.ok ? 'The server returned an invalid response.' : `Request failed (HTTP ${response.status})`)) as Error & { response?: unknown; status?: number };
      error.response = result; error.status = response.ok ? 502 : response.status;
      throw error;
    }
    if (tracksRead) recordRequestFailure(requestPage, requestKey);
    return result as T;
  } catch (caught) {
    const error = controller.signal.aborted ? Object.assign(new Error('The request timed out. Please retry.'), { status: 504 }) : caught instanceof Error ? caught : new Error('Network request failed. Please retry.');
    if (tracksRead) recordRequestFailure(requestPage, requestKey, { error, retry: () => apiRequest(path, method, body, timeoutMs) });
    throw error;
  } finally { window.clearTimeout(timer); }
}
export const apiGet = <T = any>(path: string, timeoutMs?: number) => apiRequest<T>(path, 'GET', undefined, timeoutMs);
export const apiSend = <T = any>(path: string, method: string, body: unknown) => apiRequest<T>(path, method, { kind: 'json', value: body });
export const apiForm = <T = any>(path: string, body: Record<string, unknown>) => apiRequest<T>(path, 'POST', { kind: 'form', value: body });
export const money = (n: number) => '\u20b9' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
