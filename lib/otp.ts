import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { AppError } from './auth';
export interface OtpProvider {
  send(phone: string): Promise<void>;
  verify(phone: string, code: string): Promise<boolean>;
}
function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
class SupabaseOtp implements OtpProvider {
  async send(phone: string) {
    const { error } = await client().auth.signInWithOtp({ phone });
    if (error)
      throw new AppError('Could not send verification code. Please wait and try again.', 429);
  }
  async verify(phone: string, token: string) {
    const c = client();
    const { data, error } = await c.auth.verifyOtp({ phone, token, type: 'sms' });
    if (data.session) await c.auth.signOut();
    return (
      !error &&
      data.user?.phone?.replace(/^\+/, '') === phone.replace(/^\+/, '') &&
      !!data.user?.phone_confirmed_at
    );
  }
}
class WebhookOtp implements OtpProvider {
  async call(action: string, phone: string, code?: string) {
    const url = process.env.OTP_WEBHOOK_URL;
    if (!url?.startsWith('https://') || !process.env.OTP_WEBHOOK_SECRET)
      throw new AppError('Phone OTP setup required: configure the HTTPS webhook and secret.', 503);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OTP_WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({ action, phone, code }),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!response.ok) throw new AppError('Verification service unavailable.', 503);
    return response.json();
  }
  async send(phone: string) {
    if ((await this.call('send', phone)).sent !== true)
      throw new AppError('Verification service did not send a code.', 503);
  }
  async verify(phone: string, code: string) {
    return (await this.call('verify', phone, code)).verified === true;
  }
}
export function otpProvider(): OtpProvider {
  if (process.env.OTP_PROVIDER === 'webhook') return new WebhookOtp();
  if (process.env.OTP_PROVIDER === 'supabase' && process.env.PHONE_OTP_CONFIGURED === 'true')
    return new SupabaseOtp();
  if (!process.env.OTP_PROVIDER || process.env.OTP_PROVIDER === 'supabase')
    throw new AppError(
      'Phone OTP setup required: enable Supabase Phone Auth, configure an SMS provider, and set PHONE_OTP_CONFIGURED=true.',
      503,
    );
  throw new AppError('Unsupported OTP provider.', 503);
}
