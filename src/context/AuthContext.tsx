import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type User = { username: string };
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

  useEffect(() => {
    // Discard legacy browser state from the reference-site replica.
    localStorage.removeItem('vin_user');
    localStorage.removeItem('arena_vid');
    sessionStorage.removeItem('__arena_rec');
    let active=true;
    const refresh=()=>{fetch('/api/auth/session', { credentials: 'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000) })
      .then(response => {if(!response.ok)throw new Error('Session service unavailable');return response.json();})
      .then(result => {if(active)setUser(result.user || null);})
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
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        signal: AbortSignal.timeout(10000), credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok) return { ok: false, error: result.error || 'Login failed' };
      setUser(result.user);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Unable to reach the login service.' };
    }
  };

  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST',
        signal: AbortSignal.timeout(10000), credentials: 'same-origin' }); }
    finally { setUser(null); }
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
