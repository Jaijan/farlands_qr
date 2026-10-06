'use client';
import { useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { QrPass } from '@/components/qr/pass';
export default function Page() {
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(`${location.origin}/register`), []);
  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <span className="badge green">WELCOME TO FARLANDS</span>
      </header>
      <main className="center">
        <div className="eyebrow">Your adventure starts here</div>
        <h1 style={{ fontSize: 'clamp(32px,5vw,70px)', margin: '24px 0' }}>
          Scan. Register. Build.
        </h1>
        {url && <QrPass payload={url} code="Farlands-registration" />}
        <p className="muted" style={{ fontSize: 24, marginTop: 24 }}>
          {url}
        </p>
        <p className="muted">Verify your phone and save your personal event pass.</p>
      </main>
    </div>
  );
}
