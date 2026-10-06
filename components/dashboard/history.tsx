'use client';
import { useEffect, useState } from 'react';
import { useMonitor } from './provider';
import { date, duration, elapsed, gateName, time } from '@/lib/monitor';
import { api } from '@/lib/client-api';
export function HistoryTable({ participantId }: { participantId?: string }) {
  const { data, now } = useMonitor();
  const [page, setPage] = useState(0);
  const rows = (data?.sessions || [])
    .filter((s) => !participantId || s.participant_id === participantId)
    .sort((a, b) => b.exited_at.localeCompare(a.exited_at));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Exit & return history</h2>
        <span className="badge">{rows.length} MOVEMENTS</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Participant</th>
              <th>Exit</th>
              <th>Exited at</th>
              <th>Returned at</th>
              <th>Return gate</th>
              <th>Duration</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(page * 50, page * 50 + 50).map((s) => {
              const p = data?.participants.find((p) => p.id === s.participant_id);
              return (
                <tr key={s.id}>
                  <td>
                    {p?.name}
                    <small>{p?.participant_code}</small>
                  </td>
                  <td>{gateName(s.exit_id)}</td>
                  <td>
                    {time(s.exited_at)}
                    <small>{date(s.exited_at)}</small>
                  </td>
                  <td>
                    {s.returned_at ? time(s.returned_at) : 'Still outside'}
                    {s.returned_at && <small>{date(s.returned_at)}</small>}
                  </td>
                  <td>{s.returned_at ? gateName(s.return_exit_id) : '—'}</td>
                  <td className="mono">{duration(s.duration_seconds ?? elapsed(s, now))}</td>
                  <td>
                    <span className="badge">{s.return_method || s.status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="empty">No exit sessions recorded yet.</p>}
      </div>
      {rows.length > 50 && (
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}
type Audit = {
  id: number;
  action: string;
  actor_type: string;
  actor_id: string | null;
  participant_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};
export function HistoryPage() {
  const { data } = useMonitor();
  const [logs, setLogs] = useState<Audit[]>([]),
    [page, setPage] = useState(0),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  useEffect(() => {
    api<Audit[]>(`admin/audit?page=${page}`)
      .then((d) => {
        setLogs(d);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [page, reload]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Accountability, built in</div>
          <h1 style={{ marginTop: 10 }}>Every movement has a story.</h1>
          <p>Complete exit history and an append-only operational audit trail.</p>
        </div>
      </div>
      <div className="stack">
        <HistoryTable />
        <section className="card">
          <div className="card-head">
            <h2>Audit trail</h2>
            <button onClick={() => setReload(reload + 1)}>Refresh audit</button>
          </div>
          {error && <p className="alert">{error}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Participant</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {time(l.created_at)}
                      <small>{date(l.created_at)}</small>
                    </td>
                    <td>{l.action.replaceAll('_', ' ')}</td>
                    <td>
                      {l.actor_type}
                      <small className="mono">{l.actor_id || 'System / participant'}</small>
                    </td>
                    <td>
                      {data?.participants.find((p) => p.id === l.participant_id)
                        ?.participant_code || '—'}
                    </td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>
                      <small className="mono">{JSON.stringify(l.metadata)}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!logs.length && <div className="empty">No audit entries.</div>}
          </div>
          <div className="pagination">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button disabled={logs.length < 100} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
