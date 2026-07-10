import { listTenants } from '@/data/platform-repo';
import { LocaleLink } from '@/i18n/navigation';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Tenant console (requirements §7): one row per store with health, activity,
 * and month AI usage, plus an auto-generated churn-risk list. With a low-priced
 * subscription, retention runs on proactive operations.
 */
export default async function AdminTenantsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Admin.tenants');
  const tenants = await listTenants();
  const atRisk = tenants.filter((x) => x.churnRisk);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 lg:px-6">
      <h1 className="font-bold text-2xl">{t('title')}</h1>

      {/* Churn-risk list */}
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
        <h2 className="mb-2 font-semibold text-amber-900 dark:text-amber-200">
          {t('churnTitle')}
        </h2>
        {atRisk.length === 0 ? (
          <p className="text-amber-900/70 text-sm dark:text-amber-200/70">
            {t('noChurn')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {atRisk.map((x) => (
              <li key={x.storeId} className="text-sm">
                <span className="font-medium">{x.displayName}</span> —{' '}
                {x.churnRisk}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* All tenants */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4">{t('store')}</th>
              <th className="py-2 pr-4">{t('health')}</th>
              <th className="py-2 pr-4">{t('products')}</th>
              <th className="py-2 pr-4">{t('searches')}</th>
              <th className="py-2 pr-4">{t('lastScan')}</th>
              <th className="py-2 pr-4">{t('aiCalls')}</th>
              <th className="py-2">{t('impersonate')}</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((x) => (
              <tr key={x.storeId} className="border-b">
                <td className="py-2 pr-4">
                  <span className="font-medium">{x.displayName}</span>
                  <span className="ml-2 text-muted-foreground">{x.handle}</span>
                </td>
                <td className="py-2 pr-4">
                  <span
                    className={
                      x.health >= 60
                        ? 'text-green-700 dark:text-green-400'
                        : x.health >= 35
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-red-700 dark:text-red-400'
                    }
                  >
                    {x.health}
                  </span>
                </td>
                <td className="py-2 pr-4">{x.productCount}</td>
                <td className="py-2 pr-4">{x.searches7d}</td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {x.lastScan ? x.lastScan.toLocaleDateString() : t('never')}
                </td>
                <td className="py-2 pr-4">{x.aiCallsMonth}</td>
                <td className="py-2">
                  <a
                    href={`/api/admin/impersonate/${x.storeId}`}
                    className="text-primary underline underline-offset-2"
                  >
                    {t('impersonate')}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LocaleLink
        href="/admin/costs"
        className="text-muted-foreground text-sm hover:text-primary"
      >
        → {t('aiCalls')}
      </LocaleLink>
    </div>
  );
}
