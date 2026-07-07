import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { insightsRepo } from '@/data/insights-repo';
import { mappingRepo } from '@/data/mapping-repo';
import { tenantRepo } from '@/data/tenant-repo';
import { LocaleLink } from '@/i18n/navigation';
import { getSession } from '@/lib/server';
import { getStoreByOwner } from '@/lib/store-context';
import { Routes } from '@/routes';
import {
  CameraIcon,
  ChartNoAxesCombinedIcon,
  ExternalLinkIcon,
  FilmIcon,
  QrCodeIcon,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

/**
 * Owner dashboard: the plain-language "data health page" (requirements §7) —
 * store status, memory size, shelf coverage, last scan, search activity.
 * Usage only; never cost or internal technical metrics (§4.3).
 */
export default async function DashboardPage() {
  const [t, locale, session] = await Promise.all([
    getTranslations('Manage.home'),
    getLocale(),
    getSession(),
  ]);
  const td = await getTranslations('Dashboard');

  const store = session?.user ? await getStoreByOwner(session.user.id) : null;

  const breadcrumbs = [{ label: td('dashboard.title'), isCurrentPage: true }];

  if (!store) {
    // Platform admins without a store land here too.
    return (
      <>
        <DashboardHeader breadcrumbs={breadcrumbs} />
        <div className="px-4 py-8 lg:px-6">
          <p className="text-muted-foreground">{t('noStore')}</p>
        </div>
      </>
    );
  }

  const [health, hitRate, shelves, map] = await Promise.all([
    insightsRepo(store.id).health(),
    insightsRepo(store.id).hitRate(7),
    tenantRepo(store.id).listShelves(),
    mappingRepo(store.id).getFloorMap(),
  ]);

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'whataisle.com';
  const port = process.env.NODE_ENV === 'production' ? '' : ':3000';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const storeUrl = `${protocol}://${store.handle}.${rootDomain}${port}`;
  const displayName =
    locale === 'zh' && store.displayNameZh
      ? store.displayNameZh
      : store.displayName;

  const stats = [
    { label: t('products'), value: String(health.productCount) },
    { label: t('shelves'), value: String(shelves.length) },
    { label: t('searches7d'), value: String(hitRate.total) },
    {
      label: t('hitRate'),
      value: hitRate.total > 0 ? `${Math.round(hitRate.rate * 100)}%` : '—',
    },
  ];

  const actions = [
    { icon: CameraIcon, label: t('actionScan'), href: Routes.ManageShelves },
    { icon: QrCodeIcon, label: t('actionPosters'), href: Routes.ManagePosters },
    {
      icon: ChartNoAxesCombinedIcon,
      label: t('actionInsights'),
      href: Routes.ManageInsights,
    },
    { icon: FilmIcon, label: t('actionVideo'), href: Routes.ManageVideo },
  ];

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />

      <div className="flex flex-col gap-6 px-4 py-6 lg:px-6">
        {/* Store card */}
        <section className="rounded-xl border p-5">
          <p className="text-muted-foreground text-sm">{t('storeCard')}</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-bold text-2xl">{displayName}</h1>
            <a
              href={storeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <ExternalLinkIcon className="size-4" />
              {t('visit')}
            </a>
          </div>
          <p className="mt-1 text-muted-foreground">
            {store.handle}.{rootDomain}
          </p>
        </section>

        {/* Data health */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border p-4">
              <p className="text-muted-foreground text-sm">{s.label}</p>
              <p className="mt-1 font-bold text-3xl">{s.value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border p-4">
            <p className="text-muted-foreground text-sm">{t('lastScan')}</p>
            <p className="mt-1 font-medium text-lg">
              {health.lastScan
                ? health.lastScan.toLocaleDateString(
                    locale === 'zh' ? 'zh-CN' : 'en-US',
                    {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }
                  )
                : t('never')}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-muted-foreground text-sm">{t('mapStatus')}</p>
            <p className="mt-1 font-medium text-lg">
              {t(`mapStates.${map?.status ?? 'none'}`)}
            </p>
          </div>
        </section>

        {/* Quick actions */}
        <section>
          <h2 className="mb-3 font-semibold text-lg">{t('quickActions')}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {actions.map((a) => (
              <LocaleLink
                key={a.href}
                href={a.href}
                className="flex flex-col items-center gap-2 rounded-xl border p-5 text-center hover:border-primary hover:bg-accent"
              >
                <a.icon className="size-6 text-primary" aria-hidden />
                <span className="text-sm">{a.label}</span>
              </LocaleLink>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
