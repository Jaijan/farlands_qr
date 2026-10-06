'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMonitor } from '@/components/dashboard/provider';
import { filterParticipants, overdue } from '@/lib/monitor';
export function ParticipantList() {
  const { data, now } = useMonitor();
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [exit, setExit] = useState('all');
  const rows = data
    ? filterParticipants(data.participants, data.sessions, query, status, exit, now)
    : [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Participant directory</div>
          <h1 style={{ marginTop: 10 }}>The people behind the builds.</h1>
          <p>Search registrations, inspect passes, and review venue activity.</p>
        </div>
        <span className="badge">{data?.participants.length ?? '—'} REGISTERED</span>
      </div>
      <section className="card">
        <div className="filters">
          <input
            placeholder="Search name, ID, phone, email, team or college…"
            aria-label="Search participants"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Filter status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {['all', 'inside', 'outside', 'overdue', 'suspended'].map((s) => (
              <option value={s} key={s}>
                {s === 'all' ? 'All statuses' : s}
              </option>
            ))}
          </select>
          <select aria-label="Filter exit" value={exit} onChange={(e) => setExit(e.target.value)}>
            <option value="all">Both exits</option>
            <option value="exit_1">Exit 1</option>
            <option value="exit_2">Exit 2</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Team / college</th>
                <th>Contact</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const s = data?.sessions.find((s) => s.participant_id === p.id && !s.returned_at);
                const status = s && overdue(s, now) ? 'overdue' : p.status;
                return (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      <small className="mono">{p.participant_code}</small>
                    </td>
                    <td>
                      {p.team_name}
                      <small>{p.college_name}</small>
                    </td>
                    <td>
                      {p.phone}
                      <small>{p.email}</small>
                    </td>
                    <td>
                      <span
                        className={`badge ${status === 'inside' ? 'green' : status === 'outside' ? 'yellow' : 'red'}`}
                      >
                        <span className="dot" />
                        {status}
                      </span>
                    </td>
                    <td>
                      <Link className="subtle-link" href={`/admin/participants/${p.id}`}>
                        View details ↗
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && (
            <div className="empty">
              {data ? 'No participants match your search.' : 'Loading participants…'}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
