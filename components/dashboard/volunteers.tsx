'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client-api';
import type { Staff } from '@/lib/types';
import { gateName } from '@/lib/monitor';
export function VolunteersPage() {
  const [staff, setStaff] = useState<Staff[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(
    () =>
      api<Staff[]>('admin/volunteers')
        .then(setStaff)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    setBusy(true);
    setError('');
    try {
      await api('admin/volunteers', Object.fromEntries(new FormData(f)));
      f.reset();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(s: Staff) {
    if (
      !confirm(
        `${s.active ? 'Deactivate' : 'Activate'} ${s.name}? ${s.active ? 'Their current gate session will end immediately.' : ''}`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api('admin/volunteers', { action: 'toggle', id: s.id, active: !s.active });
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
          <div className="eyebrow">Your gate crew</div>
          <h1 style={{ marginTop: 10 }}>Two exits. One team.</h1>
          <p>One active volunteer per exit, enforced in the database.</p>
        </div>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2>Staff accounts</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Sign-in email</th>
                  <th>Role / assignment</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.username}</td>
                    <td>{s.role === 'admin' ? 'Administrator' : gateName(s.assigned_exit)}</td>
                    <td>
                      <span className={`badge ${s.active ? 'green' : 'red'}`}>
                        {s.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {s.role === 'volunteer' && (
                        <button disabled={busy} onClick={() => toggle(s)}>
                          {s.active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Create gate volunteer</h2>
          </div>
          <form className="card-body form-grid" onSubmit={submit}>
            <label>
              Full name
              <input name="name" required minLength={2} maxLength={100} />
            </label>
            <label>
              Sign-in email
              <input name="email" type="email" required autoComplete="off" />
            </label>
            <label>
              Initial password
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Assigned physical exit
              <select name="exit">
                <option value="exit_1">Exit 1</option>
                <option value="exit_2">Exit 2</option>
              </select>
            </label>
            <small className="full">
              Use at least 12 characters. Share credentials privately. Deactivate the current
              volunteer before assigning a replacement to their exit.
            </small>
            <button className="primary full" disabled={busy}>
              {busy ? 'Saving…' : 'Create volunteer account'}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
