'use client';
import Link from 'next/link';
import { ArrowUpRight, Radio } from 'lucide-react';
import { useMonitor } from './provider';
import { Stats } from './stats';
import { OutsideTable } from './outside-table';
import { date, duration, elapsed, gateName } from '@/lib/monitor';
export function Overview() {
  const { data, now } = useMonitor();
  const today = date(new Date(now).toISOString());
  const sessions = data?.sessions || [];
  const finished = sessions.filter((s) => s.returned_at);
  const avg = finished.length
    ? Math.round(finished.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / finished.length)
    : 0;
  const longest = Math.max(
    0,
    ...sessions.filter((s) => !s.returned_at).map((s) => elapsed(s, now)),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Live event overview
          </div>
          <h1>Eyes on the event.</h1>
          <p>Every participant. Both exits. One place.</p>
        </div>
        <div className="row">
          <span className="badge">{today} · IST</span>
          <Link className="button" href="/admin/participants">
            Participants
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
      <Stats />
      <div className="stack">
        <OutsideTable onlyOverdue />
        <OutsideTable />
        <div className="grid-two">
          <section className="card">
            <div className="card-head">
              <h2>Exit activity</h2>
              <Radio size={17} color="var(--lime)" />
            </div>
            <div className="card-body stack">
              {['exit_1', 'exit_2'].map((g) => {
                const count = sessions.filter((s) => s.exit_id === g).length;
                const occupied = data?.gates.some(
                  (s) =>
                    s.exit_id === g && s.active && now - new Date(s.last_seen_at).getTime() < 90000,
                );
                return (
                  <div key={g} className="gate">
                    <div>
                      <strong>{gateName(g)}</strong>
                      <small style={{ display: 'block', marginTop: 6 }}>
                        {count} total exits ·{' '}
                        {sessions.filter((s) => s.exit_id === g && !s.returned_at).length} currently
                        outside
                      </small>
                    </div>
                    <span className={`badge ${occupied ? 'green' : 'yellow'}`}>
                      <span className="dot" />
                      {occupied ? 'Staffed' : 'Unstaffed'}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Event pulse</h2>
              <span className="badge">LIVE</span>
            </div>
            <div className="card-body stack">
              {[
                ['Exits today', sessions.filter((s) => date(s.exited_at) === today).length],
                ['Returns today', finished.filter((s) => date(s.returned_at!) === today).length],
                ['Average time outside', duration(avg)],
                ['Longest current exit', duration(longest)],
              ].map(([k, v]) => (
                <div className="row spread" key={k}>
                  <span className="muted">{k}</span>
                  <strong className="mono">{v}</strong>
                </div>
              ))}
              <Link className="subtle-link" href="/admin/history">
                Explore complete history →
              </Link>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
