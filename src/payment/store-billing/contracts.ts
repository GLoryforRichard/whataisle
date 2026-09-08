import type { CapacitySnapshot } from './capacity';
import type {
  BillingCheckout,
  BillingOffer,
  BillingOwner,
  OwnerBilling,
  StorePlan,
} from './model';

/** Stripe definitively rejected the create request before making a session.
 * Unlike timeouts, this permits releasing a reserved test place safely. */
export class CheckoutNotCreatedError extends Error {}

export interface BillingInvoice {
  id: string;
  subscriptionId: string;
  checkoutId: string | null;
  ownerUserId: string;
  customerId: string;
  paid: boolean;
  /** A draft or unattempted open invoice is normal settlement, not failure. */
  paymentFailed: boolean;
  initial: boolean;
  currency: string;
  subtotal: number;
  paidAt: Date | null;
  periodStart: Date;
  periodEnd: Date;
  priceId: string;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  subscriptionId: string | null;
  invoice: BillingInvoice | null;
}

export interface SubscriptionSnapshot {
  id: string;
  checkoutId: string | null;
  ownerUserId: string;
  canceled: boolean;
  cancelAtEnd: boolean;
  invoice: BillingInvoice | null;
}

export interface BillingEvent {
  id: string;
  kind: 'checkout' | 'invoice' | 'subscription';
  checkoutId: string | null;
  session?: CheckoutSession;
  invoice?: BillingInvoice;
  subscription?: SubscriptionSnapshot;
}

export interface BillingNotice {
  id: string;
  ownerUserId: string;
  graceEndsAt: Date;
  sentAt: Date | null;
  createdAt: Date;
}

export interface BillingTransaction {
  /** All physical stores, including archived tombstones, and static registry. */
  getCapacitySnapshot(): Promise<CapacitySnapshot>;
  getBilling(ownerId: string): Promise<OwnerBilling | null>;
  getBillingByStore(storeId: string): Promise<OwnerBilling | null>;
  getAllBillings(): Promise<OwnerBilling[]>;
  saveBilling(billing: OwnerBilling): Promise<void>;
  getCheckout(id: string): Promise<BillingCheckout | null>;
  getCheckouts(): Promise<BillingCheckout[]>;
  saveCheckout(checkout: BillingCheckout): Promise<void>;
  hasEvent(id: string): Promise<boolean>;
  saveEvent(id: string): Promise<void>;
  savePayment(
    billing: OwnerBilling,
    invoice: BillingInvoice,
    sessionId: string | null
  ): Promise<void>;
  enqueueNotice(notice: BillingNotice): Promise<void>;
  getNotices(): Promise<BillingNotice[]>;
  markNoticeSent(id: string, at: Date): Promise<void>;
  getOwner(id: string): Promise<BillingOwner | null>;
  isStorePermanentlyClosed(storeId: string): Promise<boolean>;
  hasLegacySubscription(ownerId: string): Promise<boolean>;
}

export interface BillingReader {
  /** MVCC reads do not acquire the commercial mutation lock. */
  getBilling(ownerId: string): Promise<OwnerBilling | null>;
  getBillingByStore(storeId: string): Promise<OwnerBilling | null>;
  hasLegacySubscription(ownerId: string): Promise<boolean>;
}

export interface BillingRepository extends BillingReader {
  /** All implementations serialize concurrent commercial mutations, including
   * reservations. Production uses one advisory transaction lock on the MVP VM. */
  transaction<T>(run: (tx: BillingTransaction) => Promise<T>): Promise<T>;
}

export interface BillingGateway {
  createPortal(billing: OwnerBilling): Promise<string>;
  createCheckout(
    owner: BillingOwner,
    attempt: BillingCheckout,
    customerId: string | null
  ): Promise<CheckoutSession>;
  getCheckout(id: string): Promise<CheckoutSession>;
  expireCheckout(id: string): Promise<CheckoutSession>;
  getCheckoutForSubscription(id: string): Promise<CheckoutSession | null>;
  extendInitialPeriod(
    subscriptionId: string,
    end: Date,
    checkoutId: string
  ): Promise<void>;
  schedulePlan(
    billing: OwnerBilling,
    offer: BillingOffer,
    operationKey: string
  ): Promise<string>;
  setCancelAtEnd(
    billing: OwnerBilling,
    cancel: boolean,
    operationKey: string
  ): Promise<void>;
  stopCollection(billing: OwnerBilling, operationKey: string): Promise<void>;
  getSubscription(id: string): Promise<SubscriptionSnapshot>;
  sendFailureNotice(owner: BillingOwner, notice: BillingNotice): Promise<void>;
}

export interface CheckoutRequest {
  requestId: string;
  plan: StorePlan;
  promoCode?: string;
  locale?: string;
}
