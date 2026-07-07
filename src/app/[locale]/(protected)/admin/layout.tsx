import { getSession } from '@/lib/server';
import { Routes } from '@/routes';
import { redirect } from 'next/navigation';
import type { PropsWithChildren } from 'react';

/**
 * Back-office guard: every /admin/* page is founder-only. The protected layout
 * already validated the session; here we additionally require the admin role.
 * Server-side data on these pages spans tenants, so this gate is load-bearing.
 */
export default async function AdminLayout({ children }: PropsWithChildren) {
  const session = await getSession();
  if (session?.user?.role !== 'admin') {
    redirect(Routes.Dashboard);
  }
  return <>{children}</>;
}
