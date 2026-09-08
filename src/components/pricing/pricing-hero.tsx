'use client';

import { StoreSubscriptionCard } from '@/components/store/store-subscription-card';
import { useTranslations } from 'next-intl';

/** One checkout surface owns currency, promotions and the current subscription. */
export function PricingHero() {
  const t = useTranslations('PricingPage');
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
      <div className="grid items-start gap-6 md:grid-cols-[1.2fr_0.8fr]">
        <StoreSubscriptionCard publicOffer />
        <section className="space-y-6 rounded-xl border bg-card p-6">
          <h2 className="font-semibold text-xl">{t('steps.title')}</h2>
          <ol className="space-y-5">
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-accent font-semibold text-accent-foreground">
                  {n}
                </span>
                <div>
                  <h3 className="font-medium">{t(`steps.s${n}t`)}</h3>
                  <p className="mt-1 text-muted-foreground">
                    {t(`steps.s${n}d`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <section className="space-y-5">
        <h2 className="font-semibold text-xl">{t('faq.title')}</h2>
        {([1, 2, 3] as const).map((n) => (
          <details key={n} className="rounded-xl border bg-card p-5">
            <summary className="cursor-pointer font-medium">
              {t(`faq.q${n}`)}
            </summary>
            <p className="mt-3 text-muted-foreground">{t(`faq.a${n}`)}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
