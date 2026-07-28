'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useMounted } from '@/hooks/use-mounted';
import { useLocalePathname } from '@/i18n/navigation';
import { formatPrice } from '@/lib/formatter';
import { cn } from '@/lib/utils';
import {
  type PaymentType,
  PaymentTypes,
  type PlanInterval,
  PlanIntervals,
  type Price,
  type PricePlan,
} from '@/payment/types';
import { CheckCircleIcon, XCircleIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoginWrapper } from '../auth/login-wrapper';
import { Badge } from '../ui/badge';
import { CheckoutButton } from './create-checkout-button';

interface PricingCardProps {
  plan: PricePlan;
  interval?: PlanInterval; // 'month' or 'year'
  paymentType?: PaymentType; // 'subscription' or 'one_time'
  metadata?: Record<string, string>;
  className?: string;
  isCurrentPlan?: boolean;
}

/**
 * Get the appropriate price object for the selected interval and payment type
 * @param plan The price plan
 * @param interval The selected interval (month or year)
 * @param paymentType The payment type (SUBSCRIPTION or one_time)
 * @returns The price object or undefined if not found
 */
function getPriceForPlan(
  plan: PricePlan,
  interval?: PlanInterval,
  paymentType?: PaymentType
): Price | undefined {
  if (plan.isFree) {
    // Free plan has no price
    return undefined;
  }

  // non-free plans must have a price
  return plan.prices.find((price) => {
    if (paymentType === PaymentTypes.ONE_TIME) {
      return price.type === PaymentTypes.ONE_TIME;
    }
    return (
      price.type === PaymentTypes.SUBSCRIPTION && price.interval === interval
    );
  });
}

/**
 * Pricing Card Component
 *
 * Displays a single pricing plan with features and action button
 */
export function PricingCard({
  plan,
  interval,
  paymentType,
  metadata,
  className,
  isCurrentPlan = false,
}: PricingCardProps) {
  const t = useTranslations('PricingPage.PricingCard');
  const price = getPriceForPlan(plan, interval, paymentType);
  const currentUser = useCurrentUser();
  const currentPath = useLocalePathname();
  const mounted = useMounted();
  // console.log('pricing card, currentPath', currentPath);

  // generate formatted price and price label
  let formattedPrice = '';
  let priceLabel = '';
  if (plan.isFree) {
    formattedPrice = t('freePrice');
  } else if (price && price.amount > 0) {
    // price is available
    formattedPrice = formatPrice(price.amount, price.currency);
    if (interval === PlanIntervals.MONTH) {
      priceLabel = t('perMonth');
    } else if (interval === PlanIntervals.YEAR) {
      priceLabel = t('perYear');
    }
  } else {
    formattedPrice = t('notAvailable');
  }

  // check if plan is not free and has a price
  const isPaidPlan = !plan.isFree && !!price;
  // check if plan has a trial period, period is greater than 0
  const hasTrialPeriod = price?.trialPeriodDays && price.trialPeriodDays > 0;

  return (
    <Card
      className={cn(
        'flex flex-col h-full overflow-visible',
        plan.popular && 'relative',
        isCurrentPlan && 'border-primary shadow-lg shadow-primary/10',
        className
      )}
    >
      {/* show popular badge if plan is recommended */}
      {plan.popular && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-10">
          <Badge
            variant="default"
            className="bg-primary text-primary-foreground"
          >
            {t('popular')}
          </Badge>
        </div>
      )}

      {/* show current plan badge if plan is current plan */}
      {isCurrentPlan && (
        <div className="absolute -top-3.5 left-1/2 transform -translate-x-1/2">
          <Badge
            variant="default"
            className="border-[var(--accent-border)] bg-secondary text-secondary-foreground"
          >
            {t('currentPlan')}
          </Badge>
        </div>
      )}

      <CardHeader>
        <CardTitle>
          <h3 className="font-medium">{plan.name}</h3>
        </CardTitle>

        {/* show price and price label */}
        <div className="flex items-baseline gap-2">
          <span className="my-4 block text-4xl font-semibold">
            {formattedPrice}
          </span>
          {priceLabel && <span className="text-2xl">{priceLabel}</span>}
          {plan.isLifetime && (
            <span className="text-lg text-muted-foreground">
              {t('oneTime')}
            </span>
          )}
        </div>

        <CardDescription>
          <p className="text-base">{plan.description}</p>
        </CardDescription>

        {/* show action buttons based on plans */}
        {plan.isFree ? (
          mounted && currentUser ? (
            <Button variant="outline" className="mt-4 w-full disabled">
              {t('getStartedForFree')}
            </Button>
          ) : (
            <LoginWrapper mode="modal" asChild callbackUrl={currentPath}>
              <Button variant="outline" className="mt-4 w-full">
                {t('getStartedForFree')}
              </Button>
            </LoginWrapper>
          )
        ) : isCurrentPlan ? (
          <Button
            disabled
            className="mt-4 w-full border border-[var(--accent-border)] bg-secondary text-secondary-foreground hover:bg-secondary"
          >
            {t('yourCurrentPlan')}
          </Button>
        ) : isPaidPlan ? (
          mounted && currentUser ? (
            <CheckoutButton
              userId={currentUser.id}
              planId={plan.id}
              priceId={price.priceId}
              metadata={metadata}
              className="mt-4 w-full"
            >
              {plan.isLifetime ? t('getLifetimeAccess') : t('getStarted')}
            </CheckoutButton>
          ) : (
            <LoginWrapper mode="modal" asChild callbackUrl={currentPath}>
              <Button variant="default" className="mt-4 w-full">
                {plan.isLifetime ? t('getLifetimeAccess') : t('getStarted')}
              </Button>
            </LoginWrapper>
          )
        ) : (
          <Button disabled className="mt-4 w-full">
            {t('notAvailable')}
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <hr className="border-dashed" />

        {/* show trial period if it exists */}
        {hasTrialPeriod && (
          <div className="my-4">
            <span className="inline-block rounded-md border border-[var(--accent-border)] bg-accent px-2.5 py-1.5 font-medium text-accent-foreground text-xs shadow-sm">
              {t('daysTrial', { days: price.trialPeriodDays as number })}
            </span>
          </div>
        )}

        {/* show features of this plan */}
        <ul className="list-outside space-y-4 text-base">
          {plan.features?.map((feature, i) => (
            <li key={i} className="flex items-center gap-2">
              <CheckCircleIcon className="size-4 shrink-0 text-green-500 dark:text-green-400" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {/* show limits of this plan */}
        <ul className="list-outside space-y-4 text-base">
          {plan.limits?.map((limit, i) => (
            <li key={i} className="flex items-center gap-2">
              <XCircleIcon className="size-4 text-gray-500 dark:text-gray-400" />
              <span>{limit}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
