import { useSyncExternalStore } from 'react';

type Failure = { error: Error & { status?: number }; retry: () => Promise<unknown> };
const failures = new Map<string, Map<string, Failure>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export function recordRequestFailure(page: string, request: string, failure?: Failure) {
  const requests = failures.get(page) || new Map<string, Failure>();
  if (failure) requests.set(request, failure); else requests.delete(request);
  failures.set(page, requests);
  notify();
}
export function useRequestFailure() {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    () => failures.get(window.location.pathname)?.values().next().value as Failure | undefined,
    () => undefined);
}
