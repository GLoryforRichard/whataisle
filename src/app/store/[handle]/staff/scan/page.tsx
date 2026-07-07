import { getStaffSession } from '@/lib/staff-auth';
import { getStoreByHandle } from '@/lib/store-context';
import { getTranslations } from 'next-intl/server';
import { CameraIcon } from 'lucide-react';
import { redirect } from 'next/navigation';

interface StaffScanPageProps {
  params: Promise<{ handle: string }>;
}

/**
 * Shelf scanning — Phase 2 builds the real flow; this page proves the
 * PIN gate end-to-end.
 */
export default async function StaffScanPage({ params }: StaffScanPageProps) {
  const { handle } = await params;
  const store = await getStoreByHandle(handle);
  if (!store) return null;

  const session = await getStaffSession(store);
  if (!session) {
    redirect('/staff');
  }

  const t = await getTranslations('Store');

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-4 py-16 text-center">
      <CameraIcon className="size-10 text-primary" aria-hidden />
      <h1 className="font-bold text-2xl">{t('staff.scan.title')}</h1>
      <p className="text-muted-foreground">{t('staff.scan.comingSoon')}</p>
    </div>
  );
}
