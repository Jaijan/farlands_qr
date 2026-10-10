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
  process.env.PHONE_OTP_CONFIGURED = 'true';
  mocks.signOut.mockResolvedValue({ error: null });
});
describe('phone verification adapter', () => {
  it('requests a phone code and never treats sending as verification', async () => {
    mocks.send.mockResolvedValue({ error: null });
    await otpProvider().send('+919876543210');
    expect(mocks.send).toHaveBeenCalledWith({ phone: '+919876543210' });
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('accepts only the verified requested phone and destroys the temporary participant session', async () => {
    mocks.verify.mockResolvedValue({
      error: null,
      data: {
        session: {},
        user: { phone: '+919876543210', phone_confirmed_at: '2026-10-06' },
      },
    });
    expect(await otpProvider().verify('+919876543210', '123456')).toBe(true);
    expect(mocks.verify).toHaveBeenCalledWith({
      phone: '+919876543210',
      token: '123456',
      type: 'sms',
    });
    expect(mocks.signOut).toHaveBeenCalled();
  });
  it('rejects invalid codes, unconfirmed phone, and mismatched identities', async () => {
    for (const result of [
      { error: { message: 'invalid' }, data: { user: null } },
      { error: null, data: { user: { phone: '+919876543210' } } },
      {
        error: null,
        data: { user: { phone: '+919876543211', phone_confirmed_at: '2026-10-06' } },
      },
    ]) {
      mocks.verify.mockResolvedValue(result);
      expect(await otpProvider().verify('+919876543210', '000000')).toBe(false);
    }
  });
  it('surfaces provider send failures', async () => {
    mocks.send.mockResolvedValue({ error: { message: 'limited' } });
    await expect(otpProvider().send('+919876543210')).rejects.toThrow(/Could not send/);
  });
  it('fails closed for unknown providers', () => {
    process.env.OTP_PROVIDER = 'typo';
    expect(() => otpProvider()).toThrow(/Unsupported/);
  });
  it('fails clearly when SMS is not configured', () => {
    delete process.env.PHONE_OTP_CONFIGURED;
    expect(() => otpProvider()).toThrow(/Phone OTP setup required/);
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
      await expect(otpProvider().send('+919876543210')).rejects.toThrow(/did not send/);
      expect(await otpProvider().verify('+919876543210', '123456')).toBe(false);
      expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
        action: 'verify',
        phone: '+919876543210',
        code: '123456',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
