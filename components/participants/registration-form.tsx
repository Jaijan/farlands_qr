'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import { registrationSchema, type Registration } from '@/lib/validation';
import { QrPass } from '@/components/qr/pass';
type Success = {
  participant_code: string;
  name: string;
  team_name: string;
  college_name: string;
  token: string;
};
export function RegistrationForm() {
  const [open, setOpen] = useState<boolean | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [challenge, setChallenge] = useState(''),
    [details, setDetails] = useState<Registration | null>(null),
    [success, setSuccess] = useState<Success | null>(null),
    [resendAt, setResendAt] = useState(0),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    api<{ registration_open: boolean }>('registration/status')
      .then((d) => setOpen(d.registration_open))
      .catch((e) => setError(e.message));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function send(data: Registration) {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ challenge_id: string }>('registration/send', data);
      setDetails(data);
      setChallenge(r.challenge_id);
      setResendAt(Date.now() + 60000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = registrationSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    await send(parsed.data);
  }
  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get('code');
    setBusy(true);
    setError('');
    try {
      setSuccess(await api<Success>('registration/verify', { challenge_id: challenge, code }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const step = success ? 3 : challenge ? 2 : 1;
  return (
    <>
      <div className="steps">
        {['Details', 'Phone verification', 'Complete'].map((s, i) => (
          <span key={s} className={i + 1 <= step ? 'current' : ''}>
            <span className="step-n">{i + 1}</span>
            {s}
          </span>
        ))}
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {open === null && !error && (
        <div className="card card-body">Checking registration availability…</div>
      )}
      {open === false ? (
        <div className="card card-body">
          <h2>Registration closed</h2>
          <p>Farlands participant registration is currently closed.</p>
        </div>
      ) : (
        open && (
          <div className="card">
            <div className="card-body">
              {success ? (
                <div className="stack center">
                  <CheckCircle2 size={36} style={{ margin: 'auto', color: 'var(--lime)' }} />
                  <h2>Registration successful</h2>
                  <p>
                    {success.name}
                    <br />
                    <span className="muted">
                      {success.team_name} · {success.college_name}
                    </span>
                  </p>
                  <QrPass token={success.token} code={success.participant_code} />
                  <p className="notice">
                    Keep this QR safe. You will use the same QR when exiting and returning to the
                    venue.
                  </p>
                  <Link className="subtle-link" href={`/participant/${success.token}`}>
                    Open your private QR pass →
                  </Link>
                </div>
              ) : challenge ? (
                <form onSubmit={verify} className="stack">
                  <ShieldCheck color="var(--lime)" size={32} />
                  <h2>Verify your phone</h2>
                  <p className="muted">Enter the verification code sent to {details?.phone}.</p>
                  <label>
                    Verification code
                    <input
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{4,8}"
                      minLength={4}
                      maxLength={8}
                      required
                      autoFocus
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    {busy ? 'Verifying…' : 'Verify & create my pass'}
                    <ArrowRight size={16} />
                  </button>
                  <div className="row spread">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setChallenge('');
                        setError('');
                      }}
                    >
                      Edit details
                    </button>
                    <button
                      type="button"
                      disabled={busy || now < resendAt}
                      onClick={() => details && send(details)}
                    >
                      {now < resendAt
                        ? `Resend in ${Math.ceil((resendAt - now) / 1000)}s`
                        : 'Resend code'}
                    </button>
                  </div>
                  <small>Codes expire after 10 minutes. Maximum 5 verification attempts.</small>
                </form>
              ) : (
                <form className="form-grid" onSubmit={submit}>
                  {[
                    {
                      name: 'name',
                      label: 'Full name',
                      placeholder: 'Your full name',
                      auto: 'name',
                    },
                    {
                      name: 'phone',
                      label: 'Phone number',
                      placeholder: '+919876543210',
                      type: 'tel',
                      auto: 'tel',
                    },
                    {
                      name: 'email',
                      label: 'Email address',
                      placeholder: 'you@example.com',
                      type: 'email',
                      auto: 'email',
                    },
                    { name: 'team_name', label: 'Team name', placeholder: 'Your team' },
                    {
                      name: 'college_name',
                      label: 'College name',
                      placeholder: 'Your college / institution',
                    },
                    {
                      name: 'alternate_contact',
                      label: 'Alternate contact',
                      placeholder: '+919876543210',
                      type: 'tel',
                    },
                  ].map((f) => (
                    <label key={f.name}>
                      {f.label}
                      <input
                        name={f.name}
                        type={f.type || 'text'}
                        placeholder={f.placeholder}
                        autoComplete={f.auto}
                        defaultValue={details?.[f.name as keyof Registration]}
                        required
                        maxLength={f.name === 'email' ? 254 : 160}
                      />
                    </label>
                  ))}
                  <p className="muted full" style={{ fontSize: 12, margin: 0 }}>
                    Use international phone numbers with a country code. Event staff use these
                    details for registration and venue safety.
                  </p>
                  <button className="primary full" disabled={busy}>
                    {busy ? 'Sending verification code…' : 'Send OTP'}
                    <ArrowRight size={17} />
                  </button>
                </form>
              )}
            </div>
          </div>
        )
      )}
    </>
  );
}
