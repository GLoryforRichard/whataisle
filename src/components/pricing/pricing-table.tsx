'use client';

import { StoreSubscriptionCard } from '@/components/store/store-subscription-card';
import { cn } from '@/lib/utils';
import type { PricePlan } from '@/payment/types';

export function PricingTable({
  className,
}: {
  metadata?: Record<string, string>;
  currentPlan?: PricePlan | null;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-2xl', className)}>
      <StoreSubscriptionCard publicOffer />
    </div>
  );
}
