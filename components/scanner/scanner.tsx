'use client';
import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { Camera, ScanLine } from 'lucide-react';
import { api } from '@/lib/client-api';
import { useMonitor } from '@/components/dashboard/provider';
import { duration, gateName, time } from '@/lib/monitor';
import type { ExitSession } from '@/lib/types';
type Result = {
  action: 'exit' | 'return' | 'duplicate';
  name: string;
  participant_code: string;
  team_name?: string;
  session?: ExitSession;
};
export function Scanner() {
  const { online, data, refresh } = useMonitor();
  const [mode, setMode] = useState<'auto' | 'exit' | 'return'>('auto'),
    [running, setRunning] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    controls = useRef<IScannerControls | null>(null),
    lock = useRef(false),
    last = useRef({ token: '', at: 0 }),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    generation = useRef(0);
  const current = useRef({ online, mode });
  current.current = { online, mode };
  const retry = useRef<{ token: string; mode: string; id: string } | null>(null);
  const presented = useRef({ token: '', lastSeen: 0 });
  function stop() {
    generation.current++;
    controls.current?.stop();
    controls.current = null;
    setRunning(false);
  }
  useEffect(() => {
    if (!online) {
      controls.current?.stop();
      controls.current = null;
      generation.current++;
      setRunning(false);
    }
  }, [online]);
  useEffect(
    () => () => {
      generation.current++;
      controls.current?.stop();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function scan(token: string) {
    if (lock.current || !current.current.online) return;
    if (last.current.token === token && Date.now() - last.current.at < 6000) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setResult(null);
    last.current = { token, at: Date.now() };
    const scanMode = current.current.mode;
    const attempt =
      retry.current?.token === token && retry.current.mode === scanMode
        ? retry.current
        : { token, mode: scanMode, id: crypto.randomUUID() };
    retry.current = attempt;
    try {
      const r = await api<Result>('scan', { token, mode: scanMode, request_id: attempt.id });
      retry.current = null;
      setResult(r);
      await refresh();
    } catch (e) {
      setError(
        `${(e as Error).message} Verify the participant's current state before trying again.`,
      );
      await refresh();
    } finally {
      setBusy(false);
      timer.current = setTimeout(() => {
        lock.current = false;
        setResult(null);
      }, 5000);
    }
  }
  async function start() {
    setError('');
    const gen = ++generation.current;
    try {
      const reader = new BrowserQRCodeReader();
      const c = await reader.decodeFromVideoDevice(undefined, video.current!, (r) => {
        if (r) {
          const token = r.getText();
          const alreadyPresented = presented.current.token === token;
          if (alreadyPresented) presented.current.lastSeen = Date.now();
          else if (!lock.current && current.current.online) {
            presented.current = { token, lastSeen: Date.now() };
            void scan(token);
          }
        } else if (Date.now() - presented.current.lastSeen > 1500) {
          presented.current = { token: '', lastSeen: 0 };
        }
      });
      if (gen !== generation.current) {
        c.stop();
        return;
      }
      controls.current = c;
      setRunning(true);
    } catch (e) {
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'Camera access is required to scan participant QR codes. Allow camera access in your browser.'
          : 'Camera unavailable. Connect a webcam and use HTTPS or localhost.',
      );
      setRunning(false);
    }
  }
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <ScanLine
            size={19}
            style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }}
          />
          Scan participant QR
        </h2>
        <span className="badge">{gateName(data?.staff.assigned_exit || null)}</span>
      </div>
      <div className="card-body stack">
        <div className="tabs" aria-label="Scan direction">
          {(['auto', 'exit', 'return'] as const).map((m) => (
            <button
              key={m}
              className={mode === m ? 'selected' : ''}
              disabled={busy}
              onClick={() => setMode(m)}
            >
              {m === 'auto' ? 'Auto detect' : m === 'exit' ? 'Exit only' : 'Return only'}
            </button>
          ))}
        </div>
        <small>
          {mode === 'auto'
            ? 'Auto alternates EXIT / RETURN from database state. Select an explicit direction if intent is unclear.'
            : mode === 'exit'
              ? 'Exit only: participants already outside are rejected.'
              : 'Return only: participants already inside are rejected. Returns through either exit are allowed.'}
        </small>
        <div className="camera">
          <video ref={video} muted playsInline aria-label="QR scanner camera" />
          <div className="camera-frame" />
          {!running && (
            <button
              className="primary"
              style={{ position: 'absolute' }}
              onClick={start}
              disabled={!online}
            >
              <Camera size={18} />
              Start camera
            </button>
          )}
        </div>
        <div className="row spread">
          <span className={`badge ${online ? 'green' : 'red'}`}>
            <span className="dot" />
            {!online
              ? 'OFFLINE'
              : busy
                ? 'VALIDATING…'
                : running
                  ? 'READY FOR SCANNING'
                  : 'CAMERA STOPPED'}
          </span>
          {running && <button onClick={stop}>Stop camera</button>}
        </div>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {result && (
          <div className="scan-result" role="status">
            <div className="eyebrow">
              {result.action === 'exit'
                ? 'Outside timer started'
                : result.action === 'return'
                  ? 'Participant is now inside'
                  : 'No state change'}
            </div>
            <h2 style={{ marginTop: 10 }}>
              {result.action === 'exit'
                ? 'EXIT APPROVED'
                : result.action === 'return'
                  ? 'RETURN RECORDED'
                  : 'DUPLICATE IGNORED'}
            </h2>
            <strong>{result.name}</strong>
            <p className="mono">
              {result.participant_code} · {result.team_name}
            </p>
            {result.session && (
              <p>
                {gateName(result.session.exit_id)}
                {result.action === 'return'
                  ? ` → ${gateName(result.session.return_exit_id)} · Outside for ${duration(result.session.duration_seconds || 0)}`
                  : ` · Exited at ${time(result.session.exited_at)}`}
              </p>
            )}
          </div>
        )}
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Camera unavailable? Enter QR payload
          </summary>
          <form
            className="row"
            style={{ marginTop: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              void scan(String(new FormData(f).get('token') || ''));
              f.reset();
            }}
          >
            <input
              aria-label="QR payload"
              name="token"
              placeholder="FARLANDS:…"
              autoComplete="off"
              required
            />
            <button disabled={!online || busy}>Submit</button>
          </form>
        </details>
      </div>
    </section>
  );
}
