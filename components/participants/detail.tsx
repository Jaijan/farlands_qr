'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMonitor } from '@/components/dashboard/provider';
import { api } from '@/lib/client-api';
import { QrPass } from '@/components/qr/pass';
import { ReturnButton } from './return-button';
import { HistoryTable } from '@/components/dashboard/history';
import { date, time } from '@/lib/monitor';
export function ParticipantDetail({ id }: { id: string }) {
  const { data, refresh, online } = useMonitor();
  const p = data?.participants.find((p) => p.id === id);
  const [token, setToken] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function qr(action: 'view' | 'regenerate' | 'revoke') {
    if (
      action !== 'view' &&
      !confirm(
        action === 'regenerate'
          ? "Regenerating the QR will invalidate the participant's previous QR. Continue?"
          : 'Revoke this QR? It will immediately stop working.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const d = await api<{ token: string | null }>('admin/qr', { participant_id: id, action });
      setToken(d.token);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p>Loading participant…</p>;
  if (!p) return <p className="alert">Participant not found.</p>;
  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="subtle-link" href="/admin/participants">
            ← All participants
          </Link>
          <h1 style={{ marginTop: 20 }}>{p.name}</h1>
          <span className="mono muted">{p.participant_code}</span>
        </div>
        <div className="row">
          <span className={`badge ${p.status === 'inside' ? 'green' : 'yellow'}`}>{p.status}</span>
          {p.status === 'outside' && <ReturnButton id={p.id} name={p.name} />}
        </div>
      </div>
      <div className="stack">
        <div className="grid-two">
          <section className="card">
            <div className="card-head">
              <h2>Participant details</h2>
            </div>
            <dl className="card-body detail-grid">
              {[
                ['Full name', p.name],
                ['Phone', p.phone],
                ['Email', p.email],
                ['Alternate contact', p.alternate_contact],
                ['Team', p.team_name],
                ['College', p.college_name],
                ['Registered', `${date(p.created_at)} · ${time(p.created_at)}`],
                ['Contact verification', 'Verified'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Secure QR pass</h2>
              <span className="badge">ADMIN ONLY</span>
            </div>
            <div className="card-body stack">
              {error && (
                <p className="alert" role="alert">
                  {error}
                </p>
              )}
              {token ? (
                <QrPass token={token} code={p.participant_code} />
              ) : (
                <p className="muted">
                  Retrieve the encrypted pass or issue a replacement. Old passes stop working
                  immediately after revocation.
                </p>
              )}
              <div className="row wrap">
                <button disabled={busy || !online} onClick={() => qr('view')}>
                  View QR
                </button>
                <button disabled={busy || !online} onClick={() => qr('regenerate')}>
                  Regenerate
                </button>
                <button className="danger" disabled={busy || !online} onClick={() => qr('revoke')}>
                  Revoke
                </button>
              </div>
            </div>
          </section>
        </div>
        <HistoryTable participantId={id} />
      </div>
    </>
  );
}
