import { Brand } from '@/components/brand';
export default function Page() {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <span className="badge green">WELCOME TO FARLANDS</span>
      </header>
      <main className="center">
        <div className="eyebrow">Your adventure starts here</div>
        <h1 style={{ fontSize: 'clamp(32px,5vw,70px)', margin: '24px 0' }}>
          Scan. Register. Build.
        </h1>
        <p className="muted" style={{ fontSize: 24, marginTop: 24 }}>
          Scan the QR printed on your assigned participant ID card.
        </p>
        <p className="muted">Enter your details and verify your email to activate your ID card.</p>
      </main>
    </div>
  );
}
