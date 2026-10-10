import { expect, it, vi } from 'vitest';
import {
  notifyOnce,
  NotificationService,
  BrowserChannel,
  clearReturnedNotifications,
} from '../lib/notifications';
const notice = { id: 'session-1', name: 'A Participant', participant_code: 'FARL-0001' };
it('notifies once per exit session across polling and reloads', async () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const send = vi.fn().mockResolvedValue(undefined);
  const seen = new Set<string>();
  await Promise.all([
    notifyOnce(notice, seen, send, storage),
    notifyOnce(notice, seen, send, storage),
  ]);
  await notifyOnce(notice, new Set(), send, storage);
  expect(send).toHaveBeenCalledTimes(1);
  await notifyOnce({ ...notice, id: 'session-2' }, seen, send, storage);
  expect(send).toHaveBeenCalledTimes(2);
});
it('deduplicates in memory if browser storage is blocked and isolates channel failures', async () => {
  const storage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  const sound = vi.fn();
  const service = new NotificationService([
    {
      notify: () => {
        throw new Error('denied');
      },
    },
    { notify: sound },
  ]);
  const seen = new Set<string>();
  await notifyOnce(notice, seen, () => service.notify(notice), storage);
  await notifyOnce(notice, seen, () => service.notify(notice), storage);
  expect(sound).toHaveBeenCalledTimes(1);
});
it('closes a displayed browser alert when its participant returns', () => {
  const close = vi.fn();
  class FakeNotification {
    static permission = 'granted';
    close = close;
  }
  vi.stubGlobal('window', { Notification: FakeNotification });
  vi.stubGlobal('Notification', FakeNotification);
  try {
    new BrowserChannel().notify(notice);
    clearReturnedNotifications(new Set([notice.id]));
    expect(close).not.toHaveBeenCalled();
    clearReturnedNotifications(new Set());
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
