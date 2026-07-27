import { costByStore } from '@/data/platform-repo';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Sub-cent AI spend is the norm early on, and "$0.00" reads as "still broken"
 * on a page whose whole job is proving spend is visible.
 */
function fmtUsd(v: number): string {
  return v >= 0.01 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
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
      <p className="text-muted-foreground text-sm">{t('costNote')}</p>

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
                <th className="py-2 pr-4">{t('images')}</th>
                <th className="py-2 pr-4">{t('scans')}</th>
                <th className="py-2 pr-4">{t('cost')}</th>
                <th className="py-2">{t('costPerScan')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.storeId ?? 'none'} className="border-b">
                  <td className="py-2 pr-4">
                    {/* Key off storeId, not the joined name: ai_usage_log has
                        no FK to store, so a deleted store's rows also arrive
                        with a null displayName and must not be mislabelled as
                        the landing try-out. */}
                    {r.storeId === null
                      ? t('landingTryOut')
                      : (r.displayName ?? r.handle ?? '—')}
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
                  <td className="py-2 pr-4">{r.images}</td>
                  <td className="py-2 pr-4">{r.scans}</td>
                  <td className="py-2 pr-4">
                    {r.totalCostUsd === null ? (
                      '—'
                    ) : (
                      <>
                        <div>{fmtUsd(r.totalCostUsd)}</div>
                        {(r.meteredCostUsd ?? 0) > 0 &&
                        (r.estimatedCostUsd ?? 0) > 0 ? (
                          <div className="text-muted-foreground text-xs">
                            {t('costSplit', {
                              metered: fmtUsd(r.meteredCostUsd ?? 0),
                              estimated: fmtUsd(r.estimatedCostUsd ?? 0),
                            })}
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="py-2">
                    {r.costPerScanUsd === null ? '—' : fmtUsd(r.costPerScanUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
