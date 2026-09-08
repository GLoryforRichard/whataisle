import { StoreSubscriptionCard } from '@/components/store/store-subscription-card';

/**
 * Billing page, show billing information
 */
export default function BillingPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-8">
        <StoreSubscriptionCard />
      </div>
    </div>
  );
}
