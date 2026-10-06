'use client';
export type OverdueNotice = { id: string; name: string; participant_code: string };
export interface NotificationChannel {
  notify(notice: OverdueNotice): void | Promise<void>;
}
export class BrowserChannel implements NotificationChannel {
  notify(n: OverdueNotice) {
    if ('Notification' in window && Notification.permission === 'granted')
      new Notification('Farlands Alert', {
        body: `${n.name} (${n.participant_code}) has been outside for more than 30 minutes.`,
        tag: n.id,
      });
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
