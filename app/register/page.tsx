import { Brand } from '@/components/brand';
import { RegistrationForm } from '@/components/participants/registration-form';
export default function Register() {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <span className="badge green">PARTICIPANT ACCESS</span>
      </header>
      <main className="public-main">
        <div className="eyebrow">Welcome to Farlands</div>
        <h1 style={{ marginTop: 12 }}>Make it official.</h1>
        <p className="muted">Register with your assigned ID card QR to activate your event pass.</p>
        <RegistrationForm />
      </main>
      <footer className="public-footer">
        Your personal details are never stored in your QR code.
      </footer>
    </div>
  );
}
