'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import { registrationSchema, type Registration } from '@/lib/validation';
type Success = {
  participant_code: string;
  name: string;
  team_name: string;
  college_name: string;
};
export function RegistrationForm() {
  const [token, setToken] = useState('');
  const [serial, setSerial] = useState('');
  const [open, setOpen] = useState<boolean | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [challenge, setChallenge] = useState(''),
    [details, setDetails] = useState<Registration | null>(null),
    [success, setSuccess] = useState<Success | null>(null),
    [resendAt, setResendAt] = useState(0),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const key = new URL(window.location.href).searchParams.get('key');
    // Keep the credential in memory; do not expose an editable token field.
    if (!key) setError('Scan the QR printed on your assigned ID card to register.');
    else {
      setToken(key);
      Promise.all([
        api<{ registration_open: boolean }>('registration/status'),
        api<{ serial_number: string }>('registration/validate', { token: key }),
      ])
        .then(([d, qr]) => {
          setOpen(d.registration_open);
          setSerial(qr.serial_number);
        })
        .catch((e) => setError(e.message));
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function send(data: Registration) {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ challenge_id: string }>('registration/send', { token, details: data });
      setDetails(data);
      setChallenge(r.challenge_id);
      setResendAt(Date.now() + 60000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
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

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = registrationSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    await send(parsed.data);
  }
  const step = success ? 3 : challenge ? 2 : 1;
  return (
    <>
      <div className="steps">
        {['Details', 'Email verification', 'Complete'].map((s, i) => (
          <span key={s} className={i + 1 <= step ? 'current' : ''}>
            <span className="step-n">{i + 1}</span>
            {s}
          </span>
        ))}
      </div>
      {serial && <p className="mono muted">ID card: {serial}</p>}
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
                  <strong className="mono">{success.participant_code}</strong>
                  <p className="notice">
                    Your ID card QR is now active. Use the QR printed on your original ID card when
                    exiting and returning to the venue.
                  </p>
                </div>
              ) : challenge ? (
                <form onSubmit={verify} className="stack">
                  <ShieldCheck color="var(--lime)" size={32} />
                  <h2>Verify your email</h2>
                  <p className="muted">Enter the email verification code sent to {details?.email}.</p>
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
                    {busy ? 'Verifying…' : 'Verify & activate my ID card'}
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
                    Use international phone numbers with a country code. We will send a verification
                    code to the email address above. Event staff use these details for registration
                    and venue safety.
                  </p>
                  <button className="primary full" disabled={busy}>
                    {busy ? 'Sending verification code…' : 'Send email code'}
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
