'use client';
import { useState } from 'react';
import { Scanner } from './scanner';
import { useMonitor } from '@/components/dashboard/provider';
import { Stats } from '@/components/dashboard/stats';
import { OutsideTable } from '@/components/dashboard/outside-table';
import { ReturnButton } from '@/components/participants/return-button';
import { filterParticipants, gateName } from '@/lib/monitor';
export function ScannerWorkspace() {
  const { data, now } = useMonitor();
  const [query, setQuery] = useState('');
  const found =
    query && data
      ? filterParticipants(data.participants, data.sessions, query, 'all', 'all', now).slice(0, 10)
      : [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Gate operations</div>
          <h1 style={{ marginTop: 10 }}>
            Farlands — {gateName(data?.staff.assigned_exit || null)}
          </h1>
          <p>Scan, confirm, and keep the line moving.</p>
        </div>
      </div>
      <Stats />
      <div className="stack">
        <div className="scanner-layout">
          <Scanner />
          <section className="card">
            <div className="card-head">
              <h2>Participant lookup</h2>
              <span className="badge">MANUAL RETURN</span>
            </div>
            <div className="card-body stack">
              <input
                placeholder="Search name, ID, phone, email, team or college…"
                aria-label="Search participants"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                found.length ? (
                  found.map((p) => (
                    <div className="gate" key={p.id}>
                      <div>
                        <strong>{p.name}</strong>
                        <small style={{ display: 'block', marginTop: 6 }}>
                          {p.participant_code} · {p.team_name}
                        </small>
                        <small style={{ display: 'block', marginTop: 6 }}>
                          {p.status.toUpperCase()}
                        </small>
                      </div>
                      {p.status === 'outside' && <ReturnButton id={p.id} name={p.name} />}
                    </div>
                  ))
                ) : (
                  <p className="empty">No participants found.</p>
                )
              ) : (
                <p className="empty">
                  Find a participant to check their status
                  <br />
                  or record a confirmed manual return.
                </p>
              )}
              <div className="notice">
                <strong>Confirm every movement.</strong>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  Wait for the server confirmation before allowing movement. Use Exit only or Return
                  only when the direction matters. An overdue alert clears when a return is
                  recorded.
                </p>
              </div>
            </div>
          </section>
        </div>
        <OutsideTable onlyOverdue />
        <OutsideTable />
      </div>
    </>
  );
}
