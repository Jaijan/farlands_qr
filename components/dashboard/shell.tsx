'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  History,
  Settings,
  ScanLine,
  LogOut,
  Bell,
  ArrowUpRight,
  Radio,
} from 'lucide-react';
import { Brand } from '@/components/brand';
import { MonitorProvider, useMonitor } from './provider';
import { api } from '@/lib/client-api';
import type { Staff } from '@/lib/types';
function Inner({ children, staff }: { children: React.ReactNode; staff: Staff }) {
  const path = usePathname();
  const { online, realtime, error, alerts, enableAlerts, alertMessage } = useMonitor();
  const [logoutError, setLogoutError] = useState('');
  const admin = staff.role === 'admin';
  const nav = admin
    ? ([
        ['/admin/dashboard', 'Overview', LayoutDashboard],
        ['/admin/participants', 'Participants', Users],
        ['/admin/volunteers', 'Gate volunteers', ScanLine],
        ['/admin/history', 'History & audit', History],
        ['/admin/settings', 'Event settings', Settings],
      ] as const)
    : ([['/volunteer/scanner', 'Scanner & monitoring', ScanLine]] as const);
  async function logout() {
    try {
      await api('auth/logout', {});
      window.location.assign(admin ? '/admin/login' : '/volunteer/login');
    } catch (e) {
      setLogoutError((e as Error).message);
    }
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <div>
          <div className="eyebrow" style={{ color: '#5b6e7c', margin: '8px 12px 16px' }}>
            Event workspace
          </div>
          <nav className="nav">
            {nav.map(([href, label, Icon]) => (
              <Link className={path.startsWith(href) ? 'active' : ''} href={href} key={href}>
                <Icon size={17} />
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="notice" style={{ fontSize: 12 }}>
          <Radio size={18} style={{ marginBottom: 10 }} />
          <strong style={{ display: 'block', marginBottom: 5 }}>Every participant counts.</strong>
          <span className="muted">Live venue monitoring for a safer Farlands.</span>
        </div>
        <div className="sidebar-footer">
          <div className="row">
            <div className="avatar">{staff.name[0]}</div>
            <div>
              <strong style={{ fontSize: 12 }}>{staff.name}</strong>
              <small style={{ display: 'block', marginTop: 4 }}>
                {admin ? 'Administrator' : staff.assigned_exit?.replace('_', ' ').toUpperCase()}
              </small>
            </div>
          </div>
          <button onClick={logout}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <div className="row">
            <span className="muted">Workspace</span>
            <span style={{ color: '#40515c' }}>/</span>
            <strong>
              {admin ? 'Event control' : staff.assigned_exit?.replace('_', ' ').toUpperCase()}
            </strong>
          </div>
          <div className="row wrap">
            <span
              role="status"
              className={`badge ${online ? (realtime ? 'green' : 'yellow') : 'red'}`}
            >
              <span className="dot" />
              {online ? (realtime ? 'SYSTEM ONLINE' : 'REALTIME DISCONNECTED') : 'SYSTEM OFFLINE'}
            </span>
            <button onClick={enableAlerts} title={alertMessage || 'Enable overdue notifications'}>
              <Bell size={15} />
              {alerts ? 'Alerts on' : 'Enable alerts'}
            </button>
            <button onClick={logout} title="Sign out" aria-label="Sign out">
              <LogOut size={15} />
            </button>
          </div>
        </header>
        <main className="content">
          {(error || logoutError) && (
            <p className="alert" role="alert">
              {error || logoutError}{' '}
              {!online &&
                'Internet connection required. Scans are disabled until the backend responds.'}
            </p>
          )}
          {alertMessage && <p className="notice">{alertMessage}</p>}
          {children}
          <footer className="row spread" style={{ marginTop: 30, fontSize: 11, color: '#627583' }}>
            <span>FARLANDS / EVENT OPERATIONS</span>
            <Link href="/register" target="_blank">
              Registration portal <ArrowUpRight size={12} style={{ display: 'inline' }} />
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
export function DashboardShell(props: { children: React.ReactNode; staff: Staff }) {
  return (
    <MonitorProvider>
      <Inner {...props} />
    </MonitorProvider>
  );
}
