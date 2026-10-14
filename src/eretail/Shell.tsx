import { useRequestFailure } from '../lib/requestFailures';
import RequestErrorState from '../components/RequestErrorState';
import { useState, useEffect, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X, LogOut, User, Search, Maximize2, Flag, Download, MapPin, Asterisk } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { RAIL, RailEntry } from './menuData';
import { apiSend } from '../lib/api';
import { useScreenFrame, useScreens } from './ScreenContext';
import './ShellResponsive.css';

function Flyout({ entry, onNav }: { entry: RailEntry; onNav: () => void }) {
  const nav = useNavigate();
  const go = (to?: string) => { if (to) { nav(to); onNav(); } };
  const columnCount = entry.columns!.length;
  const rowCount = Math.max(...entry.columns!.map((column) => column.groups.length));
  const groups = Array.from({ length: rowCount }, (_, row) =>
    entry.columns!.map((column, columnIndex) => column.groups[row] ? ({ group: column.groups[row], columnIndex, row }) : null).filter(Boolean),
  ).flat() as { group: NonNullable<RailEntry['columns']>[number]['groups'][number]; columnIndex: number; row: number }[];
  const measuredHeights: Record<string, Record<string, number>> = {
    wms: { Setup: 225, 'Order Processing': 225, Inventory: 225, Inbound: 155, Miscellaneous: 155 },
    admin: { Miscellaneous: 130, Logs: 170 },
    reports: { 'Sales & Return': 171, Miscellaneous: 120 },
    returns: { Transfers: 80 },
  };
  return (
    <div data-menu-flyout data-menu-kind={entry.key} className="absolute left-full top-0 z-50 w-[630px] overflow-visible text-slate-200">
      <div className="flex h-[40px] items-center bg-[#26313f] px-[15px] text-[16px] font-semibold text-white">{entry.title}</div>
      <div data-menu-flyout-body className="grid h-[419px] w-[630px] auto-rows-max grid-cols-[repeat(3,200px)] content-start items-start gap-[6px] bg-[#26313f] p-[5px]">
        {groups.map(({ group: g, columnIndex, row }, index) => (
          <div key={`${g.title}-${index}`} data-menu-group={g.title} style={{ gridColumn: columnIndex + 1, gridRow: row + 1, height: measuredHeights[entry.key]?.[g.title], transform: entry.key === 'procurement' && g.title === 'ARS' ? 'translateY(-20px)' : undefined }} className={`w-[200px] self-start overflow-x-hidden ${g.title === 'SKU Management' ? 'max-h-[171px] overflow-y-auto' : 'overflow-y-visible'}`}>
            {g.title && <div className="border-b border-white/10 px-[5px] py-[3px] text-[13px] font-semibold text-slate-300">{g.title}</div>}
            <ul className="py-[2px]">
              {g.items.map((it) => (
                <li key={it.label} className="h-[20px]">
                  <button title={it.to ? it.label : `${it.label} is unavailable in this release`}
                    aria-label={it.to ? it.label : `${it.label}, unavailable in this release`}
                    aria-disabled={!it.to}
                    disabled={!it.to}
                    onClick={() => go(it.to)}
                    className={`ml-[20px] flex h-[13.5px] w-auto items-center gap-[5px] whitespace-nowrap px-0 text-left text-[12px] leading-[13.5px] ${it.to ? 'text-slate-200 hover:text-[#5ec6d9]' : 'cursor-not-allowed text-slate-500 opacity-65'}`}
                  >
                    <ChevronRight size={11} className="shrink-0 text-[#3fb6c9]" />
                    {it.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Shell({
  children, active, breadcrumb, openScreens,
}: {
  children: ReactNode;
  active: string;
  breadcrumb: string;
  openScreens?: { label: string; to: string }[];
}) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const requestFailure = useRequestFailure();
  const screenFrame = useScreenFrame();
  const { screens, history, showFeedback, openScreen, activateScreen: recordActivation, goBack, closeScreen, orderType, setOrderType } = useScreens();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [userMenu, setUserMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [screenMenu, setScreenMenu] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [language, setLanguage] = useState('English');
  const [timeZone, setTimeZone] = useState('Asia/Calcutta');
  const [defaultLocation, setDefaultLocation] = useState('remainSame');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [passwords, setPasswords] = useState({ old: '', next: '', confirm: '' });
  const [passwordError, setPasswordError] = useState('');
  const [signOutError, setSignOutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError('');
    try { await logout(); nav('/'); }
    catch (error) { setSignOutError(error instanceof Error ? error.message : 'Sign-out outcome is unknown. Check your session before retrying.'); }
    finally { setSigningOut(false); }
  };

  const requestedScreens = openScreens && openScreens.length ? openScreens : [{ label: breadcrumb.split('>').pop()!.trim(), to: '#' }];
  // Each persistent route frame owns its tab identity.  Do not infer the
  // active tab from the last auxiliary breadcrumb entry: several workflows
  // render secondary links/actions in `openScreens`, but LIVE registers the
  // actual frame once and switches by that frame key.
  const currentLabel = screenFrame && !screenFrame.key.startsWith('pending:') ? screenFrame.key : requestedScreens[0].label;
  const effectivePath = screenFrame?.path || `${location.pathname}${location.search}`;

  useEffect(() => {
    if (screenFrame && screenFrame.key === currentLabel) return;
    const result = openScreen({ label: currentLabel, path: effectivePath });
    if (result === 'limit') showFeedback('Maximum limit of opened Tabs exceeded.', 'err');
  }, [currentLabel, effectivePath, openScreen, screenFrame, showFeedback]);

  const activateScreen = (label: string) => {
    const screen = recordActivation(label);
    if (screen) nav(screen.path);
  };
  const backScreen = () => {
    const screen = goBack();
    if (screen) nav(screen.path);
  };
  const dismissScreen = (label: string) => {
    if (label === currentLabel) {
      const closingIndex = screens.findIndex((screen) => screen.label === label);
      const target = screens[closingIndex - 1] || screens[closingIndex + 1];
      if (target) nav(target.path);
    }
    closeScreen(label);
  };

  const doSearch = async () => {
    if (!search.trim()) return;
    try {
      const result: any = await apiSend('/api/jsonOrderExits', 'POST', { orderno: search.trim(), searchType: orderType });
      if (result.jsonMessage) return showFeedback('Error while searching for an order', 'err');
      if (!result.orderMap) {
        const errors: Record<string, string> = {
          '1': 'Order no or Web Order no does not exists in system.',
          '2': 'AWB no does not exists in system.',
          '3': 'Sub Order Id does not exists in system.',
          '4': 'PO Code does not exists in system',
          '5': 'LPN No does not exists in system.',
          '6': 'Reverse Awb No does not exists in system.',
          '7': 'Invoice Number does not exist in system',
        };
        return showFeedback(errors[orderType] || 'Order does not exist in system.', 'err');
      }
      const entries = Object.entries(result.orderMap) as [string, string][];
      const [key, value] = entries[0];
      if (key === 'PO') nav(`/app/procurement/po/single?poCode=${encodeURIComponent(value)}`);
      else if (key.startsWith('SP_')) nav(`/app/market-order-view?orderNo=${encodeURIComponent(value)}`);
      else if (key.includes('_STO')) nav(`/app/transfers/edit?stoNo=${encodeURIComponent(value)}`);
      else if (key.includes('_RTV')) nav(`/app/returns/vendor-return?id=${encodeURIComponent(value)}`);
      else if (key.includes('_KIT')) nav(`/app/m/kitting-order?orderCode=${encodeURIComponent(value)}`);
      else nav(`/app/order-maintenance?orderCode=${encodeURIComponent(value)}`);
      setSearch('');
    } catch {
      showFeedback('Error while searching for an order', 'err');
    }
  };

  const searchOptions = [
    ['1', 'Web Order No', 'Enter Web Order No'], ['2', 'AWB No', 'Enter SKU Code'],
    ['3', 'Sub Order No', 'Enter AWB Number'], ['4', 'PO No', 'Enter Invoice Number'],
    ['5', 'LPN No', 'Enter LPN No'], ['6', 'Reverse AWB No', 'Enter RVAWB No'],
    ['7', 'Invoice No', 'Enter Invoice No'],
  ];

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };

  const passwordStrength = (() => {
    const value = passwords.next;
    if (!value) return 0;
    let strength = 2;
    if (value.length >= 8) strength += 1;
    if (/[a-zA-Z]/.test(value)) strength += 1;
    if (/[0-9]/.test(value)) strength += 1;
    if (/[!@#$%^&*(),.?\":{}|<>]/.test(value)) strength += 1;
    strength += 1;
    return strength;
  })();
  const savePassword = () => {
    if (!passwords.old) return setPasswordError('Please Enter old password');
    if (!passwords.next) return setPasswordError('Please Enter new password');
    if (!passwords.confirm) return setPasswordError('Please Enter confirm password');
    if (user?.username && passwords.next.toLowerCase().includes(user.username.toLowerCase())) return setPasswordError('Password must not contain your username.');
    if (['012','123','234','345','456','567','678','789','987','876','765','654','543','432','321','210'].some((sequence) => passwords.next.includes(sequence))) return setPasswordError('Password cannot include numeric sequences.');
    if (passwords.next.length < 8) return setPasswordError('Password must be 8 character long.');
    if (!/[a-zA-Z]/.test(passwords.next)) return setPasswordError('Password must contain alphabets.');
    if (!/[0-9]/.test(passwords.next)) return setPasswordError('Password must contain numeric digit.');
    if (!/[!@#$%^&*(),.?\":{}|<>]/.test(passwords.next)) return setPasswordError('Password must contain special character.');
    if (passwords.confirm !== passwords.next) return setPasswordError('Please Enter same new password and confirm password');
    setPasswordError('Password change requires an authenticated server session.');
  };

  return (
    <div className="eretail-shell relative flex h-screen overflow-hidden flex-col bg-[#eef1f3] font-sans" onClick={() => { setOpenKey(null); setUserMenu(false); setScreenMenu(false); }}>
      {/* Top header — medium blue */}
      <header className="relative z-40 flex h-[51px] shrink-0 items-start bg-[#3b8fc4] text-white">
        <div className="flex h-[50px] w-[50px] items-center justify-center bg-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#d62828]">
            <span className="text-xl font-black italic text-white">e</span>
          </div>
        </div>
        {history.length > 1 && <button aria-label="Back" title="Back" data-history-depth={history.length} onClick={backScreen} className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/15 hover:bg-white/25"><ChevronLeft size={18} /></button>}
        {/* LIVE multi-screen strip: secondary screens stay ordered and switchable. */}
        <div data-open-screen-strip className="ml-3 flex h-[51px] w-[550px] shrink-0 flex-wrap content-start items-start gap-[3px] overflow-y-auto px-[3px] pt-[4px] leading-[15px]">
          {screens.filter((screen) => screen.closable).map((screen) => (
            <div key={screen.label} className={`flex h-[20px] shrink-0 items-center rounded px-2 text-[12px] font-medium ${screen.label === currentLabel ? 'bg-[#8e2fb0] text-white' : 'bg-white/15 text-white/85 hover:bg-white/25'}`}>
              <button onClick={() => activateScreen(screen.label)}>{screen.label}</button>
              <button aria-label={`Close ${screen.label}`} onClick={() => dismissScreen(screen.label)} className="ml-1 rounded-full p-0.5 hover:bg-white/20"><X size={13} /></button>
            </div>
          ))}
        </div>
        <div className="ml-auto flex h-[50px] items-start">
          <div data-global-search className="mr-[3px] w-[210px] text-right text-white">
            <div className="flex h-[22px] items-center justify-end gap-1 text-[12px]"><MapPin size={12} className="text-[#aaeeff]" />No location selected</div>
            <div className="flex h-[24px]" onClick={(e) => e.stopPropagation()}>
              <select id="searchType" aria-label="Search Type" value={orderType} onChange={(e) => { setOrderType(e.target.value); setSearch(''); }} className="h-[24px] w-[105px] rounded-l-[9px] border-0 bg-[#23709c] px-[1px] text-[12px] text-white outline-none">
                {searchOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <div className="relative h-[24px] w-[105px]">
                <input id="searchValue" aria-label="Global Search" maxLength={150} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void doSearch()} placeholder={searchOptions.find(([value]) => value === orderType)?.[2]} className="block h-[24px] w-[105px] rounded-r-[9px] border-0 bg-white pl-1 pr-[20px] text-[12px] leading-[24px] text-[#555] outline-none" />
                <button aria-label="Search" onClick={() => void doSearch()} className="absolute right-[4px] top-[5px]"><Search size={14} className="text-slate-500" /></button>
              </div>
            </div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); setLocationOpen(true); }} className="flex h-[50px] w-[42px] items-center justify-center" title="Switch Location"><Asterisk size={16} /></button>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button data-screen-count={screens.length} onClick={() => setScreenMenu((value) => !value)} className="relative flex h-[50px] w-[42px] items-center justify-center" title="Open Screen(s)">
              <Flag size={18} className="text-white/90" /><span className="absolute right-0 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold">{screens.length}</span>
            </button>
            {screenMenu && <div className="absolute right-0 top-9 z-50 w-[280px] border border-slate-200 bg-white text-slate-700 shadow-xl">
              <div className="border-b px-3 py-2 text-center text-sm">You have {screens.length} Open Screen(s)</div>
              <div className="max-h-[200px] overflow-y-auto">
                {screens.map((screen) => <div key={screen.label} className="flex items-center border-b px-3 py-2 text-sm">
                  <button className="min-w-0 flex-1 truncate text-left" onClick={() => { activateScreen(screen.label); setScreenMenu(false); }}>{screen.label}</button>
                  {screen.closable && <button aria-label={`Close ${screen.label}`} onClick={() => dismissScreen(screen.label)}><X size={14} /></button>}
                </div>)}
              </div>
              <button className="w-full px-3 py-2 text-center text-xs" onClick={() => setScreenMenu(false)}>Close</button>
            </div>}
          </div>
          <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} title="Toggle Full-Screen" className="flex h-[50px] w-[42px] items-center justify-center"><Maximize2 size={17} /></button>
          <button onClick={(e) => { e.stopPropagation(); nav('/app/downloads'); }} title="Export Report Status" className="flex h-[50px] w-[42px] items-center justify-center"><Download size={18} /></button>
          <div className="relative flex h-[50px] w-[65px] items-center justify-center">
            <button onClick={(e) => { e.stopPropagation(); setUserMenu((v) => !v); }} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/20"><User size={18} /></button>
            {userMenu && (
              <div className="absolute right-0 top-[50px] z-50 w-[280px] bg-white text-slate-700 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="h-[231px] bg-[#3c8dbc] px-[30px] py-[10px] text-center text-white">
                  <p className="text-sm">{user?.username}</p>
                  <p className="text-[11px]">You last visited on <b>{new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}</b></p>
                  <div className="mx-auto mt-1 flex h-[45px] w-[45px] items-center justify-center rounded-full bg-white/20"><User size={25} /></div>
                  <p className="mt-1 text-left text-sm">Contact your administrator for support</p>
                  <button onClick={() => { setUserMenu(false); setSpeedOpen(true); }} className="mt-[10px] h-[33px] bg-[#00c0ef] px-3 text-[13px]">Test My Internet Speed</button>
                </div>
                <div className="flex h-[45px] items-center gap-[4px] px-[11px]">
                  <button onClick={() => { setUserMenu(false); nav('/app/profile'); }} className="h-[34px] border bg-white px-[12px] text-sm">Profile</button>
                  <button title="Change Password" onClick={() => { setUserMenu(false); setPasswords({ old: '', next: '', confirm: '' }); setPasswordError(''); setPasswordOpen(true); }} className="h-[34px] w-[40px] border bg-white">⌘</button>
                  <button title="User Activity Log" onClick={() => { setUserMenu(false); setActivityOpen(true); }} className="h-[34px] w-[40px] border bg-white">▦</button>
                  <button onClick={() => void signOut()} disabled={signingOut} className="ml-auto flex h-[34px] items-center gap-1 border bg-white px-[12px] text-sm"><LogOut size={14} /> {signingOut ? 'Signing out…' : 'Sign out'}</button>
                </div>
                {signOutError && <div role="alert" className="px-3 pb-2 text-xs text-rose-700">{signOutError}</div>}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="ml-[50px] flex min-h-0 flex-1">
        {/* Icon rail with flyouts */}
        <div data-sidebar-rail className="absolute inset-y-0 left-0 z-30 flex w-[50px] flex-col bg-[#1b232f] pt-[51px]" onClick={(e) => e.stopPropagation()}>
          {RAIL.map((entry) => {
            const on = active === entry.key;
            const opened = openKey === entry.key;
            return (
              <div key={entry.key} className="relative h-[43.140625px]"
                onMouseEnter={() => entry.columns && setOpenKey(entry.key)}
                onMouseLeave={() => setOpenKey((k) => (k === entry.key ? null : k))}>
                <button
                  onClick={(event) => { event.stopPropagation(); if (entry.single) nav(entry.single); else setOpenKey(entry.key); }}
                  title={entry.title}
                  className={`flex h-[42px] w-[50px] items-center justify-center border-l-[3px] transition ${on ? 'border-[#3fb6c9] bg-[#26313f] text-white' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                  <entry.icon size={20} />
                </button>
                {opened && entry.columns && <Flyout entry={entry} onNav={() => setOpenKey(null)} />}
              </div>
            );
          })}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The LIVE module runs inside an iframe: fixed dialogs are bounded by the module viewport and cannot cover shell navigation. */}
          <main className="relative min-h-0 flex-1 overflow-y-auto p-4" style={{ transform: 'translateZ(0)' }}>{requestFailure && <RequestErrorState error={requestFailure.error} onRetry={() => { void requestFailure.retry().then(() => window.dispatchEvent(new Event('api-recovered'))).catch(() => {}); }} />}<div hidden={!!requestFailure}>{children}</div></main>
        </div>
      </div>
      <footer className="ml-[50px] flex h-[19px] shrink-0 items-center bg-white px-[15px] text-[11px] text-[#444]">
        <strong>© 2026 D-Mills Global Private Limited</strong>
        <span className="ml-auto">Made by Shreshtha Gupta.</span>
      </footer>
      {locationOpen && <div role="dialog" aria-label="User Preferences" className="fixed inset-0 z-[1050] bg-black/50" onClick={(event) => event.target === event.currentTarget && setLocationOpen(false)}>
        <div className="mx-auto mt-[20px] h-[342px] w-[600px] bg-white p-[20px] text-[12px] text-[#333] shadow-xl">
          <h2 className="mb-[10px] text-[15px] font-semibold">User Preferences</h2>
          <div className="grid grid-cols-[145px_1fr] items-center gap-y-[3px]">
            <label htmlFor="companyDetail">Company</label><select id="companyDetail" defaultValue="" className="h-[34px] border px-2"><option value="">Please select a Company</option></select>
            <label htmlFor="locationDetail">Location</label><select id="locationDetail" defaultValue="" className="h-[34px] border px-2"><option value="">Please select a Location</option></select>
            <label htmlFor="languageDetail">Language</label><select id="languageDetail" value={language} onChange={(event) => setLanguage(event.target.value)} className="h-[34px] border px-2"><option>Please select a Language</option>{['English','Thai/ไทย','Bahasa','Simple Chinese/简单的中文','Vietnamese/Tiếng Việt','Hindi/हिंदी','Arabic (Saudi Arabia)'].map((value) => <option key={value}>{value}</option>)}</select>
            <label htmlFor="timeZoneDetail">Timezone</label><select id="timeZoneDetail" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} className="h-[34px] border px-2"><option>Please select a Timezone</option>{['Etc/GMT+12','Pacific/Midway','America/Los_Angeles','America/Chicago','America/New_York','Etc/GMT','Europe/London','Europe/Paris','Asia/Dubai','Asia/Karachi','Asia/Calcutta','Asia/Kolkata','Asia/Bangkok','Asia/Singapore','Asia/Tokyo','Australia/Sydney','Pacific/Auckland'].map((value) => <option key={value} value={value}>{value === 'Asia/Calcutta' ? '(GMT+5:30) Asia/Calcutta' : value}</option>)}</select>
          </div>
          <div className="mt-[12px] flex gap-[28px] text-[12px]">{[['setDefault','Set As Default'],['removeDefault','Remove Default'],['remainSame','Do Nothing']].map(([value,label]) => <label key={value} className="flex items-center gap-1"><input type="radio" name="setDefault" value={value} checked={defaultLocation === value} onChange={() => setDefaultLocation(value)} />{label}</label>)}</div>
          <div className="mt-[16px] ml-[184px] flex gap-[9px]"><button onClick={() => setLocationOpen(false)} className="h-[38px] w-[91px] bg-[#00a65a] text-white">Submit</button><button onClick={() => setLocationOpen(false)} className="h-[38px] w-[87px] bg-[#dd4b39] text-white">Cancel</button></div>
        </div>
      </div>}
      {passwordOpen && <div role="dialog" aria-label="Change Password" className="fixed inset-0 z-[1050] bg-black/50">
        <div className="mx-auto mt-[80px] w-[600px] bg-white text-[12px] text-[#333] shadow-xl">
          <div className="flex h-[45px] items-center border-b px-[15px]"><b>Change Password</b><button aria-label="Close" className="ml-auto text-[21px]" onClick={() => setPasswordOpen(false)}>×</button></div>
          <div className="px-[30px] py-[20px]">
            {passwordError && <div className="mb-2 bg-red-50 p-2 text-red-700">{passwordError}</div>}
            <div className="grid grid-cols-[130px_315px] items-center gap-y-[6px]">
              <label htmlFor="oldPassword">Old Password</label><input id="oldPassword" maxLength={20} type="password" value={passwords.old} onChange={(event) => setPasswords({ ...passwords, old: event.target.value })} className="h-[24px] border px-2" />
              <label htmlFor="newPassword">New Password</label><input id="newPassword" maxLength={20} type="password" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} className="h-[24px] border px-2" />
              <span /> <div><div className="h-[5px] w-full bg-slate-200"><div className={`h-full ${passwordStrength < 3 ? 'w-1/3 bg-red-500' : passwordStrength < 7 ? 'w-2/3 bg-orange-500' : 'w-full bg-green-600'}`} /></div><span>{passwordStrength < 3 ? 'Weak' : passwordStrength < 7 ? 'Medium' : 'Strong'}</span></div>
              <label htmlFor="confirmPassword">Confirm Password</label><input id="confirmPassword" maxLength={20} type="password" value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} className="h-[24px] border px-2" />
            </div>
            <div className="mt-[24px] flex justify-end gap-[8px]"><button onClick={savePassword} className="h-[34px] bg-[#00a65a] px-[15px] text-white">Save</button><button onClick={() => setPasswordOpen(false)} className="h-[34px] border px-[15px]">Cancel</button></div>
          </div>
        </div>
      </div>}
      {speedOpen && <div role="dialog" aria-label="Speed Test" className="fixed inset-0 z-[1050] bg-black/50">
        <div className="mx-auto mt-[20px] w-[900px] bg-white text-[#333] shadow-xl">
          <div className="flex h-[45px] items-center border-b px-[15px]"><b>Speed Test</b><button aria-label="Close" className="ml-auto text-[21px]" onClick={() => setSpeedOpen(false)}>×</button></div>
          <div className="grid grid-cols-5 gap-4 px-[70px] py-[38px] text-center"><div><b>Download</b><p className="mt-3 text-2xl">0.0 <small className="text-xs">Mbps</small></p></div><div><b>Upload</b><p className="mt-3 text-2xl">0.0 <small className="text-xs">Mbps</small></p></div><div><b>Latency</b><p className="mt-3 text-2xl">0 <small className="text-xs">ms</small></p></div><div><b>Jitter</b><p className="mt-3 text-2xl">0 <small className="text-xs">ms</small></p></div><div><b>Packet Loss</b><p className="mt-3 text-2xl">0%</p></div></div>
          <div className="flex items-center justify-between border-t px-[70px] py-[18px]"><button onClick={() => showFeedback('Speed test requires the authenticated speedtest service.', 'err')} className="h-[34px] bg-[#3c8dbc] px-[15px] text-white">Start Speed Test</button><span className="text-xs">Measured at --:--:--</span></div>
        </div>
      </div>}
      {activityOpen && <div role="dialog" aria-label="User Activity Log" className="fixed inset-0 z-[1050] bg-black/50">
        <div className="mx-auto mt-[20px] w-[900px] bg-white text-[#333] shadow-xl">
          <div className="flex h-[45px] items-center border-b px-[15px]"><b>User Activity Log</b><button aria-label="Close" className="ml-auto text-[21px]" onClick={() => setActivityOpen(false)}>×</button></div>
          <div className="px-[20px] py-[14px]"><table className="w-full border-collapse text-xs"><thead><tr>{['LogInTime','LogOutTime','IPAddress'].map((label) => <th key={label} className="border bg-slate-100 px-2 py-2 text-left">{label}</th>)}</tr></thead><tbody><tr><td colSpan={3} className="border px-2 py-5 text-center">No records to view</td></tr></tbody></table><div className="mt-[12px] flex justify-end"><button onClick={() => setActivityOpen(false)} className="h-[34px] border px-[15px]">Close</button></div></div>
        </div>
      </div>}
    </div>
  );
}
