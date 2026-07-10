import { Logo } from '@/components/layout/logo';
import { CheckoutButton } from '@/components/pricing/create-checkout-button';
import { websiteConfig } from '@/config/website';
import { checkPremiumAccess } from '@/lib/premium-access';
import { formatPrice } from '@/lib/formatter';
import { getSession } from '@/lib/server';
import { getStoreByOwner } from '@/lib/store-context';
import { Routes } from '@/routes';
import { CheckIcon } from 'lucide-react';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

interface OnboardingPaymentPageProps {
  params: Promise<{ locale: Locale }>;
}

/**
 * Paywall between store creation and video upload: one $999 one-time plan
 * (the `lifetime` price) unlocks the walkthrough-video pipeline.
 */
export default async function OnboardingPaymentPage({
  params,
}: OnboardingPaymentPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session?.user) {
    redirect(Routes.Login);
  }
  const store = await getStoreByOwner(session.user.id);
  if (!store) {
    redirect('/onboarding/handle');
  }
  if (await checkPremiumAccess(session.user.id)) {
    redirect(Routes.ManageVideo);
  }

  const t = await getTranslations('OnboardingPayment');
  const tMeta = await getTranslations('Metadata');

  const plan = websiteConfig.price.plans.lifetime;
  const price = plan.prices[0];
  const displayPrice = formatPrice(price.amount, price.currency);

  const features = [
    t('features.mapping'),
    t('features.subdomain'),
    t('features.search'),
    t('features.updates'),
  ];

  return (
    <div className="wa-dotted flex min-h-screen flex-col">
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
            <p className="mt-2 text-[#566058]">
              {t('subtitle', { store: store.displayName })}
            </p>
          </div>

          <div className="mt-6 flex items-baseline justify-center gap-2">
            <span className="font-bold text-5xl text-[var(--brand-ink)]">
              {displayPrice}
            </span>
            <span className="text-[#566058]">{t('oneTime')}</span>
          </div>

          <ul className="mt-6 space-y-3">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5">
                <CheckIcon className="mt-0.5 size-5 shrink-0 text-[var(--brand-green)]" />
                <span className="text-[#3d463f] text-sm">{feature}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <CheckoutButton
              userId={session.user.id}
              planId={plan.id}
              priceId={price.priceId}
              callbackUrl={Routes.ManageVideo}
              className="w-full bg-[var(--brand-green)] text-[var(--brand-cream)] hover:bg-[var(--brand-green)]/90"
              size="lg"
            >
              {t('cta', { price: displayPrice })}
            </CheckoutButton>
            <p className="mt-3 text-center text-[#8a938c] text-xs">
              {t('note')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
