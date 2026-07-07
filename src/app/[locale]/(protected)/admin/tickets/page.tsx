import { TicketList } from '@/components/admin/ticket-list';
import { getDb } from '@/db';
import { store, supportTicket } from '@/db/store.schema';
import { desc, eq } from 'drizzle-orm';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Support tickets (requirements §7): one-tap issue reports from the store side,
 * with store identity and context auto-attached.
 */
export default async function AdminTicketsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Admin.tickets');

  const db = await getDb();
  const rows = await db
    .select({
      id: supportTicket.id,
      subject: supportTicket.subject,
      body: supportTicket.body,
      openedVia: supportTicket.openedVia,
      createdAt: supportTicket.createdAt,
      storeName: store.displayName,
      handle: store.handle,
    })
    .from(supportTicket)
    .innerJoin(store, eq(supportTicket.storeId, store.id))
    .where(eq(supportTicket.status, 'open'))
    .orderBy(desc(supportTicket.createdAt));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 lg:px-6">
      <h1 className="font-bold text-2xl">{t('title')}</h1>
      <TicketList
        tickets={rows.map((r) => ({
          id: r.id,
          subject: r.subject,
          body: r.body,
          store: `${r.storeName} (${r.handle})`,
          via: r.openedVia,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
