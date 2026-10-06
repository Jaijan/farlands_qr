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
describe('SMS verification adapter', () => {
  it('requests an SMS and never treats sending as verification', async () => {
    mocks.send.mockResolvedValue({ error: null });
    await otpProvider().send('+919876543210');
    expect(mocks.send).toHaveBeenCalledWith({ phone: '+919876543210' });
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('accepts only the verified requested phone and destroys the temporary participant session', async () => {
    mocks.verify.mockResolvedValue({
      error: null,
      data: { session: {}, user: { phone: '919876543210', phone_confirmed_at: '2026-10-06' } },
    });
    expect(await otpProvider().verify('+919876543210', '123456')).toBe(true);
    expect(mocks.signOut).toHaveBeenCalled();
  });
  it('rejects invalid codes, unconfirmed phones, and mismatched identities', async () => {
    for (const result of [
      { error: { message: 'invalid' }, data: { user: null } },
      { error: null, data: { user: { phone: '919876543210' } } },
      { error: null, data: { user: { phone: '919876543299', phone_confirmed_at: '2026-10-06' } } },
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
});
