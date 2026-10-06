'use client';
import { useState } from 'react';
import { api } from '@/lib/client-api';
import { useMonitor } from '@/components/dashboard/provider';
export function ReturnButton({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const { refresh, online } = useMonitor();
  async function mark() {
    if (!window.confirm(`Are you sure you want to manually mark ${name} as returned?`)) return;
    setBusy(true);
    setError('');
    try {
      await api('return', { participant_id: id });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button disabled={busy || !online} onClick={mark}>
        {busy ? 'Saving…' : 'Mark returned'}
      </button>
      {error && (
        <p className="error-inline" role="alert" style={{ whiteSpace: 'normal', maxWidth: 220 }}>
          {error}
        </p>
      )}
    </div>
  );
}
