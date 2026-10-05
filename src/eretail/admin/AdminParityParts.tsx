import { Home, X } from 'lucide-react';
import type { ReactNode } from 'react';
import './AdminParity.css';

export function AdminParityHeader({ title, home = 'Admin', children }: { title: string; home?: string; children?: ReactNode }) {
  return <div className="admin-parity-header"><div className="admin-parity-crumb"><Home size={12} /><span style={{color:'#444'}}>{home}</span><span> &gt; </span><b>{title}</b></div><div className="admin-parity-actions">{children}</div></div>;
}

export function AdminParityNotice({ message, close }: { message: string; close: () => void }) {
  return message ? <div className="admin-parity-notice" role="alert">{message}<button aria-label="Close message" onClick={close}><X size={14} /></button></div> : null;
}
