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
  it('requests an email code and never treats sending as verification', async () => {
    mocks.send.mockResolvedValue({ error: null });
    await otpProvider().send('person@example.com');
    expect(mocks.send).toHaveBeenCalledWith({ email: 'person@example.com' });
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('accepts only the verified requested email and destroys the temporary participant session', async () => {
    mocks.verify.mockResolvedValue({
      error: null,
      data: {
        session: {},
        user: { email: 'person@example.com', email_confirmed_at: '2026-10-06' },
      },
    });
    expect(await otpProvider().verify('person@example.com', '123456')).toBe(true);
    expect(mocks.verify).toHaveBeenCalledWith({
      email: 'person@example.com',
      token: '123456',
      type: 'email',
    });
    expect(mocks.signOut).toHaveBeenCalled();
  });
  it('rejects invalid codes, unconfirmed email, and mismatched identities', async () => {
    for (const result of [
      { error: { message: 'invalid' }, data: { user: null } },
      { error: null, data: { user: { email: 'person@example.com' } } },
      {
        error: null,
        data: { user: { email: 'other@example.com', email_confirmed_at: '2026-10-06' } },
      },
    ]) {
      mocks.verify.mockResolvedValue(result);
      expect(await otpProvider().verify('person@example.com', '000000')).toBe(false);
    }
  });
  it('surfaces provider send failures', async () => {
    mocks.send.mockResolvedValue({ error: { message: 'limited' } });
    await expect(otpProvider().send('person@example.com')).rejects.toThrow(/Could not send/);
  });
  it('fails closed for unknown providers', () => {
    process.env.OTP_PROVIDER = 'typo';
    expect(() => otpProvider()).toThrow(/Unsupported/);
  });
});
