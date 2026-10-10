import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn(), signOut: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { signInWithOtp: mocks.send, verifyOtp: mocks.verify, signOut: mocks.signOut },
  }),
}));
import { otpProvider } from '../lib/otp';
beforeEach(() => {
  vi.resetAllMocks();
  process.env.OTP_PROVIDER = 'supabase';
  mocks.signOut.mockResolvedValue({ error: null });
});
describe('email verification adapter', () => {
  it('requests a email code and never treats sending as verification', async () => {
    mocks.send.mockResolvedValue({ error: null });
    await otpProvider().send('person@example.org');
    expect(mocks.send).toHaveBeenCalledWith({ email: 'person@example.org' });
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('accepts only the verified requested email and destroys the temporary participant session', async () => {
    mocks.verify.mockResolvedValue({
      error: null,
      data: {
        session: {},
        user: { email: 'person@example.org', email_confirmed_at: '2026-10-06' },
      },
    });
    expect(await otpProvider().verify('person@example.org', '123456')).toBe(true);
    expect(mocks.verify).toHaveBeenCalledWith({
      email: 'person@example.org',
      token: '123456',
      type: 'email',
    });
    expect(mocks.signOut).toHaveBeenCalled();
  });
  it('rejects invalid codes, unconfirmed email, and mismatched identities', async () => {
    for (const result of [
      { error: { message: 'invalid' }, data: { user: null } },
      { error: null, data: { user: { email: 'person@example.org' } } },
      {
        error: null,
        data: { user: { email: 'other@example.org', email_confirmed_at: '2026-10-06' } },
      },
    ]) {
      mocks.verify.mockResolvedValue(result);
      expect(await otpProvider().verify('person@example.org', '000000')).toBe(false);
    }
  });
  it('surfaces provider send failures', async () => {
    mocks.send.mockResolvedValue({ error: { message: 'limited' } });
    await expect(otpProvider().send('person@example.org')).rejects.toThrow(/Could not send/);
  });
  it('fails closed for unknown providers', () => {
    process.env.OTP_PROVIDER = 'typo';
    expect(() => otpProvider()).toThrow(/Unsupported/);
  });
  it('uses email OTP by default without any SMS configuration', async () => {
    delete process.env.OTP_PROVIDER;
    delete process.env.PHONE_OTP_CONFIGURED;
    mocks.send.mockResolvedValue({error:null});
    await otpProvider().send('person@example.org');
    expect(mocks.send).toHaveBeenCalledWith({email:'person@example.org'});
  });
  it('requires real provider confirmation for webhook sends and verification', async () => {
    process.env.OTP_PROVIDER = 'webhook';
    process.env.OTP_WEBHOOK_URL = 'https://otp.example.org';
    process.env.OTP_WEBHOOK_SECRET = 'test-secret';
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ sent: false, verified: false }) });
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(otpProvider().send('person@example.org')).rejects.toThrow(/did not send/);
      expect(await otpProvider().verify('person@example.org', '123456')).toBe(false);
      expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
        action: 'verify',
        email: 'person@example.org',
        code: '123456',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
