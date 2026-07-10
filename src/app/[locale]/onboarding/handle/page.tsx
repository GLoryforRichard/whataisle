import { Logo } from '@/components/layout/logo';
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
  const tMeta = await getTranslations('Metadata');

  return (
    <div className="wa-dotted flex min-h-screen flex-col">
      {/* dark-green brand bar */}
      <div className="flex items-center gap-2.5 bg-[var(--brand-green)] px-6 py-3.5">
        <Logo className="size-8" />
        <span className="font-bold text-[var(--brand-cream)] text-lg">
          {tMeta('name')}
        </span>
      </div>

      <div className="flex flex-1 items-center justify-center p-5 sm:p-8">
        <div className="wa-fade-up w-full max-w-lg rounded-[20px] border border-[#EAE3D2] bg-white p-6 text-[var(--brand-ink)] shadow-[0_14px_34px_rgba(15,53,44,0.07)] sm:p-8">
          <div className="text-center">
            <h1 className="font-bold text-2xl text-[var(--brand-ink)]">
              {t('title')}
            </h1>
            <p className="mt-2 text-[#566058]">{t('subtitle')}</p>
          </div>
          <div className="mt-6">
            <HandleForm />
          </div>
        </div>
      </div>
    </div>
  );
}
