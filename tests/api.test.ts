import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({
  configured: vi.fn(),
  staffAuth: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  send: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mock.cookieGet, set: mock.cookieSet }),
}));
vi.mock('../lib/supabase/server', () => ({
  configured: mock.configured,
  service: () => ({ from: mock.from, rpc: mock.rpc }),
  sessionClient: vi.fn(),
}));
vi.mock('../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/auth')>()),
  staffAuth: mock.staffAuth,
}));
vi.mock('../lib/otp', () => ({ otpProvider: () => ({ send: mock.send, verify: mock.verify }) }));
import { POST, GET } from '../app/api/[...path]/route';
import { AppError } from '../lib/auth';
import { hashToken } from '../lib/qr';

const token = 'a'.repeat(43);
const challenge = 'ec9651ed-7ead-4e14-a50f-e85e61b55976';
const details = {
  name: 'Person Name',
  phone: '+919876543210',
  email: 'person@example.org',
  team_name: 'Team',
  college_name: 'College',
  alternate_contact: '+919876543211',
};
function chain(data: unknown, error: { code: string; message: string } | null = null) {
  const result = { data, error };
  const builder: Record<string, any> = {};
  for (const name of ['select', 'eq', 'insert', 'update', 'order', 'range', 'limit', 'ilike'])
    builder[name] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}
async function request(path: string, body?: unknown, origin = 'https://farlands.example.org') {
  const req = new NextRequest(`https://farlands.example.org/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { origin, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (body ? POST : GET)(req, { params: Promise.resolve({ path: path.split('/') }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  process.env.APP_ORIGIN = 'https://farlands.example.org';
  mock.configured.mockReturnValue(true);
  mock.rpc.mockResolvedValue({ data: true, error: null });
  mock.staffAuth.mockRejectedValue(new AppError('Please sign in.', 401));
  mock.send.mockResolvedValue(undefined);
});
it('rejects foreign origins before any privileged database action', async () => {
  expect(
    (await request('registration/send', { token, details }, 'https://evil.example')).status,
  ).toBe(403);
  expect(mock.from).not.toHaveBeenCalled();
});
it('requires admin authorization for inventory and download routes', async () => {
  expect((await request('admin/inventory')).status).toBe(401);
  expect(mock.staffAuth).toHaveBeenCalledWith(true);
  expect((await request('admin/inventory/download', { batch_id: challenge })).status).toBe(401);
  expect(mock.from).not.toHaveBeenCalled();
});
it('reports a missing inventory migration without exposing database error details', async () => {
  mock.staffAuth.mockResolvedValue({ staff: { id: challenge, role: 'admin' }, leaseHash: null });
  mock.from.mockReturnValue(
    chain(null, { code: 'PGRST205', message: 'Private database diagnostic' }),
  );
  const response = await request('admin/inventory');
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.error).toContain('apply the latest Supabase migrations');
  expect(body.error).not.toContain('Private database diagnostic');
});
it('reports a missing QR generation function as incomplete database setup', async () => {
  process.env.QR_ENCRYPTION_KEY = 'ab'.repeat(32);
  mock.staffAuth.mockResolvedValue({ staff: { id: challenge, role: 'admin' }, leaseHash: null });
  mock.rpc.mockImplementation(async (name) =>
    name === 'take_rate'
      ? { data: true, error: null }
      : { data: null, error: { code: 'PGRST202', message: 'Private function diagnostic' } },
  );
  const response = await request('admin/inventory/generate', { quantity: 1, batch_id: challenge });
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain('apply the latest Supabase migrations');
});
it('validates a card without activating it or revealing token hashes', async () => {
  const q = chain({ status: 'unassigned', serial_number: 'FARL-QR-0001' });
  mock.from.mockReturnValue(q);
  const response = await request('registration/validate', { token });
  expect(await response.json()).toEqual({ serial_number: 'FARL-QR-0001' });
  expect(q.insert).not.toHaveBeenCalled();
  expect(q.update).not.toHaveBeenCalled();
});
it('binds phone verification to the scanned QR and an HTTP-only browser cookie', async () => {
  const challengeTable = chain({ id: challenge });
  mock.from.mockImplementation((table) =>
    table === 'qr_inventory'
      ? chain({ id: 'qr-id', status: 'unassigned' })
      : table === 'participants'
        ? chain(null)
        : table === 'settings'
          ? chain({ registration_open: true })
          : challengeTable,
  );
  const response = await request('registration/send', { token, details });
  expect(response.status).toBe(200);
  expect(mock.send).toHaveBeenCalledWith(details.phone);
  const inserted = challengeTable.insert.mock.calls[0][0];
  expect(inserted.qr_id).toBe('qr-id');
  expect(inserted.details).toEqual(details);
  const cookie = mock.cookieSet.mock.calls[0];
  expect(cookie[2]).toMatchObject({
    httpOnly: true,
    sameSite: 'strict',
    path: '/api/registration',
  });
  expect(inserted.binding_hash).toBe(hashToken(cookie[1]));
  expect(JSON.stringify(inserted)).not.toContain(token);
});
it('never sends OTP or creates challenges when registration is closed', async () => {
  mock.from.mockImplementation((table) =>
    table === 'qr_inventory'
      ? chain({ id: 'qr-id', status: 'unassigned' })
      : table === 'participants'
        ? chain(null)
        : chain({ registration_open: false }),
  );
  expect((await request('registration/send', { token, details })).status).toBe(409);
  expect(mock.send).not.toHaveBeenCalled();
});
it('rejects verification without its browser binding', async () => {
  expect(
    (await request('registration/verify', { challenge_id: challenge, code: '123456' })).status,
  ).toBe(400);
  expect(mock.verify).not.toHaveBeenCalled();
  expect(mock.rpc).not.toHaveBeenCalled();
});
it('uses the bound phone and never claims on provider rejection', async () => {
  mock.cookieGet.mockReturnValue({ value: 'browser-secret' });
  const pending = chain({ phone: details.phone, verified_at: null, consumed_at: null });
  mock.from.mockReturnValue(pending);
  mock.verify.mockResolvedValue(false);
  expect(
    (await request('registration/verify', { challenge_id: challenge, code: '123456' })).status,
  ).toBe(400);
  expect(pending.eq).toHaveBeenCalledWith('binding_hash', hashToken('browser-secret'));
  expect(mock.verify).toHaveBeenCalledWith(details.phone, '123456');
  expect(mock.rpc.mock.calls.some(([name]) => name === 'complete_qr_claim')).toBe(false);
});
it('retries a consumed challenge without sending or verifying another OTP', async () => {
  mock.cookieGet.mockReturnValue({ value: 'browser-secret' });
  mock.from.mockReturnValue(
    chain({ phone: details.phone, verified_at: '2026-10-10', consumed_at: '2026-10-10' }),
  );
  mock.rpc.mockResolvedValue({ data: { participant_code: 'FARL-0001' }, error: null });
  const response = await request('registration/verify', {
    challenge_id: challenge,
    code: '123456',
  });
  expect(await response.json()).toEqual({ participant_code: 'FARL-0001' });
  expect(mock.verify).not.toHaveBeenCalled();
  expect(mock.rpc).toHaveBeenCalledWith('complete_qr_claim', {
    p_challenge: challenge,
    p_binding: hashToken('browser-secret'),
  });
});
