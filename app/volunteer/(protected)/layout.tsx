import { redirect } from 'next/navigation';
import { staffAuth } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard/shell';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const auth = await staffAuth().catch(() => null);
  if (!auth || auth.staff.role !== 'volunteer') redirect('/volunteer/login');
  return <DashboardShell staff={auth.staff}>{children}</DashboardShell>;
}
