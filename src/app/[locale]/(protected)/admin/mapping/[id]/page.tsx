import { MappingTool } from '@/components/admin/mapping-tool';
import { getDb } from '@/db';
import {
  floorMap,
  mappingTicket,
  shelf,
  store,
  storeVideo,
} from '@/db/store.schema';
import { LocaleLink } from '@/i18n/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { DownloadIcon } from 'lucide-react';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

interface PageProps {
  params: Promise<{ locale: Locale; id: string }>;
}

/**
 * The mapping tool for one ticket: download the walk-through video and draw
 * the store's floor map, then publish it for owner confirmation (§6).
 */
export default async function AdminMappingToolPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Manage.adminMapping');

  const db = await getDb();
  const rows = await db
    .select({
      ticket: mappingTicket,
      storeId: store.id,
      storeName: store.displayName,
    })
    .from(mappingTicket)
    .innerJoin(store, eq(mappingTicket.storeId, store.id))
    .where(eq(mappingTicket.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) notFound();

  const [existingShelves, video, existingMap] = await Promise.all([
    db
      .select({ code: shelf.code })
      .from(shelf)
      .where(and(eq(shelf.storeId, row.storeId), eq(shelf.status, 'active')))
      .orderBy(asc(shelf.code)),
    row.ticket.videoId
      ? db
          .select()
          .from(storeVideo)
          .where(eq(storeVideo.id, row.ticket.videoId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(floorMap)
      .where(eq(floorMap.storeId, row.storeId))
      .limit(1),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8 lg:px-6">
      <LocaleLink
        href="/admin/mapping"
        className="text-muted-foreground text-sm hover:text-primary"
      >
        ← {t('title')}
      </LocaleLink>

      {video[0]?.storageKey ? (
        <a
          href={`/api/admin/video/${row.ticket.videoId}`}
          className="inline-flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          <DownloadIcon className="size-4" /> {t('download')}
        </a>
      ) : null}

      <MappingTool
        storeId={row.storeId}
        storeName={row.storeName}
        ticketId={row.ticket.id}
        existingCodes={existingShelves.map((s) => s.code)}
        initial={existingMap[0]?.mapJson ?? null}
      />
    </div>
  );
}
