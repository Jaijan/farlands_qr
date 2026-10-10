'use client';
import { Users, ArrowUpRight, TriangleAlert, ShieldCheck } from 'lucide-react';
import { useMonitor } from './provider';
import { overdue } from '@/lib/monitor';
export function Stats() {
  const { data, now } = useMonitor();
  const values = [
    {
      label: 'Total participants',
      value: data?.participants.length,
      hint: 'Registered participants',
      icon: Users,
      color: '#dce6ec',
    },
    {
      label: 'Currently inside',
      value: data?.participants.filter((p) => p.status === 'inside').length,
      hint: 'Within the venue',
      icon: ShieldCheck,
      color: 'var(--lime)',
    },
    {
      label: 'Currently outside',
      value: data?.sessions.filter((s) => !s.returned_at).length,
      hint: 'Active exit sessions',
      icon: ArrowUpRight,
      color: 'var(--yellow)',
    },
    {
      label: 'Overdue',
      value: data?.sessions.filter((s) => overdue(s, now)).length,
      hint: 'Outside for 30+ minutes',
      icon: TriangleAlert,
      color: 'var(--red)',
    },
  ];
  return (
    <div className="stats">
      {values.map((v) => (
        <section className="stat" key={v.label}>
          <div className="row spread">
            <span className="label">{v.label}</span>
            <v.icon size={17} color={v.color} />
          </div>
          <div className="value" style={{ color: v.color }}>
            {v.value ?? '—'}
          </div>
          <small>{v.hint}</small>
        </section>
      ))}
    </div>
  );
}
