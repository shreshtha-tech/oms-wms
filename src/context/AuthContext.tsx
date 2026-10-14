import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type User = { username: string; permissions?: string[] };
type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({ user: null, loading: true, login: async () => ({ ok: false }), logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const authRevision = useRef(0);
  const refreshSequence = useRef(0);

  useEffect(() => {
    // Discard legacy browser state from the reference-site replica.
    localStorage.removeItem('vin_user');
    localStorage.removeItem('arena_vid');
    sessionStorage.removeItem('__arena_rec');
    let active=true;
    const refresh=()=>{const revision=authRevision.current, sequence=++refreshSequence.current;fetch('/api/auth/session', { credentials: 'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000) })
      .then(response => {if(!response.ok)throw new Error('Session service unavailable');return response.json();})
      .then(result => {if(active&&revision===authRevision.current&&sequence===refreshSequence.current)setUser(result.user || null);})
      .catch(() => {})
      .finally(() => {if(active)setLoading(false);});};
    refresh();
    const visible=()=>{if(document.visibilityState==='visible')refresh();};
    window.addEventListener('online',refresh);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',visible);
    return()=>{active=false;window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visible);};
  }, []);

  const login = async (username: string, password: string) => {
    const revision = ++authRevision.current;
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        signal: AbortSignal.timeout(10000), credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      let result: unknown;
      try { result = await response.json(); }
      catch { return { ok: false, error: response.ok ? 'Sign-in response was incomplete. Please check your session before retrying.' : `Sign-in service returned HTTP ${response.status}.` }; }
      if (revision !== authRevision.current) return { ok: false, error: 'A newer sign-in or sign-out replaced this request.' };
      const payload = result && typeof result === 'object' ? result as { user?: unknown; message?: unknown; error?: unknown } : {};
      if (!response.ok) return { ok: false, error: typeof payload.message === 'string' ? payload.message : typeof payload.error === 'string' ? payload.error : `Sign-in failed (HTTP ${response.status}).` };
      if (!payload.user || typeof payload.user !== 'object' || typeof (payload.user as User).username !== 'string' || !(payload.user as User).username) {
        return { ok: false, error: 'Sign-in response was incomplete. Please check your session before retrying.' };
      }
      ++authRevision.current;
      setUser(payload.user as User);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Sign-in outcome is unknown. Check your session before retrying.' };
    }
  };

  const logout = async () => {
    const revision = ++authRevision.current;
    let response: Response;
    try { response = await fetch('/api/auth/logout', { method: 'POST',
        signal: AbortSignal.timeout(10000), credentials: 'same-origin' }); }
    catch { throw new Error('Sign-out outcome is unknown. Check your session before retrying.'); }
    if (!response.ok) throw new Error('Sign-out failed. Your session may still be active.');
    let result: unknown;
    try { result = await response.json(); }
    catch { throw new Error('Sign-out outcome is unknown. Check your session before retrying.'); }
    if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) throw new Error('Sign-out outcome is unknown. Check your session before retrying.');
    if (revision === authRevision.current) { ++authRevision.current; setUser(null); }
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
