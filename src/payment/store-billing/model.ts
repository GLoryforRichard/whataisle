export type StorePlan = 'month' | 'year';
export type StoreCurrency = 'usd' | 'cad';
export type BillingStatus = 'pending' | 'active' | 'grace' | 'suspended';

/** Only controlled offer failures are safe to show in a public-facing quote. */
export class StoreOfferError extends Error {}

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
  giftEligible: boolean;
}

/** Public quote deliberately omits the private promotion and Stripe price ID. */
export interface StoreOfferPreview {
  plan: StorePlan;
  currency: StoreCurrency;
  isTest: boolean;
  amount: number;
  bonusMonths: 0 | 2;
  serviceMonths: 1 | 3 | 12 | 14;
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

export function periodMonths(
  plan: StorePlan,
  gift: boolean
): StoreOfferPreview['serviceMonths'] {
  return plan === 'month' ? (gift ? 3 : 1) : gift ? 14 : 12;
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
  existing: OwnerBilling | null,
  hasPriorPayment = false
): BillingOffer {
  if (promoCode && promoCode.length > 96)
    throw new StoreOfferError(
      'Promotion codes must contain at most 96 characters'
    );
  const promos = (promoCode?.trim().toUpperCase() || '')
    .split(/[\s,，+]+/)
    .filter(Boolean);
  if (promos.length > 2)
    throw new StoreOfferError('Apply at most two promotion codes');
  if (new Set(promos).size !== promos.length)
    throw new StoreOfferError('Do not repeat a promotion code');
  const bonusCode = env.STORE_BILLING_BONUS_CODE?.trim().toUpperCase();
  if (
    promos.length &&
    bonusCode &&
    (!/^[A-Z0-9_-]{1,64}$/.test(bonusCode) ||
      ['INCAD', '1CADTEST'].includes(bonusCode))
  )
    throw new StoreOfferError(
      'The offline promotion is not configured correctly'
    );
  if (
    promos.some(
      (promo) =>
        promo !== 'INCAD' && promo !== '1CADTEST' && promo !== bonusCode
    )
  ) {
    throw new StoreOfferError('Unknown promotion code');
  }
  const cadRequested = promos.includes('INCAD');
  const testRequested = promos.includes('1CADTEST');
  const bonusRequested = !!bonusCode && promos.includes(bonusCode);
  if (cadRequested && testRequested)
    throw new StoreOfferError(
      'The currency and test promotion codes cannot be combined'
    );
  // Unpaid drafts may change offers; any paid history keeps its original
  // currency/test identity and permanently prevents claiming a later bonus.
  const committed =
    existing &&
    (existing.status !== 'pending' ||
      existing.lastPaidAt ||
      existing.giftUsedAt)
      ? existing
      : null;
  const isTest = committed?.isTest ?? testRequested;
  if (bonusRequested && (isTest || testRequested))
    throw new StoreOfferError(
      'The test offer cannot be combined with the offline bonus'
    );
  if (
    bonusRequested &&
    (hasPriorPayment || existing?.giftUsedAt || existing?.lastPaidAt)
  )
    throw new StoreOfferError(
      'The offline bonus is only valid before your first successful payment and cannot be claimed again'
    );
  if (isTest) {
    const allowed = (env.STORE_BILLING_TEST_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(email.trim().toLowerCase())) {
      throw new StoreOfferError(
        'This test offer is restricted to designated accounts'
      );
    }
    if (plan !== 'month')
      throw new StoreOfferError('Test subscriptions are monthly only');
  }
  const currency =
    committed?.currency ?? (cadRequested || testRequested ? 'cad' : 'usd');
  if (
    committed &&
    (cadRequested || testRequested) &&
    testRequested !== committed.isTest
  ) {
    throw new StoreOfferError(
      'An existing subscription cannot change its test status'
    );
  }
  if (committed && cadRequested && committed.currency !== 'cad') {
    throw new StoreOfferError(
      'An existing subscription keeps its original currency'
    );
  }
  const amount = isTest ? 100 : plan === 'month' ? 19900 : 199900;
  const envName = isTest
    ? 'STRIPE_PRICE_CAD_TEST_MONTH'
    : `STRIPE_PRICE_${currency.toUpperCase()}_${plan.toUpperCase()}`;
  const priceId = env[envName];
  if (!priceId)
    throw new StoreOfferError(`Billing is not configured: ${envName}`);
  return {
    plan,
    currency,
    isTest,
    amount,
    priceId,
    giftEligible: bonusRequested,
  };
}

export function previewOffer(offer: BillingOffer): StoreOfferPreview {
  return {
    plan: offer.plan,
    currency: offer.currency,
    isTest: offer.isTest,
    amount: offer.amount,
    bonusMonths: offer.giftEligible ? 2 : 0,
    serviceMonths: periodMonths(offer.plan, offer.giftEligible),
  };
}

export function pendingBilling(
  offer: Omit<BillingOffer, 'giftEligible'>,
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
