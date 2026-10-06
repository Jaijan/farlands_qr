import Link from 'next/link';
import { ArrowUpRight, ScanLine, ShieldCheck } from 'lucide-react';
import { Brand } from '@/components/brand';
export default function Home() {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <span className="badge">EVENT OPERATIONS</span>
      </header>
      <main className="hero">
        <div className="eyebrow">Build beyond boundaries</div>
        <h1>
          Your next adventure.
          <br />
          <span style={{ color: 'var(--lime)' }}>One pass away.</span>
        </h1>
        <p>
          Register for Farlands, save your personal QR pass,
          <br />
          and keep it with you throughout the event.
        </p>
        <div className="row wrap" style={{ marginTop: 32 }}>
          <Link className="button primary" href="/register">
            Participant registration <ArrowUpRight size={18} />
          </Link>
          <Link className="button" href="/volunteer/login">
            <ScanLine size={18} /> Volunteer sign in
          </Link>
        </div>
        <div style={{ marginTop: 38 }}>
          <Link className="subtle-link" href="/admin/login">
            <ShieldCheck size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
            Administration
          </Link>
        </div>
      </main>
      <footer className="public-footer">FARLANDS / PARTICIPANT & VENUE CONTROL</footer>
    </div>
  );
}
