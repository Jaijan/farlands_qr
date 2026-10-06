import type { ExitSession, Participant } from './types';
export const overdue = (s: ExitSession, now: number) =>
  !s.returned_at && now - new Date(s.exited_at).getTime() >= 30 * 60 * 1000;
export const elapsed = (s: ExitSession, now: number) =>
  Math.max(0, Math.floor((now - new Date(s.exited_at).getTime()) / 1000));
export function duration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m ${seconds % 60}s`;
}
export function time(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}
export function date(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}
export const gateName = (value: string | null) =>
  value ? value.replace('exit_', 'Exit ') : 'Admin';
export function filterParticipants(
  participants: Participant[],
  sessions: ExitSession[],
  query: string,
  status: string,
  exit: string,
  now: number,
) {
  const q = query.toLowerCase().trim();
  return participants.filter((p) => {
    const s = sessions.find((s) => s.participant_id === p.id && !s.returned_at);
    return (
      (!q ||
        [p.participant_code, p.name, p.phone, p.email, p.team_name, p.college_name].some((v) =>
          v.toLowerCase().includes(q),
        )) &&
      (status === 'all' || (status === 'overdue' ? !!s && overdue(s, now) : p.status === status)) &&
      (exit === 'all' || s?.exit_id === exit)
    );
  });
}
