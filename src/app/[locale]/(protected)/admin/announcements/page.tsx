import { AnnouncementManager } from '@/components/admin/announcement-manager';
import { getDb } from '@/db';
import { announcement } from '@/db/store.schema';
import { desc } from 'drizzle-orm';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Broadcast announcements (requirements §7).
 */
export default async function AdminAnnouncementsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Admin.announcements');

  const db = await getDb();
  const rows = await db
    .select()
    .from(announcement)
    .orderBy(desc(announcement.publishedAt))
    .limit(50);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 lg:px-6">
      <h1 className="font-bold text-2xl">{t('title')}</h1>
      <AnnouncementManager
        announcements={rows.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          publishedAt: a.publishedAt.toISOString(),
        }))}
      />
    </div>
  );
}
