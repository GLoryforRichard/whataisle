import { AcceptTermsForm } from '@/components/manage/accept-terms-form';
import { getSession } from '@/lib/server';
import { hasAcceptedCurrentTerms } from '@/lib/terms';
import { Routes } from '@/routes';
import { localeRedirect } from '@/i18n/navigation';
import type { Locale } from 'next-intl';
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';

interface PageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Terms re-confirmation gate (requirements §10). Owners who haven't accepted
 * the current terms version land here (redirected from the protected layout).
 */
export default async function TermsUpdatePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('TermsReconfirm');

  const session = await getSession();
  if (!session?.user) {
    const l = await getLocale();
    localeRedirect({ href: Routes.Login, locale: l });
  }
  if (session?.user && (await hasAcceptedCurrentTerms(session.user.id))) {
    const l = await getLocale();
    localeRedirect({ href: Routes.Dashboard, locale: l });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-12">
      <h1 className="font-bold text-2xl">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
      <AcceptTermsForm />
    </div>
  );
}
