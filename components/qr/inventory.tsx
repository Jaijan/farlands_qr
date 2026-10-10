'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client-api';
import { useMonitor } from '@/components/dashboard/provider';

type Inventory = {
  rows: {
    id: string;
    serial_number: string;
    batch_id: string;
    status: string;
    participant_id: string | null;
  }[];
  count: number;
  batches: { id: string; quantity: number; created_at: string }[];
};
export function InventoryCounts() {
  const { data } = useMonitor();
  return (
    <div className="stats">
      {(['total', 'unassigned', 'claimed', 'revoked'] as const).map((key) => (
        <section className="stat" key={key}>
          <span className="label">QR {key === 'total' ? 'generated' : key}</span>
          <div className="value">{data?.qr_counts?.[key] ?? '—'}</div>
        </section>
      ))}
    </div>
  );
}
export function QrInventory() {
  const { refresh, online } = useMonitor();
  const [quantity, setQuantity] = useState(300),
    [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(''),
    [error, setError] = useState('');
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [batch, setBatch] = useState(''),
    [page, setPage] = useState(0);
  const attempt = useRef<{ id: string; quantity: number } | null>(null);
  const load = useCallback(async () => {
    const params = new URLSearchParams({ search, status, batch, page: String(page) });
    const result = await api<Inventory>(`admin/inventory?${params}`);
    setInventory(result);
  }, [search, status, batch, page]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  async function download(id: string) {
    setProgress('Rendering individual PNGs and packaging ZIP…');
    const response = await fetch('/api/admin/inventory/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_id: id }),
      cache: 'no-store',
      signal: AbortSignal.timeout(300000),
    });
    if (!response.ok)
      throw new Error((await response.json()).error || 'Download failed. Retry this batch below.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `farlands-${id}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setProgress('ZIP downloaded. Each PNG includes its ID card serial number.');
  }
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setProgress('');
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-head">
        <h2>QR inventory & bulk generation</h2>
      </div>
      <div className="card-body stack">
        <InventoryCounts />
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              attempt.current ??= { id: crypto.randomUUID(), quantity };
              setProgress(`Generating ${attempt.current.quantity} QR codes…`);
              const result = await api<{ batch_id: string; quantity: number }>(
                'admin/inventory/generate',
                { quantity: attempt.current.quantity, batch_id: attempt.current.id },
              );
              attempt.current = null;
              setProgress(`${result.quantity} QR codes saved. Preparing download…`);
              await Promise.all([load(), refresh()]);
              await download(result.batch_id);
            });
          }}
        >
          <label>
            Number of QR codes
            <input
              type="number"
              min={1}
              max={1000}
              required
              value={quantity}
              disabled={busy || !!attempt.current}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <button className="primary" disabled={busy || !online}>
            {attempt.current ? 'Retry generation' : 'Generate & download ZIP'}
          </button>
        </form>
        <small>
          Print one PNG per ID card. Generating codes does not register participants. Downloads
          include the original batch; revoked codes remain unusable.
        </small>
        {progress && (
          <p className="notice" role="status">
            {progress}
          </p>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="row wrap">
          <label>
            Serial number
            <input
              value={search}
              placeholder="FARL-QR-0001"
              onChange={(e) => {
                setSearch(e.target.value.replace(/[^A-Za-z0-9-]/g, ''));
                setPage(0);
              }}
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              {['all', 'unassigned', 'claimed', 'revoked'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Batch
            <select
              value={batch}
              onChange={(e) => {
                setBatch(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All batches</option>
              {inventory?.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id.slice(0, 8)} · {b.quantity} codes ·{' '}
                  {new Date(b.created_at).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !batch || !online}
            onClick={() => void run(() => download(batch))}
          >
            Download batch ZIP
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await load();
                await refresh();
              })
            }
          >
            Refresh inventory
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Serial</th>
                <th>Batch</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {inventory?.rows.map((q) => (
                <tr key={q.id}>
                  <td className="mono">{q.serial_number}</td>
                  <td className="mono">{q.batch_id.slice(0, 8)}</td>
                  <td>
                    <span
                      className={`badge ${q.status === 'claimed' ? 'green' : q.status === 'revoked' ? 'red' : ''}`}
                    >
                      {q.status}
                    </span>
                  </td>
                  <td>
                    {q.participant_id && (
                      <a className="subtle-link" href={`/admin/participants/${q.participant_id}`}>
                        Participant{' '}
                      </a>
                    )}
                    <button
                      className="danger"
                      disabled={busy || !online || q.status === 'revoked'}
                      onClick={() => {
                        if (
                          !confirm(`Revoke ${q.serial_number}? Its printed QR will stop working.`)
                        )
                          return;
                        void run(async () => {
                          await api('admin/inventory/revoke', { qr_id: q.id });
                          await load();
                          await refresh();
                        });
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row spread">
          <small>{inventory?.count ?? 0} matching codes</small>
          <div className="row">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              disabled={(page + 1) * 50 >= (inventory?.count ?? 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
