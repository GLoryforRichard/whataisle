import { ShopperSearch } from '@/components/store/shopper-search';
import { getStoreByHandle } from '@/lib/store-context';
import { getLocale, getTranslations } from 'next-intl/server';

interface ShopperPageProps {
  params: Promise<{ handle: string }>;
}

/**
 * The shopper page (public, no login): store brand header + the three-input
 * search (text / hold-to-talk / photo).
 */
export default async function ShopperPage({ params }: ShopperPageProps) {
  const { handle } = await params;
  const [t, locale, store] = await Promise.all([
    getTranslations('Store'),
    getLocale(),
    getStoreByHandle(handle),
  ]);
  if (!store) return null; // layout already rendered the not-found screen

  const announcement =
    locale === 'zh' && store.announcementZh
      ? store.announcementZh
      : store.announcement;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      {announcement ? (
        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="font-medium text-muted-foreground text-sm">
            {t('shopper.announcementLabel')}
          </p>
          <p className="mt-1">{announcement}</p>
        </div>
      ) : null}

      <ShopperSearch />
    </div>
  );
}
