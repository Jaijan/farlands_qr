import { redirect } from 'next/navigation';
import { staffAuth } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard/shell';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const auth = await staffAuth(true).catch(() => null);
  if (!auth) redirect('/admin/login');
  return <DashboardShell staff={auth.staff}>{children}</DashboardShell>;
}
