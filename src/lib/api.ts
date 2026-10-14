import { recordRequestFailure } from './requestFailures';
type ApiBody = { kind: 'json'; value: unknown } | { kind: 'form'; value: Record<string, unknown> };
const mutations = new Map<string, Promise<unknown>>();
export function apiRequest<T = any>(path: string, method = 'GET', body?: ApiBody, timeoutMs = 30000, failureScope: 'page' | 'local' = 'page'): Promise<T> {
  const read = method === 'GET' || (body?.kind === 'json' && !!(body.value as Record<string, unknown>)?.REQ_SEARCH_FLAG) || (body?.kind === 'form' && !!body.value.REQ_SEARCH_FLAG);
  const key = `${method}:${path}:${JSON.stringify(body)}`;
  if (!read && mutations.has(key)) return mutations.get(key) as Promise<T>;
  const request = performRequest<T>(path, method, body, timeoutMs, read, failureScope);
  if (!read) {
    mutations.set(key, request);
    void request.finally(() => mutations.delete(key)).catch(() => {});
  }
  return request;
}
async function performRequest<T>(path: string, method: string, body: ApiBody | undefined, timeoutMs: number, tracksRead: boolean, failureScope: 'page' | 'local'): Promise<T> {
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
  let responseStatus: number | undefined;
  try {
    const response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal: controller.signal });
    responseStatus = response.status;
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
    // A lost response cannot establish whether a dispatched write committed.
    // Preserve explicit HTTP failures; transport loss and unreadable success
    // responses require reconciliation rather than another write.
    const uncertain = !tracksRead && (responseStatus === undefined || (responseStatus >= 200 && responseStatus < 300));
    const error = uncertain
      ? Object.assign(new Error('The operation outcome is unknown. Check the saved record or operation status before retrying.'), { code: 'REQUEST_OUTCOME_UNKNOWN', status: controller.signal.aborted ? 504 : 502 })
      : controller.signal.aborted ? Object.assign(new Error('The request timed out. Please retry.'), { status: 504 }) : caught instanceof Error ? caught : new Error('Network request failed. Please retry.');
    if (tracksRead) {
      if (failureScope === 'page') recordRequestFailure(requestPage, requestKey, { error, retry: () => apiRequest(path, method, body, timeoutMs) });
      else recordRequestFailure(requestPage, requestKey);
    }
    throw error;
  } finally { window.clearTimeout(timer); }
}
export const apiGet = <T = any>(path: string, timeoutMs?: number) => apiRequest<T>(path, 'GET', undefined, timeoutMs);
export const apiGetLocal = <T = any>(path: string, timeoutMs?: number) => apiRequest<T>(path, 'GET', undefined, timeoutMs, 'local');
export const apiSend = <T = any>(path: string, method: string, body: unknown) => apiRequest<T>(path, method, { kind: 'json', value: body });
export const apiForm = <T = any>(path: string, body: Record<string, unknown>) => apiRequest<T>(path, 'POST', { kind: 'form', value: body });
export const money = (n: number) => '\u20b9' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
