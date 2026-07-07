import { getDb } from '@/db';
import { user } from '@/db/auth.schema';
import { auditLog, store } from '@/db/store.schema';
import { desc, eq } from 'drizzle-orm';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Audit log viewer (requirements §7): every impersonation and sensitive action
 * is recorded and reviewable here.
 */
export default async function AdminAuditPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Admin.audit');

  const db = await getDb();
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      isImpersonation: auditLog.isImpersonation,
      createdAt: auditLog.createdAt,
      actorName: user.name,
      storeName: store.displayName,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.actorUserId, user.id))
    .leftJoin(store, eq(auditLog.storeId, store.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 lg:px-6">
      <h1 className="font-bold text-2xl">{t('title')}</h1>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">{t('when')}</th>
                <th className="py-2 pr-4">{t('who')}</th>
                <th className="py-2 pr-4">{t('action')}</th>
                <th className="py-2">{t('store')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="py-2 pr-4 text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">{r.actorName ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {r.action}
                    {r.isImpersonation ? (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 text-xs dark:bg-amber-950 dark:text-amber-300">
                        {t('impersonation')}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2">{r.storeName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
