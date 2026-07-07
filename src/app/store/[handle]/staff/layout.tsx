import { getStaffSession } from '@/lib/staff-auth';
import { getStoreByHandle } from '@/lib/store-context';
import { getTranslations } from 'next-intl/server';
import type { PropsWithChildren } from 'react';

interface StaffLayoutProps extends PropsWithChildren {
  params: Promise<{ handle: string }>;
}

/**
 * Staff-area layout. Shows an impersonation banner when an admin has entered
 * the store via support impersonation (requirements §7: fully audit-logged,
 * clearly indicated).
 */
export default async function StaffLayout({
  children,
  params,
}: StaffLayoutProps) {
  const { handle } = await params;
  const store = await getStoreByHandle(handle);
  const session = store ? await getStaffSession(store) : null;

  let banner: string | null = null;
  let exitLabel = 'Exit';
  if (session?.isImpersonation && store) {
    const t = await getTranslations('Admin.impersonating');
    banner = t('banner', { store: store.displayName });
    exitLabel = t('exit');
  }

  return (
    <>
      {banner ? (
        <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-amber-950 text-sm">
          <span>{banner}</span>
          <a
            href="/api/store/staff/session?exit=1"
            className="font-semibold underline"
          >
            {exitLabel}
          </a>
        </div>
      ) : null}
      {children}
    </>
  );
}
