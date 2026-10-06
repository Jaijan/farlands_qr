import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, encryptToken, decryptToken } from '../lib/qr';
import { registrationSchema, scanSchema } from '../lib/validation';
import { overdue } from '../lib/monitor';
import type { ExitSession } from '../lib/types';
describe('QR security', () => {
  it('generates unique opaque 256-bit tokens with no personal information', () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateToken));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url').length).toBe(32);
      expect(hashToken(token)).toHaveLength(64);
    }
  });
  it('encrypts recoverable admin copies and detects tampering', () => {
    process.env.QR_ENCRYPTION_KEY = 'ab'.repeat(32);
    const token = generateToken();
    const encrypted = encryptToken(token);
    expect(encrypted).not.toContain(token);
    expect(decryptToken(encrypted)).toBe(token);
    const bytes = Buffer.from(encrypted, 'base64url');
    bytes[20] ^= 1;
    expect(() => decryptToken(bytes.toString('base64url'))).toThrow();
  });
  it('rejects participant codes, malformed payloads and unknown modes', () => {
    expect(
      scanSchema.safeParse({ token: 'FARL-0001', mode: 'auto', request_id: crypto.randomUUID() })
        .success,
    ).toBe(false);
    expect(
      scanSchema.safeParse({
        token: `FARLANDS:${generateToken()}`,
        mode: 'exit',
        request_id: crypto.randomUUID(),
      }).success,
    ).toBe(true);
  });
});
describe('registration validation', () => {
  const valid = {
    name: 'A Participant',
    phone: '+919876543210',
    email: 'PERSON@example.com',
    team_name: 'Alpha',
    college_name: 'Example college',
    alternate_contact: '+919876543211',
  };
  it('normalizes email and rejects missing/invalid details', () => {
    expect(registrationSchema.parse(valid).email).toBe('person@example.com');
    for (const key of Object.keys(valid)) {
      expect(registrationSchema.safeParse({ ...valid, [key]: '' }).success).toBe(false);
    }
    expect(registrationSchema.safeParse({ ...valid, phone: '9876543210' }).success).toBe(false);
  });
});
it('computes the exact 30 minute boundary and clears on return', () => {
  const s = { exited_at: '2026-10-06T00:00:00Z', returned_at: null } as ExitSession;
  expect(overdue(s, Date.parse('2026-10-06T00:29:59Z'))).toBe(false);
  expect(overdue(s, Date.parse('2026-10-06T00:30:00Z'))).toBe(true);
  expect(
    overdue({ ...s, returned_at: '2026-10-06T00:31:00Z' }, Date.parse('2026-10-06T01:00:00Z')),
  ).toBe(false);
});
