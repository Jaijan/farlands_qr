import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { AppError, staffAuth } from '@/lib/auth';
import { configured, service, sessionClient } from '@/lib/supabase/server';
import { decryptToken, encryptToken, generateToken, hashToken } from '@/lib/qr';
import { registrationSchema, scanSchema, tokenSchema } from '@/lib/validation';
import { otpProvider } from '@/lib/otp';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const safeMessages = [
  'Registration is closed',
  'Verification expired',
  'Exit is already occupied',
  'Exit session expired',
  'Access denied',
  'QR code revoked',
  'Participant not found',
  'Participant suspended',
  'Participant is already outside',
  'Participant is currently inside',
  'Participant state requires',
  'No active exit session',
  'Use an assigned',
  'Invalid request reuse',
];
function check(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (error.code === '23505')
    throw new AppError('A participant or active volunteer with these details already exists.', 409);
  if (safeMessages.some((m) => error.message.startsWith(m))) throw new AppError(error.message, 409);
  throw new AppError('System temporarily unavailable. Please try again.', 503);
}
async function rate(key: string, limit: number, seconds: number) {
  const { data, error } = await service().rpc('take_rate', {
    p_key: hashToken(key),
    p_limit: limit,
    p_seconds: seconds,
  });
  check(error);
  if (!data) throw new AppError('Too many attempts. Please wait before trying again.', 429);
}
async function handle(req: NextRequest, context: Context) {
  try {
    const path = (await context.params).path.join('/');
    if (!configured())
      throw new AppError(
        'System setup required. Configure Supabase and the QR encryption key using README.',
        503,
      );
    if (req.method === 'POST') {
      const origin = req.headers.get('origin');
      if (!origin || origin !== new URL(process.env.APP_ORIGIN || req.url).origin)
        throw new AppError('Invalid request origin.', 403);
      if (Number(req.headers.get('content-length') || 0) > 16384)
        throw new AppError('Request too large.', 413);
    }
    const db = service();
    if (path === 'registration/status' && req.method === 'GET') {
      const { data, error } = await db
        .from('settings')
        .select('registration_open')
        .eq('id', true)
        .single();
      check(error);
      return NextResponse.json(data);
    }
    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
      const raw = await req.text();
      if (Buffer.byteLength(raw, 'utf8') > 16384) throw new AppError('Request too large.', 413);
      try {
        body = JSON.parse(raw);
      } catch {
        throw new AppError('Invalid JSON request.', 400);
      }
      if (!body || Array.isArray(body) || typeof body !== 'object')
        throw new AppError('Invalid request.', 400);
    }
    if (path === 'registration/send' && req.method === 'POST') {
      const details = registrationSchema.parse(body);
      await rate(`registration:email:${details.email}`, 3, 600);
      await rate(`registration:phone:${details.phone}`, 3, 600);
      await rate('registration:global', 1200, 3600);
      if (process.env.TRUST_PROXY === 'true')
        await rate(
          `registration:ip:${req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'}`,
          30,
          600,
        );
      const { data: existingEmail, error: emailError } = await db
        .from('participants')
        .select('id')
        .eq('email', details.email)
        .maybeSingle();
      check(emailError);
      const { data: existingPhone, error: phoneError } = await db
        .from('participants')
        .select('id')
        .eq('phone', details.phone)
        .maybeSingle();
      check(phoneError);
      if (existingEmail || existingPhone)
        throw new AppError('A participant with these details is already registered.', 409);
      const { data: settings, error: settingsError } = await db
        .from('settings')
        .select('*')
        .eq('id', true)
        .single();
      check(settingsError);
      if (!settings?.registration_open) throw new AppError('Registration is closed.', 409);
      await otpProvider().send(details.email);
      const { data, error } = await db
        .from('registration_challenges')
        .insert({ phone: details.phone, details })
        .select('id')
        .single();
      check(error);
      return NextResponse.json({ challenge_id: data!.id });
    }
    if (path === 'registration/verify' && req.method === 'POST') {
      const input = z
        .object({ challenge_id: z.uuid(), code: z.string().regex(/^\d{4,8}$/) })
        .parse(body);
      const { data: challenge, error: attemptError } = await db.rpc('otp_attempt', {
        p_id: input.challenge_id,
      });
      check(attemptError);
      const { data: pending, error: pendingError } = await db
        .from('registration_challenges')
        .select('details')
        .eq('id', input.challenge_id)
        .single();
      check(pendingError);
      if (!pending) throw new AppError('Verification expired. Request a new code.', 400);
      await rate(`registration:verify:${pending.details.email}`, 15, 600);
      if (!(await otpProvider().verify(pending.details.email, input.code)))
        throw new AppError('Invalid or expired verification code.', 400);
      const token = generateToken();
      const { data, error } = await db.rpc('complete_registration', {
        p_challenge: input.challenge_id,
        p_hash: hashToken(token),
        p_encrypted: encryptToken(token),
      });
      check(error);
      return NextResponse.json({ ...data, token });
    }
    if (path === 'participant/qr' && req.method === 'POST') {
      const token = tokenSchema.parse(body.token);
      await rate('qr:public', 10000, 3600);
      const { data, error } = await db
        .from('participants')
        .select('participant_code')
        .eq('qr_token_hash', hashToken(token))
        .maybeSingle();
      check(error);
      if (!data) throw new AppError('This QR is invalid or has been revoked.', 404);
      return NextResponse.json(data);
    }
    if (path === 'auth/login' && req.method === 'POST') {
      const input = z
        .object({
          email: z.email(),
          password: z.string().min(1).max(256),
          role: z.enum(['admin', 'volunteer']),
        })
        .parse(body);
      await rate(`login:${input.email.toLowerCase()}`, 10, 900);
      await rate('login:global', 1000, 900);
      const auth = await sessionClient();
      const { data, error } = await auth.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });
      if (error || !data.user) throw new AppError('Incorrect email or password.', 401);
      try {
        const { staff } = await staffAuth(input.role === 'admin', false);
        if (staff.role !== input.role)
          throw new AppError('Use the correct staff sign-in page.', 403);
        const lease = generateToken();
        const { error: leaseError } = await db.rpc('acquire_lease', {
          p_actor: staff.id,
          p_hash: hashToken(lease),
        });
        check(leaseError);
        (await cookies()).set('farlands_lease', lease, {
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: 60 * 60 * 16,
        });
        return NextResponse.json({
          redirect: staff.role === 'admin' ? '/admin/dashboard' : '/volunteer/scanner',
        });
      } catch (e) {
        await auth.auth.signOut();
        throw e;
      }
    }
    if (path === 'auth/logout' && req.method === 'POST') {
      const auth = await sessionClient();
      const {
        data: { user },
      } = await auth.auth.getUser();
      const lease = (await cookies()).get('farlands_lease')?.value;
      if (user) {
        const { error } = await db.rpc('release_lease', {
          p_actor: user.id,
          p_lease: lease ? hashToken(lease) : null,
        });
        check(error);
      }
      await auth.auth.signOut();
      (await cookies()).delete('farlands_lease');
      return NextResponse.json({ ok: true });
    }
    const adminRoute = path.startsWith('admin/');
    const { staff, leaseHash } = await staffAuth(adminRoute);
    const actor = { p_actor: staff.id, p_lease: leaseHash };
    if (path === 'heartbeat' && req.method === 'POST') {
      const { error } = await db.rpc('heartbeat', actor);
      check(error);
      return NextResponse.json({ server_time: new Date().toISOString() });
    }
    if (path === 'snapshot' && req.method === 'GET') {
      const { error: overdueError } = await db.rpc('mark_overdue');
      check(overdueError);
      const { data, error } = await db.rpc('monitor_snapshot', actor);
      check(error);
      return NextResponse.json(data);
    }
    if (path === 'scan' && req.method === 'POST') {
      const input = scanSchema.parse(body);
      await rate(`scan:${staff.id}`, 180, 60);
      const { data, error } = await db.rpc('scan_participant', {
        ...actor,
        p_hash: hashToken(input.token),
        p_mode: input.mode,
        p_request: input.request_id,
      });
      check(error);
      return NextResponse.json(data);
    }
    if (path === 'return' && req.method === 'POST') {
      const id = z.uuid().parse(body.participant_id);
      const { error } = await db.rpc('manual_return', { ...actor, p_participant: id });
      check(error);
      return NextResponse.json({ ok: true });
    }
    if (path === 'admin/settings' && req.method === 'POST') {
      const opened = z.boolean().parse(body.open);
      const { error } = await db.rpc('change_registration', { p_actor: staff.id, p_open: opened });
      check(error);
      return NextResponse.json({ ok: true });
    }
    if (path === 'admin/qr' && req.method === 'POST') {
      const input = z
        .object({ participant_id: z.uuid(), action: z.enum(['view', 'regenerate', 'revoke']) })
        .parse(body);
      if (input.action === 'view') {
        const { data, error } = await db
          .from('qr_secrets')
          .select('encrypted_token')
          .eq('participant_id', input.participant_id)
          .maybeSingle();
        check(error);
        if (!data) throw new AppError('QR has been revoked. Regenerate to issue a new QR.', 404);
        return NextResponse.json({ token: decryptToken(data.encrypted_token) });
      }
      const token = input.action === 'regenerate' ? generateToken() : null;
      const { error } = await db.rpc('change_qr', {
        p_actor: staff.id,
        p_participant: input.participant_id,
        p_hash: token ? hashToken(token) : null,
        p_encrypted: token ? encryptToken(token) : null,
      });
      check(error);
      return NextResponse.json({ token });
    }
    if (path === 'admin/audit' && req.method === 'GET') {
      const page = Math.max(0, Number(req.nextUrl.searchParams.get('page')) || 0);
      const { data, error } = await db
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(page * 100, page * 100 + 99);
      check(error);
      return NextResponse.json(data);
    }
    if (path === 'admin/volunteers' && req.method === 'GET') {
      const { data, error } = await db.from('volunteers').select('*').order('created_at');
      check(error);
      return NextResponse.json(data);
    }
    if (path === 'admin/volunteers' && req.method === 'POST') {
      if (body.action === 'toggle') {
        const input = z.object({ id: z.uuid(), active: z.boolean() }).parse(body);
        const { error } = await db.rpc('set_volunteer_active', {
          p_actor: staff.id,
          p_target: input.id,
          p_active: input.active,
        });
        check(error);
        return NextResponse.json({ ok: true });
      }
      const input = z
        .object({
          name: z.string().trim().min(2).max(100),
          email: z.email(),
          password: z.string().min(12).max(128),
          exit: z.enum(['exit_1', 'exit_2']),
        })
        .parse(body);
      const { data, error } = await db.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
      });
      check(error);
      const { error: profileError } = await db.from('volunteers').insert({
        id: data.user!.id,
        name: input.name,
        username: input.email.toLowerCase(),
        role: 'volunteer',
        assigned_exit: input.exit,
      });
      if (profileError) {
        await db.auth.admin.deleteUser(data.user!.id);
        check(profileError);
      }
      const { error: auditError } = await db.from('audit_logs').insert({
        actor_id: staff.id,
        actor_type: 'admin',
        action: 'volunteer_created',
        metadata: { volunteer: data.user!.id, exit: input.exit },
      });
      check(auditError);
      return NextResponse.json({ ok: true });
    }
    throw new AppError('Not found.', 404);
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: error.issues[0]?.message || 'Invalid input.' },
        { status: 400 },
      );
    if (error instanceof AppError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    // Deliberately omit request URLs, QR tokens, phone numbers and provider responses from logs.
    console.error('Farlands API failure', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'System temporarily unavailable. Please try again.' },
      { status: 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
