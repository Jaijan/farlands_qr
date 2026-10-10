import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { AppError, staffAuth } from '@/lib/auth';
import { configured, service, sessionClient } from '@/lib/supabase/server';
import { decryptToken, encryptToken, generateToken, hashToken } from '@/lib/qr';
import { registrationSchema, scanSchema, tokenSchema } from '@/lib/validation';
import { otpProvider } from '@/lib/otp';
import { qrArchiveStream, registrationOrigin, registrationUrl } from '@/lib/qr-archive';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
const safeMessages = [
  'Registration is closed',
  'Verification expired',
  'Exit is already occupied',
  'Exit session expired',
  'Access denied',
  'QR code revoked',
  'QR already claimed',
  'QR not found',
  'QR not yet claimed',
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
  if (['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703', '42883'].includes(error.code || ''))
    throw new AppError(
      'Event database setup is incomplete. The administrator must apply the latest Supabase migrations, then refresh this page.',
      503,
    );
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
    if (path === 'registration/validate' && req.method === 'POST') {
      const token = tokenSchema.parse(body.token);
      await rate('registration:validate', 10000, 3600);
      const { data, error } = await db
        .from('qr_inventory')
        .select('status,serial_number')
        .eq('token_hash', hashToken(token))
        .maybeSingle();
      check(error);
      if (!data) throw new AppError('Invalid ID card QR. Please contact event staff.', 404);
      if (data.status !== 'unassigned')
        throw new AppError(
          data.status === 'revoked'
            ? 'QR code revoked.'
            : 'QR already claimed. This ID card is already registered.',
          409,
        );
      return NextResponse.json({ serial_number: data.serial_number });
    }
    if (path === 'registration/send' && req.method === 'POST') {
      const input = z
        .object({ token: tokenSchema, details: registrationSchema })
        .strict()
        .parse(body);
      const details = input.details;
      const { data: qr, error: qrError } = await db
        .from('qr_inventory')
        .select('id,status')
        .eq('token_hash', hashToken(input.token))
        .maybeSingle();
      check(qrError);
      if (!qr) throw new AppError('Invalid ID card QR.', 404);
      if (qr.status !== 'unassigned')
        throw new AppError(
          qr.status === 'revoked' ? 'QR code revoked.' : 'QR already claimed.',
          409,
        );
      const provider = otpProvider();
      await rate(`registration:cooldown:${details.email}`, 1, 60);
      await rate(`registration:qr:${qr.id}`, 3, 600);
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
      const binding = generateToken();
      await provider.send(details.email);
      const { data, error } = await db
        .from('registration_challenges')
        .insert({
          phone: details.phone,
          details,
          qr_id: qr.id,
          binding_hash: hashToken(binding),
          verification_method: 'email',
        })
        .select('id')
        .single();
      check(error);
      (await cookies()).set('farlands_registration', binding, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/api/registration',
        maxAge: 60 * 60,
      });
      return NextResponse.json({ challenge_id: data!.id });
    }
    if (path === 'registration/verify' && req.method === 'POST') {
      const input = z
        .object({ challenge_id: z.uuid(), code: z.string().regex(/^\d{4,8}$/) })
        .parse(body);
      const binding = (await cookies()).get('farlands_registration')?.value;
      if (!binding) throw new AppError('Verification expired. Request a new code.', 400);
      const { data: pending, error: pendingError } = await db
        .from('registration_challenges')
        .select('details,verification_method,verified_at,consumed_at,expires_at')
        .eq('id', input.challenge_id)
        .eq('binding_hash', hashToken(binding))
        .maybeSingle();
      check(pendingError);
      if (!pending) throw new AppError('Verification expired. Request a new code.', 400);
      if (!pending.consumed_at && pending.verification_method !== 'email')
        throw new AppError('Verification expired. Request a new email code.', 400);
      if (!pending.consumed_at && !pending.verified_at) {
        const { error: attemptError } = await db.rpc('otp_attempt', { p_id: input.challenge_id });
        check(attemptError);
        await rate(`registration:verify:${pending.details.email}`, 15, 600);
        if (!(await otpProvider().verify(pending.details.email, input.code)))
          throw new AppError('Invalid or expired verification code.', 400);
        const { error: verifiedError } = await db
          .from('registration_challenges')
          .update({ verified_at: new Date().toISOString() })
          .eq('id', input.challenge_id);
        check(verifiedError);
      }
      const { data, error } = await db.rpc('complete_qr_claim', {
        p_challenge: input.challenge_id,
        p_binding: hashToken(binding),
      });
      check(error);
      return NextResponse.json(data);
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
    if (path === 'admin/inventory' && req.method === 'GET') {
      const page = z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .parse(req.nextUrl.searchParams.get('page') || 0);
      const status = z
        .enum(['all', 'unassigned', 'claimed', 'revoked'])
        .parse(req.nextUrl.searchParams.get('status') || 'all');
      const search = z
        .string()
        .max(80)
        .regex(/^[A-Za-z0-9-]*$/)
        .parse(req.nextUrl.searchParams.get('search') || '');
      const batch = req.nextUrl.searchParams.get('batch');
      let query = db
        .from('qr_inventory')
        .select(
          'id,batch_id,serial_number,status,participant_id,created_at,claimed_at,revoked_at',
          { count: 'exact' },
        );
      if (status !== 'all') query = query.eq('status', status);
      if (search) query = query.ilike('serial_number', `%${search}%`);
      if (batch) query = query.eq('batch_id', z.uuid().parse(batch));
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .order('serial_number')
        .range(page * 50, page * 50 + 49);
      check(error);
      const { data: batches, error: batchError } = await db
        .from('qr_batches')
        .select('id,quantity,created_at')
        .order('created_at', { ascending: false })
        .limit(1000);
      check(batchError);
      return NextResponse.json({ rows: data, count, batches });
    }
    if (path === 'admin/inventory/generate' && req.method === 'POST') {
      const input = z
        .object({ quantity: z.number().int().min(1).max(1000), batch_id: z.uuid() })
        .strict()
        .parse(body);
      registrationOrigin();
      await rate(`qr:generate:${staff.id}`, 20, 3600);
      const codes = Array.from({ length: input.quantity }, () => {
        const token = generateToken();
        return { hash: hashToken(token), encrypted: encryptToken(token) };
      });
      const { data, error } = await db.rpc('generate_qr_batch', {
        p_actor: staff.id,
        p_batch: input.batch_id,
        p_codes: codes,
      });
      check(error);
      return NextResponse.json({ batch_id: data, quantity: input.quantity });
    }
    if (path === 'admin/inventory/download' && req.method === 'POST') {
      const batch = z.uuid().parse(body.batch_id);
      await rate(`qr:download:${staff.id}`, 30, 3600);
      const { data: rows, error } = await db
        .from('qr_inventory')
        .select('id,serial_number')
        .eq('batch_id', batch)
        .order('serial_number')
        .limit(1000);
      check(error);
      if (!rows?.length) throw new AppError('QR batch not found.', 404);
      const { data: secrets, error: secretError } = await db
        .from('qr_inventory_secrets')
        .select('qr_id,encrypted_token')
        .in(
          'qr_id',
          rows.map((r) => r.id),
        )
        .limit(1000);
      check(secretError);
      const byId = new Map(secrets?.map((s) => [s.qr_id, s.encrypted_token]));
      if (rows.some((r) => !byId.has(r.id)))
        throw new AppError('Batch secrets are incomplete. Contact the administrator.', 503);
      const archive = await qrArchiveStream(
        rows.map((r) => ({ serial_number: r.serial_number, encrypted_token: byId.get(r.id)! })),
      );
      const { error: auditError } = await db.from('audit_logs').insert({
        actor_id: staff.id,
        actor_type: 'admin',
        action: 'qr_batch_downloaded',
        metadata: { batch, quantity: rows.length },
      });
      check(auditError);
      return new NextResponse(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="farlands-${batch}.zip"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
    if (path === 'admin/inventory/revoke' && req.method === 'POST') {
      const { error } = await db.rpc('revoke_inventory_qr', {
        p_actor: staff.id,
        p_qr: z.uuid().parse(body.qr_id),
      });
      check(error);
      return NextResponse.json({ ok: true });
    }
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
        if (!data)
          throw new AppError(
            'QR has been revoked. Check the participant and inventory history.',
            404,
          );
        const token = decryptToken(data.encrypted_token);
        const { data: inventory, error: inventoryError } = await db
          .from('qr_inventory')
          .select('serial_number')
          .eq('participant_id', input.participant_id)
          .maybeSingle();
        check(inventoryError);
        return NextResponse.json({
          token,
          serial_number: inventory?.serial_number,
          payload: inventory ? registrationUrl(token) : `FARLANDS:${token}`,
        });
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
