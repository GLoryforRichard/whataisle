import { CloseStore } from '@/components/manage/close-store';
import { getSession } from '@/lib/server';
import { getStoreByOwner } from '@/lib/store-context';
import { DownloadIcon } from 'lucide-react';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Data ownership page (requirements §7): export anytime, and the closure flow
 * that steers the owner to export first before permanent deletion.
 */
export default async function ManageDataPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [tE, tC] = await Promise.all([
    getTranslations('Manage.export'),
    getTranslations('Manage.close'),
  ]);

  const session = await getSession();
  const store = session?.user ? await getStoreByOwner(session.user.id) : null;
  if (!store) return null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-8">
      <section className="flex flex-col gap-3">
        <h1 className="font-bold text-2xl">{tE('title')}</h1>
        <p className="text-muted-foreground">{tE('intro')}</p>
        <p className="text-muted-foreground text-sm">{tE('includes')}</p>
        <a
          href="/api/owner/export"
          className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
        >
          <DownloadIcon className="size-4" /> {tE('download')}
        </a>
      </section>

      <section className="flex flex-col gap-4 border-t pt-8">
        <h2 className="font-bold text-xl">{tC('title')}</h2>
        <p className="text-muted-foreground">
          {tC('exportFirst')} —{' '}
          <a href="/api/owner/export" className="text-primary underline">
            {tC('exportCta')}
          </a>
        </p>
        <CloseStore storeName={store.displayName} />
      </section>
    </div>
  );
}
