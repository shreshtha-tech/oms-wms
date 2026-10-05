import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';

type ConnectionState = 'connecting'|'live'|'offline'|'reconnecting'|'polling';
const LiveContext = createContext<ConnectionState>('connecting');
export const useInventoryConnectionState = () => useContext(LiveContext);

export function LiveConnection({children}:{children:ReactNode}) {
 const {user}=useAuth();
 const [state,setState]=useState<ConnectionState>('connecting');
 const lastRefresh=useRef(0);
 const broadcast=useCallback((force=false)=>{
  if(document.visibilityState!=='visible')return;
  const now=Date.now();
  if(!force&&now-lastRefresh.current<1500)return;
  lastRefresh.current=now;
  window.dispatchEvent(new Event('inventory-live-changed'));
  window.dispatchEvent(new Event('central-inventory-changed'));
 },[]);
 useEffect(()=>{
  if(!user)return;
  let source:EventSource|null=null,closed=false,everLive=false;
  const verify=async()=>{
   try{
    const response=await fetch('/api/inventory-sync/unified/ready',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw new Error(`Health request failed: ${response.status}`);
    if(closed||!navigator.onLine)return;
    setState('live');everLive=true;broadcast(true);
   }catch{if(!closed)setState(navigator.onLine?'polling':'offline');}
  };
  const connect=()=>{
   source?.close();source=null;
   if(closed)return;
   if(!navigator.onLine){setState('offline');return;}
   setState(everLive?'reconnecting':'connecting');
   source=new EventSource('/api/inventory-sync/unified/events',{withCredentials:true});
   source.addEventListener('ready',()=>void verify());
   source.addEventListener('changed',()=>broadcast());
   source.onerror=()=>setState(navigator.onLine?'reconnecting':'offline');
  };
  const online=()=>{connect();void verify();};
  const offline=()=>{source?.close();source=null;setState('offline');};
  const visible=()=>{if(document.visibilityState==='visible'){void verify();if(!source||source.readyState===EventSource.CLOSED)connect();}};
  window.addEventListener('online',online);window.addEventListener('offline',offline);document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
  const fallback=setInterval(()=>{if(document.visibilityState==='visible')void verify();},60000);
  connect();
  return()=>{closed=true;source?.close();clearInterval(fallback);window.removeEventListener('online',online);window.removeEventListener('offline',offline);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[user,broadcast]);
 return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}
