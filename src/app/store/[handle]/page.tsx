import { getStoreByHandle } from '@/lib/store-context';
import { getLocale, getTranslations } from 'next-intl/server';
import { SearchIcon } from 'lucide-react';

interface ShopperPageProps {
  params: Promise<{ handle: string }>;
}

/**
 * The shopper page (public, no login). Phase 1 placeholder — the three-input
 * search (text / hold-to-talk / photo) lands in Phase 3.
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      {announcement ? (
        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="font-medium text-muted-foreground text-sm">
            {t('shopper.announcementLabel')}
          </p>
          <p className="mt-1">{announcement}</p>
        </div>
      ) : null}

      <h1 className="text-center font-bold text-2xl">
        {t('shopper.greeting')}
      </h1>

      <div className="flex items-center gap-3 rounded-full border bg-muted/30 px-5 py-4 text-muted-foreground">
        <SearchIcon className="size-5 shrink-0" aria-hidden />
        <span>{t('shopper.comingSoon')}</span>
      </div>
    </div>
  );
}
