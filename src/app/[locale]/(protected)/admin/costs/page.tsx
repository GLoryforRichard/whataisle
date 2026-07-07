import { costByStore } from '@/data/platform-repo';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Per-store AI cost accounting (requirements §7): exists only in our back
 * office. Abnormal usage flags an anomaly for human intervention — never an
 * automatic cutoff.
 */
export default async function AdminCostsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Admin.costs');
  const rows = await costByStore();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 lg:px-6">
      <h1 className="font-bold text-2xl">{t('title')}</h1>
      <p className="text-muted-foreground text-sm">{t('anomalyNote')}</p>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">{t('store')}</th>
                <th className="py-2 pr-4">{t('calls')}</th>
                <th className="py-2 pr-4">{t('inputTokens')}</th>
                <th className="py-2 pr-4">{t('outputTokens')}</th>
                <th className="py-2">{t('images')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.storeId ?? 'none'} className="border-b">
                  <td className="py-2 pr-4">
                    {r.displayName ?? r.handle ?? '—'}
                    {r.anomaly ? (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700 text-xs dark:bg-red-950 dark:text-red-300">
                        {t('anomaly')}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">{r.calls}</td>
                  <td className="py-2 pr-4">
                    {r.inputTokens.toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">
                    {r.outputTokens.toLocaleString()}
                  </td>
                  <td className="py-2">{r.images}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
