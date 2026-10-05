export default function RequestErrorState({ error, onRetry }: { error: Error & { status?: number }; onRetry?: () => void }) {
  const status = error.status;
  const title = status === 503 ? 'Data temporarily unavailable' : status === 401 ? 'Sign in required' : status === 403 ? 'Access denied' : status === 404 ? 'API route not found' : status === 429 ? 'Too many requests' : status === 504 ? 'Request timed out' : status === 502 ? 'Service response unavailable' : status === 500 ? 'Server error' : status === 400 || status === 422 ? 'Check the request' : 'Unable to load data';
  return <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-slate-700"><strong>{title}</strong><p className="mt-1">{error.message}</p>{onRetry && <button className="mt-3 rounded border px-3 py-1" onClick={onRetry}>Retry</button>}</div>;
}
