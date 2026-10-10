'use client';
import { useState } from 'react';
import { useMonitor } from './provider';
import { api } from '@/lib/client-api';
import { QrInventory } from '@/components/qr/inventory';
export function SettingsPage() {
  const { data, refresh, online } = useMonitor();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      await api('admin/settings', { open: !data?.registration_open });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Event configuration</div>
          <h1 style={{ marginTop: 10 }}>Ready when you are.</h1>
          <p>Control registration and prepare participant ID card QRs.</p>
        </div>
      </div>
      <div className="grid-two">
        <section className="card">
          <div className="card-head">
            <h2>Public registration</h2>
            <span className={`badge ${data?.registration_open ? 'green' : 'red'}`}>
              {data?.registration_open ? 'OPEN' : 'CLOSED'}
            </span>
          </div>
          <div className="card-body stack">
            <p className="muted">
              Closing registration prevents new participants from being created, including people
              who are currently verifying their email. Existing passes continue to work.
            </p>
            {error && <p className="alert">{error}</p>}
            <button
              className={data?.registration_open ? 'danger' : 'primary'}
              disabled={busy || !online || !data}
              onClick={toggle}
            >
              {busy
                ? 'Updating…'
                : data?.registration_open
                  ? 'Close registration'
                  : 'Open registration'}
            </button>
            <div className="notice">
              <strong>30-minute outside limit</strong>
              <p className="muted" style={{ margin: '8px 0 0' }}>
                The database checks overdue sessions every minute. Dashboards display the threshold
                immediately using server time, even between scheduled checks.
              </p>
            </div>
            <small>All registration changes are recorded in the audit trail.</small>
          </div>
        </section>
      </div>
      <QrInventory />
    </>
  );
}
