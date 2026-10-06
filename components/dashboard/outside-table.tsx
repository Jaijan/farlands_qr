'use client';
import Link from 'next/link';
import { useMonitor } from './provider';
import { duration, elapsed, gateName, overdue, time } from '@/lib/monitor';
import { ReturnButton } from '@/components/participants/return-button';
export function OutsideTable({ onlyOverdue = false }: { onlyOverdue?: boolean }) {
  const { data, now } = useMonitor();
  const sessions =
    data?.sessions
      .filter((s) => !s.returned_at && (!onlyOverdue || overdue(s, now)))
      .sort((a, b) => a.exited_at.localeCompare(b.exited_at)) || [];
  return (
    <div className="card" style={onlyOverdue ? { borderColor: '#ff777b40' } : {}}>
      <div className="card-head">
        <h2>
          {onlyOverdue ? 'Overdue · needs attention' : 'Currently outside'}{' '}
          <span className={`badge ${onlyOverdue ? 'red' : 'yellow'}`} style={{ marginLeft: 8 }}>
            {sessions.length}
          </span>
        </h2>
        <span className="muted" style={{ fontSize: 11 }}>
          {onlyOverdue ? '30 minute threshold' : 'Live duration · IST'}
        </span>
      </div>
      {!sessions.length ? (
        <div className="empty">
          {!data
            ? 'Loading venue state…'
            : onlyOverdue
              ? 'All clear. No overdue participants.'
              : 'No participants are currently outside.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Team</th>
                <th>Exit</th>
                <th>Exit time</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const p = data!.participants.find((p) => p.id === s.participant_id);
                if (!p) return null;
                const late = overdue(s, now);
                return (
                  <tr key={s.id}>
                    <td>
                      {data?.staff.role === 'admin' ? (
                        <Link href={`/admin/participants/${p.id}`}>{p.name}</Link>
                      ) : (
                        p.name
                      )}
                      <small className="mono">{p.participant_code}</small>
                    </td>
                    <td>{p.team_name}</td>
                    <td>{gateName(s.exit_id)}</td>
                    <td className="mono">{time(s.exited_at)}</td>
                    <td className="mono" style={{ color: late ? 'var(--red)' : 'var(--yellow)' }}>
                      {duration(elapsed(s, now))}
                    </td>
                    <td>
                      <span className={`badge ${late ? 'red' : 'yellow'}`}>
                        <span className="dot" />
                        {late ? 'Overdue' : 'Outside'}
                      </span>
                    </td>
                    <td>
                      <ReturnButton id={p.id} name={p.name} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
