import { MapReview } from '@/components/manage/map-review';
import { mappingRepo } from '@/data/mapping-repo';
import { getSession } from '@/lib/server';
import { getStoreByOwner } from '@/lib/store-context';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function ManageMapPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Manage.map');

  const session = await getSession();
  const store = session?.user ? await getStoreByOwner(session.user.id) : null;

  const map = store ? await mappingRepo(store.id).getFloorMap() : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="font-bold text-2xl">{t('title')}</h1>
      <MapReview
        status={map?.status ?? 'missing'}
        mapJson={map?.mapJson ?? null}
      />
    </div>
  );
}
