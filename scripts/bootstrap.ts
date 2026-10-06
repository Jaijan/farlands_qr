import { createClient } from '@supabase/supabase-js';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const {
  NEXT_PUBLIC_SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: key,
  BOOTSTRAP_ADMIN_EMAIL: email,
  BOOTSTRAP_ADMIN_PASSWORD: password,
  BOOTSTRAP_ADMIN_NAME: name,
} = process.env;
if (!url || !key || !email || !password || password.length < 12)
  throw new Error(
    'Set Supabase credentials, BOOTSTRAP_ADMIN_EMAIL and a password of at least 12 characters.',
  );
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function main() {
  const { data: admins, error: lookupError } = await db
    .from('volunteers')
    .select('id')
    .eq('role', 'admin');
  if (lookupError) throw lookupError;
  if (admins?.length)
    throw new Error('An admin already exists. Bootstrap will not overwrite accounts.');
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const { error: profileError } = await db.from('volunteers').insert({
    id: data.user.id,
    name: name || 'Event administrator',
    username: email!.toLowerCase(),
    role: 'admin',
  });
  if (profileError) {
    await db.auth.admin.deleteUser(data.user.id);
    throw profileError;
  }
  await db
    .from('audit_logs')
    .insert({ actor_id: data.user.id, actor_type: 'system', action: 'admin_bootstrapped' });
  console.log('Admin created. Remove bootstrap credentials from your environment.');
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
