import { ShopperSearch } from '@/components/store/shopper-search';
import { getStoreByHandle } from '@/lib/store-context';
import { MegaphoneIcon } from 'lucide-react';
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
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
      {announcement ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[#EAE3D2] bg-white p-4 shadow-[0_1px_2px_rgba(15,53,44,0.04)]">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-green)]">
            <MegaphoneIcon
              className="size-[18px] text-[var(--brand-lime)]"
              aria-hidden
            />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-[#566058] text-[11px] uppercase tracking-[0.08em]">
              {t('shopper.announcementLabel')}
            </p>
            <p className="mt-0.5 text-[var(--brand-ink)] leading-snug">
              {announcement}
            </p>
          </div>
        </div>
      ) : null}

      <ShopperSearch />
    </div>
  );
}
