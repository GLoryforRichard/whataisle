import { ScanFlow } from '@/components/store/scan-flow';
import { tenantRepo } from '@/data/tenant-repo';
import { getStaffSession } from '@/lib/staff-auth';
import { getStoreByHandle } from '@/lib/store-context';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

interface StaffScanPageProps {
  params: Promise<{ handle: string }>;
}

/**
 * Shelf scanning — the core staff flow (requirements §4.2). Behind the PIN gate.
 */
export default async function StaffScanPage({ params }: StaffScanPageProps) {
  const { handle } = await params;
  const store = await getStoreByHandle(handle);
  if (!store) return null;

  const session = await getStaffSession(store);
  if (!session) {
    redirect('/staff');
  }

  const [t, shelves] = await Promise.all([
    getTranslations('Store.staff.scan'),
    tenantRepo(store.id).listShelves(),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="font-bold text-2xl">{t('title')}</h1>
      <ScanFlow
        shelves={shelves.map((s) => ({
          id: s.id,
          code: s.code,
          label: s.label,
        }))}
      />
    </div>
  );
}
