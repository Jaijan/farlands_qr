import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { AppError } from './auth';
export interface OtpProvider {
  send(email: string): Promise<void>;
  verify(email: string, code: string): Promise<boolean>;
}
function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
class SupabaseOtp implements OtpProvider {
  async send(email: string) {
    const { error } = await client().auth.signInWithOtp({ email });
    if (error)
      throw new AppError('Could not send email code. Check Email Auth/SMTP configuration or wait before retrying.', 429);
  }
  async verify(email: string, token: string) {
    const c = client();
    const { data, error } = await c.auth.verifyOtp({ email, token, type: 'email' });
    if (data.session) await c.auth.signOut();
    return (
      !error &&
      data.user?.email?.toLowerCase() === email.toLowerCase() &&
      !!data.user?.email_confirmed_at
    );
  }
}
class WebhookOtp implements OtpProvider {
  async call(action: string, email: string, code?: string) {
    const url = process.env.OTP_WEBHOOK_URL;
    if (!url?.startsWith('https://') || !process.env.OTP_WEBHOOK_SECRET)
      throw new AppError('Email OTP setup required: configure the HTTPS webhook and secret.', 503);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OTP_WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({ action, email, code }),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!response.ok) throw new AppError('Verification service unavailable.', 503);
    return response.json();
  }
  async send(email: string) {
    if ((await this.call('send', email)).sent !== true)
      throw new AppError('Verification service did not send a code.', 503);
  }
  async verify(email: string, code: string) {
    return (await this.call('verify', email, code)).verified === true;
  }
}
export function otpProvider(): OtpProvider {
  if (process.env.OTP_PROVIDER === 'webhook') return new WebhookOtp();
  if (!process.env.OTP_PROVIDER || process.env.OTP_PROVIDER === 'supabase') return new SupabaseOtp();
  throw new AppError('Unsupported OTP provider.', 503);
}
