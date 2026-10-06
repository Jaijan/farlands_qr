'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client-api';
import { browserClient } from '@/lib/supabase/browser';
import type { Snapshot } from '@/lib/types';
import { overdue } from '@/lib/monitor';
import { BrowserChannel, NotificationService, SoundChannel } from '@/lib/notifications';
type Monitor = {
  data: Snapshot | null;
  now: number;
  online: boolean;
  realtime: boolean;
  error: string;
  refresh: () => Promise<void>;
  enableAlerts: () => Promise<void>;
  alerts: boolean;
  alertMessage: string;
};
const Context = createContext<Monitor | null>(null);
export function useMonitor() {
  const c = useContext(Context);
  if (!c) throw new Error('Monitor provider missing');
  return c;
}
export function MonitorProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Snapshot | null>(null),
    [now, setNow] = useState(Date.now()),
    [online, setOnline] = useState(false),
    [realtime, setRealtime] = useState(false),
    [error, setError] = useState(''),
    [alerts, setAlerts] = useState(false),
    [alertMessage, setAlertMessage] = useState('');
  const offset = useRef(0),
    loading = useRef(false),
    notified = useRef(new Set<string>()),
    sound = useRef<SoundChannel | null>(null),
    lastSuccess = useRef(0);
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const d = await api<Snapshot>('snapshot');
      offset.current = new Date(d.server_time).getTime() - Date.now();
      setData(d);
      lastSuccess.current = Date.now();
      setOnline(true);
      setError('');
    } catch (e) {
      setOnline(false);
      setError((e as Error).message);
    } finally {
      loading.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now() + offset.current);
      if (Date.now() - lastSuccess.current > 30000) setOnline(false);
    }, 1000);
    const poll = setInterval(() => void refresh(), 10000);
    const heartbeat = setInterval(() => {
      api('heartbeat', {}).catch((e) => {
        setOnline(false);
        setError(e.message);
      });
    }, 20000);
    const off = () => {
      setOnline(false);
      setError('Connection lost. Scanning is temporarily unavailable.');
    };
    window.addEventListener('offline', off);
    window.addEventListener('online', refresh);
    const client = browserClient();
    const channel = client
      .channel('event-monitor')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'event_signal' },
        () => void refresh(),
      )
      .subscribe((status: string) => setRealtime(status === 'SUBSCRIBED'));
    return () => {
      clearInterval(timer);
      clearInterval(poll);
      clearInterval(heartbeat);
      window.removeEventListener('offline', off);
      window.removeEventListener('online', refresh);
      void client.removeChannel(channel);
    };
  }, [refresh]);
  async function enableAlerts() {
    try {
      sound.current ??= new SoundChannel();
      await sound.current.enable();
      if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        setAlertMessage(
          permission === 'granted'
            ? 'Browser notifications and sound enabled.'
            : 'Sound enabled. Browser notifications are blocked; overdue alerts remain visible.',
        );
      } else setAlertMessage('Sound enabled. This browser does not support system notifications.');
      setAlerts(true);
    } catch {
      setAlertMessage('Could not enable audio. Overdue alerts remain visible.');
    }
  }
  useEffect(() => {
    if (!alerts || !data) return;
    const service = new NotificationService([new BrowserChannel(), sound.current!]);
    for (const s of data.sessions.filter((s) => overdue(s, now))) {
      const key = `farlands:alert:${s.id}`;
      if (notified.current.has(key)) continue;
      try {
        if (localStorage.getItem(key)) continue;
      } catch {
        /* Private browsing can disable storage. */
      }
      const p = data.participants.find((p) => p.id === s.participant_id);
      if (!p) continue;
      notified.current.add(key);
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* In-memory deduplication remains active. */
      }
      void service.notify({ id: s.id, name: p.name, participant_code: p.participant_code });
    }
  }, [alerts, data, now]);
  return (
    <Context.Provider
      value={{ data, now, online, realtime, error, refresh, enableAlerts, alerts, alertMessage }}
    >
      {children}
    </Context.Provider>
  );
}
