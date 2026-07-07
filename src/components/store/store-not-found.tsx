import { getTranslations } from 'next-intl/server';

/**
 * Shown for unknown or closed store handles. Every dead link is also an
 * acquisition impression (requirements §4.1), so the one extra line points
 * at the main site.
 */
export async function StoreNotFound() {
  const t = await getTranslations('Store');
  const mainSite =
    process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.whataisle.com';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-bold text-3xl">{t('notFound.title')}</h1>
      <p className="max-w-md text-lg text-muted-foreground">
        {t('notFound.description')}
      </p>
      <a href={mainSite} className="text-primary underline underline-offset-4">
        {t('notFound.cta')}
      </a>
    </div>
  );
}
