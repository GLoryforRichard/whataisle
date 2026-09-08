export type StorePlan = 'month' | 'year';
export type StoreCurrency = 'usd' | 'cad';
export type BillingStatus = 'pending' | 'active' | 'grace' | 'suspended';

export interface OwnerBilling {
  ownerUserId: string;
  storeId: string | null;
  currency: StoreCurrency;
  plan: StorePlan;
  isTest: boolean;
  status: BillingStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeScheduleId: string | null;
  giftUsedAt: Date | null;
  periodStart: Date | null;
  entitlementEnd: Date | null;
  graceEndsAt: Date | null;
  suspendedAt: Date | null;
  retentionUntil: Date | null;
  cancelAtEnd: boolean;
  pendingPlan: StorePlan | null;
  lastPaidInvoiceId: string | null;
  lastPaidAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingCheckout {
  id: string;
  ownerUserId: string;
  plan: StorePlan;
  currency: StoreCurrency;
  isTest: boolean;
  giftEligible: boolean;
  priceId: string;
  amount: number;
  status: 'reserved' | 'open' | 'paid' | 'expired';
  sessionId: string | null;
  sessionUrl: string | null;
  stripeSubscriptionId: string | null;
  locale: string;
  createdAt: Date;
  expiresAt: Date;
  paidAt: Date | null;
}

export interface BillingOwner {
  id: string;
  email: string;
  name: string;
}

export interface BillingOffer {
  plan: StorePlan;
  currency: StoreCurrency;
  isTest: boolean;
  amount: number;
  priceId: string;
}

export const TEST_CHECKOUT_LIMIT = 3;
export const CHECKOUT_LIFETIME_MS = 31 * 60 * 1000;
export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Calendar arithmetic clips month-end dates, unlike fixed 30-day durations. */
export function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function periodMonths(plan: StorePlan, gift: boolean): number {
  return (plan === 'month' ? 1 : 12) + (gift ? 2 : 0);
}

export function billingAccess(billing: OwnerBilling | null, now: Date) {
  const paidAccess = !!(
    billing?.entitlementEnd && billing.entitlementEnd > now
  );
  const graceAccess = !!(
    billing?.status === 'grace' &&
    billing.graceEndsAt &&
    billing.graceEndsAt > now
  );
  // Stripe can create/finalize a renewal invoice before attempting collection
  // (trials commonly add ~1 hour). Keep automatic renewal continuous while
  // settling, even before a webhook/timer records an actual failed attempt.
  const settlementAccess = !!(
    billing?.status === 'active' &&
    !billing.cancelAtEnd &&
    billing.entitlementEnd &&
    now.getTime() < billing.entitlementEnd.getTime() + GRACE_MS
  );
  const accessAllowed = !!(
    billing &&
    billing.status !== 'pending' &&
    billing.status !== 'suspended' &&
    (paidAccess || graceAccess || settlementAccess)
  );
  return {
    accessAllowed,
    setupAllowed: accessAllowed,
    serviceEndsAt:
      billing?.graceEndsAt ??
      (settlementAccess && !paidAccess
        ? new Date(billing!.entitlementEnd!.getTime() + GRACE_MS)
        : (billing?.entitlementEnd ?? null)),
    suspendedAt: billing?.suspendedAt ?? null,
    retentionUntil: billing?.retentionUntil ?? null,
    cleanupDue: !!(billing?.retentionUntil && billing.retentionUntil <= now),
  };
}

export function resolveOffer(
  plan: StorePlan,
  promoCode: string | undefined,
  email: string,
  env: Record<string, string | undefined>,
  existing: OwnerBilling | null
): BillingOffer {
  const promo = promoCode?.trim().toUpperCase() || '';
  if (promo && promo !== 'INCAD' && promo !== '1CADTEST') {
    throw new Error('Unknown promotion code');
  }
  const isTest = existing?.isTest ?? promo === '1CADTEST';
  if (isTest) {
    const allowed = (env.STORE_BILLING_TEST_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(email.trim().toLowerCase())) {
      throw new Error('This test offer is restricted to designated accounts');
    }
    if (plan !== 'month')
      throw new Error('Test subscriptions are monthly only');
  }
  const currency = existing?.currency ?? (promo ? 'cad' : 'usd');
  if (existing && promo && (promo === '1CADTEST') !== existing.isTest) {
    throw new Error('An existing subscription cannot change its test status');
  }
  if (existing && promo === 'INCAD' && existing.currency !== 'cad') {
    throw new Error('An existing subscription keeps its original currency');
  }
  const amount = isTest ? 100 : plan === 'month' ? 19900 : 199900;
  const envName = isTest
    ? 'STRIPE_PRICE_CAD_TEST_MONTH'
    : `STRIPE_PRICE_${currency.toUpperCase()}_${plan.toUpperCase()}`;
  const priceId = env[envName];
  if (!priceId) throw new Error(`Billing is not configured: ${envName}`);
  return { plan, currency, isTest, amount, priceId };
}

export function pendingBilling(
  offer: BillingOffer,
  ownerId: string,
  now: Date
) {
  return {
    ownerUserId: ownerId,
    storeId: null,
    currency: offer.currency,
    plan: offer.plan,
    isTest: offer.isTest,
    status: 'pending' as const,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeScheduleId: null,
    giftUsedAt: null,
    periodStart: null,
    entitlementEnd: null,
    graceEndsAt: null,
    suspendedAt: null,
    retentionUntil: null,
    cancelAtEnd: false,
    pendingPlan: null,
    lastPaidInvoiceId: null,
    lastPaidAt: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  } satisfies OwnerBilling;
}
