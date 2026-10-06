'use client';
import { use, useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { QrPass } from '@/components/qr/pass';
import { api } from '@/lib/client-api';
export default function ParticipantPass({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [code, setCode] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    api<{ participant_code: string }>('participant/qr', { token })
      .then((d) => setCode(d.participant_code))
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
      </header>
      <main className="public-main card card-body center">
        <div className="eyebrow">Your event pass</div>
        <h1 style={{ marginTop: 16 }}>Ready for Farlands.</h1>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : code ? (
          <QrPass token={token} code={code} />
        ) : (
          <p>Validating your pass…</p>
        )}
        <p className="muted" style={{ marginTop: 24 }}>
          Keep this QR available while attending Farlands.
          <br />
          Keep this link private; anyone with it can use your pass.
        </p>
      </main>
    </div>
  );
}
