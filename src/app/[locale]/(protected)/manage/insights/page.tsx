import { MissList } from '@/components/manage/miss-list';
import { insightsRepo } from '@/data/insights-repo';
import { getSession } from '@/lib/server';
import { getStoreByOwner } from '@/lib/store-context';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Owner insights (requirements §4.3): search success, top searches, and the
 * two "couldn't find" lists. Usage only — never cost or internal metrics.
 */
export default async function ManageInsightsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Manage.insights');

  const session = await getSession();
  const store = session?.user ? await getStoreByOwner(session.user.id) : null;
  if (!store) return null;

  const repo = insightsRepo(store.id);
  const [hitRate, top, misses] = await Promise.all([
    repo.hitRate(7),
    repo.topSearches(7, 10),
    repo.missLists(20),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
      <h1 className="font-bold text-2xl">{t('title')}</h1>

      {/* Search success */}
      <section className="rounded-xl border p-5">
        <p className="text-muted-foreground text-sm">{t('hitRate')}</p>
        <p className="font-bold text-4xl">
          {hitRate.total > 0 ? `${Math.round(hitRate.rate * 100)}%` : '—'}
        </p>
        <p className="text-muted-foreground text-sm">
          {t('searches', { count: hitRate.total })}
        </p>
      </section>

      {/* Top searches */}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg">{t('topSearches')}</h2>
        {top.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noSearches')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {top.map((s) => (
              <li
                key={s.query}
                className="flex items-center justify-between border-b py-2 last:border-0"
              >
                <span className="font-medium">{s.query}</span>
                <span className="text-muted-foreground text-sm">
                  {s.total} · {t('hits', { count: s.hits })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Misses */}
      <section className="flex flex-col gap-4">
        <h2 className="font-semibold text-lg">{t('missesTitle')}</h2>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{t('needsScan')}</p>
          <MissList
            misses={misses.needsScan.map((m) => ({
              id: m.id,
              queryText: m.queryText,
              hitlessCount: m.hitlessCount,
            }))}
          />
        </div>
        {misses.notCarried.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">{t('notCarried')}</p>
            <ul className="flex flex-col gap-1">
              {misses.notCarried.map((m) => (
                <li key={m.id} className="border-b py-2 text-sm last:border-0">
                  {m.queryText}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
