import { VideoUpload } from '@/components/manage/video-upload';
import { getDb } from '@/db';
import { storeVideo } from '@/db/store.schema';
import { getSession } from '@/lib/server';
import { getStoreByOwner } from '@/lib/store-context';
import { and, eq } from 'drizzle-orm';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

export default async function ManageVideoPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Manage.video');

  const session = await getSession();
  const store = session?.user ? await getStoreByOwner(session.user.id) : null;

  let hasVideo = false;
  if (store) {
    const db = await getDb();
    const rows = await db
      .select({ id: storeVideo.id })
      .from(storeVideo)
      .where(
        and(eq(storeVideo.storeId, store.id), eq(storeVideo.status, 'received'))
      )
      .limit(1);
    hasVideo = rows.length > 0;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-bold text-2xl text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <VideoUpload hasVideo={hasVideo} />
    </div>
  );
}
