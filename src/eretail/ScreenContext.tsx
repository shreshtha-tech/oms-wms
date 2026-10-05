import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

export type OpenScreen = {
  label: string;
  path: string;
  closable: boolean;
};

type OpenResult = 'opened' | 'activated' | 'limit';

type ScreenContextValue = {
  screens: OpenScreen[];
  history: OpenScreen[];
  closingPaths: string[];
  orderType: string;
  setOrderType: (value: string) => void;
  feedback: { id: number; msg: string; type: 'ok' | 'err' } | null;
  showFeedback: (msg: string, type: 'ok' | 'err') => void;
  clearFeedback: () => void;
  blocking: boolean;
  setBlocking: (source: string, active: boolean) => void;
  openScreen: (screen: Omit<OpenScreen, 'closable'> & { closable?: boolean }) => OpenResult;
  activateScreen: (label: string) => OpenScreen | null;
  goBack: () => OpenScreen | null;
  closeScreen: (label: string) => OpenScreen | null;
  settleNavigation: (currentPath: string) => void;
};

const DASHBOARD: OpenScreen = { label: 'Dashboard', path: '/app/dashboard', closable: false };
const ScreenContext = createContext<ScreenContextValue | null>(null);
type ScreenFrame = { key: string; path: string };
const ScreenFrameContext = createContext<ScreenFrame | null>(null);

export function ScreenFrameProvider({ frameKey, path, children }: { frameKey: string; path: string; children: ReactNode }) {
  return <ScreenFrameContext.Provider value={{ key: frameKey, path }}>{children}</ScreenFrameContext.Provider>;
}

export function useScreenFrame() {
  return useContext(ScreenFrameContext);
}

export function ScreenProvider({ children }: { children: ReactNode }) {
  const [screens, setScreens] = useState<OpenScreen[]>([DASHBOARD]);
  const screensRef = useRef<OpenScreen[]>([DASHBOARD]);
  const [history, setHistory] = useState<OpenScreen[]>([DASHBOARD]);
  const historyRef = useRef<OpenScreen[]>([DASHBOARD]);
  const [closingPaths, setClosingPaths] = useState<string[]>([]);
  const [orderType, setOrderType] = useState('1');
  const [feedback, setFeedback] = useState<{ id: number; msg: string; type: 'ok' | 'err' } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackIdRef = useRef(0);
  const blockingSourcesRef = useRef(new Set<string>());
  const [blocking, setBlockingState] = useState(false);

  const setBlocking = useCallback((source: string, active: boolean) => {
    if (active) blockingSourcesRef.current.add(source);
    else blockingSourcesRef.current.delete(source);
    setBlockingState(blockingSourcesRef.current.size > 0);
  }, []);

  const clearFeedback = useCallback(() => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
    setFeedback(null);
  }, []);

  const showFeedback = useCallback((msg: string, type: 'ok' | 'err') => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    const next = { id: ++feedbackIdRef.current, msg, type };
    setFeedback(next);
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback((current) => current?.id === next.id ? null : current);
      feedbackTimerRef.current = null;
    }, 15000);
  }, []);

  const openScreen = useCallback((requested: Omit<OpenScreen, 'closable'> & { closable?: boolean }): OpenResult => {
    const screen: OpenScreen = {
      label: requested.label,
      path: requested.path,
      closable: requested.label !== DASHBOARD.label && requested.closable !== false,
    };
    const current = screensRef.current;
    const existing = current.some((item) => item.label === screen.label);
    const result: OpenResult = existing
      ? 'activated'
      : current.filter((item) => item.closable).length >= 10 ? 'limit' : 'opened';
    if (result === 'opened') {
      screensRef.current = [...current, screen];
      setScreens(screensRef.current);
    } else if (result === 'activated') {
      // LIVE keeps the named tab but reloads it when the same name is opened with a new URL.
      const refreshed = current.map((item) => item.label === screen.label ? { ...item, path: screen.path } : item);
      if (refreshed.some((item, index) => item.path !== current[index].path)) {
        screensRef.current = refreshed;
        setScreens(refreshed);
      }
    }
    if (result !== 'limit') {
      historyRef.current = [...historyRef.current, screen].slice(-20);
      setHistory(historyRef.current);
    }
    return result;
  }, []);

  const activateScreen = useCallback((label: string): OpenScreen | null => {
    const screen = screensRef.current.find((item) => item.label === label) || null;
    if (!screen) return null;
    historyRef.current = [...historyRef.current, screen].slice(-20);
    setHistory(historyRef.current);
    return screen;
  }, []);

  const goBack = useCallback((): OpenScreen | null => {
    if (historyRef.current.length <= 1) return null;
    historyRef.current = historyRef.current.slice(0, -1);
    setHistory(historyRef.current);
    return historyRef.current[historyRef.current.length - 1] || null;
  }, []);

  const closeScreen = useCallback((label: string): OpenScreen | null => {
    const current = screensRef.current;
    const closingIndex = current.findIndex((item) => item.label === label);
    if (closingIndex < 0 || !current[closingIndex].closable) return null;
    const next = current[closingIndex - 1] || current[closingIndex + 1] || DASHBOARD;
    setClosingPaths((paths) => paths.includes(current[closingIndex].path) ? paths : [...paths, current[closingIndex].path]);
    screensRef.current = current.filter((item) => item.label !== label);
    setScreens(screensRef.current);
    return next;
  }, []);

  const settleNavigation = useCallback((currentPath: string) => {
    setClosingPaths((paths) => paths.filter((path) => path === currentPath));
  }, []);

  const value = useMemo(() => ({ screens, history, closingPaths, orderType, setOrderType, feedback, showFeedback, clearFeedback, blocking, setBlocking, openScreen, activateScreen, goBack, closeScreen, settleNavigation }), [screens, history, closingPaths, orderType, feedback, showFeedback, clearFeedback, blocking, setBlocking, openScreen, activateScreen, goBack, closeScreen, settleNavigation]);
  return <ScreenContext.Provider value={value}>{children}</ScreenContext.Provider>;
}

export function useScreens() {
  const value = useContext(ScreenContext);
  if (!value) throw new Error('useScreens must be used inside ScreenProvider');
  return value;
}

export function useGlobalBlocking(active: boolean) {
  const source = useId();
  const { setBlocking } = useScreens();
  useEffect(() => {
    setBlocking(source, active);
    return () => setBlocking(source, false);
  }, [active, setBlocking, source]);
}

export function GlobalScreenOverlayHost() {
  const { feedback, clearFeedback, blocking } = useScreens();
  return <>
    {blocking && <div data-global-blocking="true" aria-busy="true" aria-label="Loading" className="fixed inset-0 z-[2000] bg-black/40">
      <div data-global-blocking-panel="true" className="fixed left-1/2 top-1/2 flex h-[45px] w-[140px] -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-white shadow">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-[#3c8dbc]" />
      </div>
    </div>}
    {feedback && <div
      key={feedback.id}
      role={feedback.type === 'err' ? 'alert' : 'status'}
      data-feedback-type={feedback.type}
      className={`pointer-events-none fixed right-[2px] top-[52px] z-[25000] flex min-h-[52px] w-[302px] items-center border px-3 py-2 text-sm shadow-lg ${feedback.type === 'ok' ? 'border-emerald-500 bg-emerald-100 text-emerald-950' : 'border-amber-500 bg-amber-100 text-slate-900'}`}
    >
      <span className="flex-1">{feedback.msg}</span>
      <button aria-label="Dismiss message" onClick={clearFeedback} className="pointer-events-auto ml-2 text-current/60 hover:text-current">×</button>
    </div>}
  </>;
}
