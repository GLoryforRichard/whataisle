import { getDb } from '@/db';
import { mappingTicket, store } from '@/db/store.schema';
import { LocaleLink } from '@/i18n/navigation';
import { desc, eq, ne } from 'drizzle-orm';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Platform mapping queue (requirements §7): every store awaiting a map, with
 * status and overdue flags. The map is the platform's first deliverable to
 * each customer, so it can't live in anyone's head.
 */
export default async function AdminMappingPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Manage.adminMapping');

  const db = await getDb();
  const tickets = await db
    .select({
      ticketId: mappingTicket.id,
      status: mappingTicket.status,
      videoId: mappingTicket.videoId,
      createdAt: mappingTicket.createdAt,
      dueAt: mappingTicket.dueAt,
      storeId: store.id,
      storeName: store.displayName,
      handle: store.handle,
    })
    .from(mappingTicket)
    .innerJoin(store, eq(mappingTicket.storeId, store.id))
    .where(ne(mappingTicket.status, 'published'))
    .orderBy(desc(mappingTicket.createdAt));

  const now = Date.now();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 lg:px-6">
      <h1 className="font-bold text-2xl">{t('title')}</h1>

      {tickets.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">{t('store')}</th>
                <th className="py-2 pr-4">{t('status')}</th>
                <th className="py-2 pr-4">{t('created')}</th>
                <th className="py-2">{t('open')}</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((row) => {
                const overdue =
                  row.dueAt && new Date(row.dueAt).getTime() < now;
                return (
                  <tr key={row.ticketId} className="border-b">
                    <td className="py-2 pr-4">
                      <span className="font-medium">{row.storeName}</span>
                      <span className="ml-2 text-muted-foreground">
                        {row.handle}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {t(`statuses.${row.status}`)}
                      {overdue ? (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700 text-xs dark:bg-red-950 dark:text-red-300">
                          {t('overdue')}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2">
                      <LocaleLink
                        href={`/admin/mapping/${row.ticketId}`}
                        className="text-primary underline underline-offset-2"
                      >
                        {t('open')}
                      </LocaleLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
