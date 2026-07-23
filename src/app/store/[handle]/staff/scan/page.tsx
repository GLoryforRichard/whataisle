import { ScanFlow } from '@/components/store/scan-flow';
import { tenantRepo } from '@/data/tenant-repo';
import type { FloorMapJson } from '@/db/store.schema';
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

  const repo = tenantRepo(store.id);
  const [t, shelves, map] = await Promise.all([
    getTranslations('Store.staff.scan'),
    repo.listShelves(),
    repo.getFloorMap(),
  ]);
  const mapJson: FloorMapJson | null =
    map && map.status === 'published' ? (map.mapJson ?? null) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="font-bold text-2xl">{t('title')}</h1>
      <ScanFlow
        shelves={shelves.map((s) => ({
          id: s.id,
          code: s.code,
          label: s.label,
        }))}
        mapJson={mapJson}
      />
    </div>
  );
}
