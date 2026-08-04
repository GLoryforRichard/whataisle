'use client';

import { LoginWrapper } from '@/components/auth/login-wrapper';
import { BearFace } from '@/components/layout/bear-face';
import { CheckoutButton } from '@/components/pricing/create-checkout-button';
import { Button } from '@/components/ui/button';
import { usePricePlans } from '@/config/price-config';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useMounted } from '@/hooks/use-mounted';
import { useLocalePathname } from '@/i18n/navigation';
import { formatPrice } from '@/lib/formatter';
import { PaymentTypes, PlanIntervals } from '@/payment/types';
import {
  CalendarX2Icon,
  CheckCircle2Icon,
  GiftIcon,
  LanguagesIcon,
  WrenchIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * Bespoke single-plan pricing layout (sticker/ink design language). The
 * generic PricingTable renders N cards in a grid; with exactly one live plan
 * that reads as a lost card on an empty page, so /pricing composes the plan
 * into a two-column hero (price + what's included | how it starts + CTA),
 * three reassurance tiles, and a short pricing FAQ instead.
 */
export function PricingHero() {
  const t = useTranslations('PricingPage');
  const plans = usePricePlans();
  const plan = plans.monthly;
  const monthlyPrice = plan?.prices.find(
    (p) =>
      p.type === PaymentTypes.SUBSCRIPTION && p.interval === PlanIntervals.MONTH
  );
  const yearlyPrice = plan?.prices.find(
    (p) =>
      p.type === PaymentTypes.SUBSCRIPTION && p.interval === PlanIntervals.YEAR
  );
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const currentUser = useCurrentUser();
  const currentPath = useLocalePathname();
  const mounted = useMounted();

  if (!plan || !monthlyPrice) return null;
  const isYear = interval === 'year' && !!yearlyPrice;
  const price = isYear && yearlyPrice ? yearlyPrice : monthlyPrice;

  const ctaClassName =
    'h-12 w-full rounded-xl border-2 border-foreground bg-[var(--cta-bg)] font-bold text-[var(--cta-fg)] text-base shadow-[4px_4px_0_#111] transition-transform hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[3px_3px_0_#111] hover:bg-[var(--cta-hover-bg)]';

  const steps = [1, 2, 3] as const;
  const tiles = [
    { icon: WrenchIcon, title: t('tiles.t1'), desc: t('tiles.d1') },
    { icon: CalendarX2Icon, title: t('tiles.t2'), desc: t('tiles.d2') },
    { icon: LanguagesIcon, title: t('tiles.t3'), desc: t('tiles.d3') },
  ];
  const faqs = [1, 2, 3] as const;

  return (
    <div className="flex flex-col gap-14">
      {/* ── Billing interval toggle ── */}
      {yearlyPrice && (
        <div className="-mb-4 flex flex-col items-center gap-2">
          <div className="inline-flex rounded-full border-2 border-foreground bg-card p-1 shadow-[3px_3px_0_#111]">
            {(['month', 'year'] as const).map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setInterval(iv)}
                className={
                  interval === iv
                    ? 'rounded-full bg-[var(--cta-bg)] px-5 py-1.5 font-bold text-[var(--cta-fg)] text-sm'
                    : 'rounded-full px-5 py-1.5 font-semibold text-muted-foreground text-sm'
                }
              >
                {iv === 'month' ? t('monthly') : t('yearly')}
              </button>
            ))}
          </div>
          {!isYear && (
            <button
              type="button"
              onClick={() => setInterval('year')}
              className="font-semibold text-[var(--chip-fg)] text-sm underline decoration-dotted underline-offset-4"
            >
              {t('annual.hint')}
            </button>
          )}
        </div>
      )}

      {/* ── Main plan card ── */}
      <div className="relative mx-auto w-full max-w-4xl">
        {/* Mascot peeking over the card edge, like the home try-scan panel. */}
        <div
          className="-top-9 absolute right-10 hidden size-[72px] items-center justify-center overflow-hidden rounded-full border-2 border-foreground bg-card shadow-[3px_3px_0_#111] sm:flex"
          aria-hidden
        >
          <BearFace size={64} />
        </div>

        <div className="overflow-hidden rounded-3xl border-2 border-foreground bg-card shadow-[6px_6px_0_#111]">
          <div className="grid md:grid-cols-[1.1fr_0.9fr]">
            {/* Left: plan, price, what's included */}
            <div className="flex flex-col gap-6 p-7 sm:p-10">
              <span className="inline-flex w-fit items-center rounded-full border border-[var(--chip-border)] bg-[var(--chip-bg)] px-3.5 py-1.5 font-semibold text-[var(--chip-fg)] text-sm">
                {plan.name}
              </span>

              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-extrabold text-6xl tracking-tight">
                  {formatPrice(price.amount, price.currency)}
                </span>
                <span className="font-semibold text-2xl text-muted-foreground">
                  {isYear
                    ? t('PricingCard.perYear')
                    : t('PricingCard.perMonth')}
                </span>
                {isYear && (
                  <span className="ml-1 inline-flex items-center rounded-full border-2 border-foreground bg-[var(--cta-bg)] px-3 py-1 font-bold text-[var(--cta-fg)] text-xs shadow-[2px_2px_0_#111]">
                    {t('annual.save')}
                  </span>
                )}
              </div>

              <p className="text-base text-muted-foreground">
                {plan.description}
              </p>

              <hr className="border-foreground/20 border-dashed" />

              <ul className="space-y-3.5 text-base">
                {plan.features?.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <CheckCircle2Icon
                      className="mt-0.5 size-5 shrink-0 text-green-600"
                      aria-hidden
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {isYear && (
                <div className="rounded-2xl border-2 border-foreground border-dashed bg-[var(--accent-tint)] p-4">
                  <div className="flex items-center gap-2 font-bold">
                    <GiftIcon
                      className="size-4.5 text-[var(--chip-fg)]"
                      aria-hidden
                    />
                    {t('annual.promoTitle')}
                  </div>
                  <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                    {t('annual.promoDesc')}
                  </p>
                </div>
              )}
            </div>

            {/* Right: how it starts + CTA */}
            <div className="flex flex-col gap-6 border-foreground border-t-2 bg-[var(--brand-softer)] p-7 sm:p-10 md:border-t-0 md:border-l-2">
              <h3 className="font-bold text-lg">{t('steps.title')}</h3>

              <ol className="flex flex-col gap-5">
                {steps.map((n) => (
                  <li key={n} className="flex items-start gap-3.5">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-foreground bg-card font-bold text-sm shadow-[2px_2px_0_#111]"
                      aria-hidden
                    >
                      {n}
                    </span>
                    <div>
                      <div className="font-semibold">{t(`steps.s${n}t`)}</div>
                      <div className="text-muted-foreground text-sm">
                        {t(`steps.s${n}d`)}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-auto flex flex-col gap-3 pt-2">
                {mounted && currentUser ? (
                  <CheckoutButton
                    userId={currentUser.id}
                    planId={plan.id}
                    priceId={price.priceId}
                    className={ctaClassName}
                  >
                    {t('PricingCard.getStarted')}
                  </CheckoutButton>
                ) : (
                  <LoginWrapper mode="modal" asChild callbackUrl={currentPath}>
                    <Button className={ctaClassName}>
                      {t('PricingCard.getStarted')}
                    </Button>
                  </LoginWrapper>
                )}
                <p className="text-center text-muted-foreground text-xs">
                  {t('finePrint')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Reassurance tiles ── */}
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
        {tiles.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="flex flex-col items-start gap-2 rounded-2xl border-2 border-foreground bg-card p-5 shadow-[3px_3px_0_#111]"
          >
            <span className="flex size-9 items-center justify-center rounded-xl border border-[var(--chip-border)] bg-[var(--chip-bg)] text-[var(--chip-fg)]">
              <Icon className="size-4.5" aria-hidden />
            </span>
            <div className="font-bold">{title}</div>
            <div className="text-muted-foreground text-sm">{desc}</div>
          </div>
        ))}
      </div>

      {/* ── Pricing FAQ ── */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <h2 className="text-center font-bold text-2xl tracking-tight">
          {t('faq.title')}
        </h2>
        {faqs.map((n) => (
          <div
            key={n}
            className="rounded-2xl border-2 border-foreground bg-card p-5 sm:p-6"
          >
            <div className="font-bold">{t(`faq.q${n}`)}</div>
            <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
              {t(`faq.a${n}`)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
