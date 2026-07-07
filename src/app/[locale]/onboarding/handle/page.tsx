import { HandleForm } from '@/components/onboarding/handle-form';
import { getSession } from '@/lib/server';
import { getStoreByOwner } from '@/lib/store-context';
import { Routes } from '@/routes';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

interface OnboardingPageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Store handle selection — the one irreversible choice in the product
 * (requirements §4.1), so it gets its own dedicated screen with a
 * permanence warning and a second confirmation.
 */
export default async function OnboardingHandlePage({
  params,
}: OnboardingPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session?.user) {
    redirect(Routes.Login);
  }
  if (!session.user.emailVerified) {
    redirect(`${Routes.Login}?error=email_not_verified`);
  }

  const existing = await getStoreByOwner(session.user.id);
  if (existing) {
    redirect(Routes.Dashboard);
  }

  const t = await getTranslations('Onboarding');

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-4 py-12">
      <div className="text-center">
        <h1 className="font-bold text-3xl">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
      </div>
      <HandleForm />
    </div>
  );
}
