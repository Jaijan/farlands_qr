import 'server-only';
import { cookies } from 'next/headers';
import { service, sessionClient } from './supabase/server';
import { hashToken } from './qr';
import type { Staff } from './types';
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function staffAuth(adminOnly = false, requireLease = true) {
  const auth = await sessionClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) throw new AppError('Please sign in.', 401);
  const db = service();
  const { data } = await db.from('volunteers').select('*').eq('id', user.id).single();
  if (!data?.active || (adminOnly && data.role !== 'admin'))
    throw new AppError('Access denied.', 403);
  const staff = data as Staff;
  const lease = (await cookies()).get('farlands_lease')?.value;
  const leaseHash = lease ? hashToken(lease) : null;
  if (requireLease && staff.role === 'volunteer') {
    const { data: valid } = await db.rpc('valid_lease', { p_actor: staff.id, p_lease: leaseHash });
    if (!valid) throw new AppError('Exit session expired or occupied. Please sign in again.', 401);
  }
  return { staff, db, leaseHash };
}
