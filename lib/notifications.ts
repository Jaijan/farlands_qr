'use client';
export type OverdueNotice = { id: string; name: string; participant_code: string };
export interface NotificationChannel {
  notify(notice: OverdueNotice): void | Promise<void>;
}
const browserNotices = new Map<string, Notification>();
export function clearReturnedNotifications(activeIds: Set<string>) {
  for (const [id, notice] of browserNotices)
    if (!activeIds.has(id)) {
      notice.close();
      browserNotices.delete(id);
    }
}
export async function notifyOnce(
  notice: OverdueNotice,
  seen: Set<string>,
  send: () => Promise<void>,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
) {
  const key = `farlands:alert:${notice.id}`;
  const deliver = async () => {
    if (seen.has(key)) return;
    try {
      if (storage?.getItem(key)) return;
    } catch {
      /* Storage can be blocked. */
    }
    seen.add(key);
    try {
      storage?.setItem(key, '1');
    } catch {
      /* Memory still deduplicates. */
    }
    await send();
  };
  // Coordinate tabs in the same browser profile when Web Locks is available.
  if (typeof navigator !== 'undefined' && navigator.locks)
    await navigator.locks.request(key, deliver);
  else await deliver();
}
export class BrowserChannel implements NotificationChannel {
  notify(n: OverdueNotice) {
    if ('Notification' in window && Notification.permission === 'granted')
      browserNotices.set(
        n.id,
        new Notification('Farlands Alert', {
          body: `${n.name} (${n.participant_code}) has been outside for more than 30 minutes.`,
          tag: n.id,
        }),
      );
  }
}
export class SoundChannel implements NotificationChannel {
  private context: AudioContext | undefined;
  async enable() {
    this.context ??= new AudioContext();
    await this.context.resume();
  }
  notify() {
    if (!this.context || this.context.state !== 'running') return;
    const o = this.context.createOscillator(),
      g = this.context.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, this.context.currentTime);
    g.gain.setValueAtTime(0.12, this.context.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.6);
    o.connect(g);
    g.connect(this.context.destination);
    o.start();
    o.stop(this.context.currentTime + 0.6);
  }
}
export class NotificationService {
  constructor(private channels: NotificationChannel[]) {}
  async notify(n: OverdueNotice) {
    await Promise.allSettled(this.channels.map((c) => Promise.resolve().then(() => c.notify(n))));
  }
}
