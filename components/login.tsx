'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Brand } from './brand';
import { api } from '@/lib/client-api';
import { LockKeyhole, ArrowRight } from 'lucide-react';
export function Login({ role }: { role: 'admin' | 'volunteer' }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{ redirect: string }>('auth/login', {
        ...Object.fromEntries(new FormData(e.currentTarget)),
        role,
      });
      window.location.assign(data.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <Link className="subtle-link" href="/register">
          Participant registration ↗
        </Link>
      </header>
      <main className="login-box">
        <div className="eyebrow">Authorized personnel only</div>
        <h1 style={{ marginTop: 12 }}>
          {role === 'admin' ? 'Mission control.' : 'Welcome, volunteer.'}
        </h1>
        <p className="muted">
          {role === 'admin'
            ? 'Sign in to oversee Farlands event operations.'
            : 'Sign in to operate your assigned exit.'}
        </p>
        <form className="card card-body stack" onSubmit={submit}>
          <LockKeyhole color="var(--lime)" />
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <label>
            Staff email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
            <ArrowRight size={16} />
          </button>
          <small>
            {role === 'volunteer'
              ? 'Your account is assigned to one physical exit. Only one browser can control that exit at a time.'
              : 'Accounts are provisioned by the event administrator.'}
          </small>
        </form>
        <p className="center" style={{ marginTop: 24 }}>
          <Link
            className="subtle-link"
            href={role === 'admin' ? '/volunteer/login' : '/admin/login'}
          >
            {role === 'admin' ? 'Volunteer' : 'Administrator'} sign in →
          </Link>
        </p>
      </main>
    </div>
  );
}
