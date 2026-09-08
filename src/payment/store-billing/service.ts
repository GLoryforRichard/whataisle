import { storeCapacityForOwner } from './capacity';
import type {
  BillingEvent,
  BillingGateway,
  BillingInvoice,
  BillingRepository,
  BillingTransaction,
  CheckoutRequest,
  CheckoutSession,
} from './contracts';
import { CheckoutNotCreatedError } from './contracts';
import {
  CHECKOUT_LIFETIME_MS,
  GRACE_MS,
  TEST_CHECKOUT_LIMIT,
  type BillingCheckout,
  type BillingOwner,
  type OwnerBilling,
  type StorePlan,
  addCalendarMonths,
  billingAccess,
  pendingBilling,
  periodMonths,
  resolveOffer,
} from './model';

/** The service owns business transitions; neither browser input nor webhook
 * delivery order determines whether a store has paid. Stripe reads are fresh,
 * writes carry stable operation keys, and local event acknowledgement commits
 * in the same transaction as the entitlement it grants. */
export class StoreBillingService {
  constructor(
    private readonly repository: BillingRepository,
    private readonly gateway: BillingGateway,
    private readonly env: Record<string, string | undefined>,
    private readonly now: () => Date = () => new Date()
  ) {}

  getOwnerBilling(ownerId: string) {
    return this.repository.getBilling(ownerId);
  }

  async getStoreServiceAccess(storeId: string) {
    return billingAccess(
      await this.repository.getBillingByStore(storeId),
      this.now()
    );
  }

  async createPortal(ownerId: string) {
    const billing = await this.repository.getBilling(ownerId);
    if (!billing) throw new Error('No subscription is linked to this account');
    return this.gateway.createPortal(billing);
  }

  async attachStore(ownerId: string, storeId: string) {
    return this.repository.transaction(async (tx) => {
      const billing = await this.requireBilling(tx, ownerId);
      if (!billingAccess(billing, this.now()).setupAllowed) {
        throw new Error(
          'A successful current payment is required to create a store'
        );
      }
      if (billing.storeId && billing.storeId !== storeId) {
        throw new Error('This subscription already belongs to another store');
      }
      billing.storeId = storeId;
      await this.save(tx, billing);
    });
  }

  async createCheckout(owner: BillingOwner, request: CheckoutRequest) {
    // Persist stable parameters before any external side effect. A process
    // crash after Stripe accepted the request can safely replay the same key.
    const attemptId = await this.repository.transaction(async (tx) => {
      let billing = await tx.getBilling(owner.id);
      if (!billing?.lastPaidAt && (await tx.hasLegacySubscription(owner.id)))
        throw new Error(
          'This account already has a legacy subscription; manage the existing subscription before purchasing again'
        );
      await this.reapCheckouts(tx);
      billing = await tx.getBilling(owner.id);
      if (
        billing?.storeId &&
        (await tx.isStorePermanentlyClosed(billing.storeId))
      ) {
        throw new Error(
          'Store cleanup has started; contact support before purchasing again'
        );
      }
      if (billing) {
        await this.reconcileOne(tx, billing);
        billing = await tx.getBilling(owner.id);
      }
      if (
        billing &&
        billing.status !== 'pending' &&
        billing.status !== 'suspended'
      ) {
        throw new Error('This account already has a current subscription');
      }
      const prior = await tx.getCheckout(request.requestId);
      if (prior && prior.ownerUserId !== owner.id) {
        throw new Error('Checkout request belongs to another account');
      }
      if (prior?.status === 'paid')
        throw new Error('This checkout is already paid');
      if (prior?.status === 'expired')
        throw new Error('This checkout has expired; start a new checkout');
      const checkouts = await tx.getCheckouts();
      const current = checkouts.find(
        (item) =>
          item.ownerUserId === owner.id &&
          (item.status === 'open' || item.status === 'reserved')
      );
      const offer = resolveOffer(
        request.plan,
        request.promoCode,
        owner.email,
        this.env,
        billing?.status === 'pending' ? null : billing
      );
      // Refreshes reuse the same payable session. An explicit offer change
      // first expires the previous one so only one of them can ever be paid.
      if (current) {
        if (current.priceId === offer.priceId) return current.id;
        if (current.id === request.requestId)
          throw new Error(
            'Use a new checkout request when changing the selected offer'
          );
        if (!current.sessionId)
          throw new Error('Previous checkout creation is still pending');
        const expired = await this.gateway.expireCheckout(current.sessionId);
        if (expired.status !== 'expired')
          throw new Error(
            'Previous checkout has completed or is still payable; refresh billing before continuing'
          );
        current.status = 'expired';
        await tx.saveCheckout(current);
      }
      if (
        offer.isTest &&
        checkouts.filter(
          (item) =>
            item.isTest && item.status !== 'expired' && item.id !== current?.id
        ).length >= TEST_CHECKOUT_LIMIT
      ) {
        throw new Error(
          'All three test subscription places are already used or reserved'
        );
      }
      const capacitySnapshot = await tx.getCapacitySnapshot();
      if (
        capacitySnapshot.stores.some(
          (store) =>
            store.ownerUserId === owner.id &&
            (store.status === 'closing' || store.status === 'closed')
        )
      )
        throw new Error(
          'Store cleanup has started; contact support before purchasing again'
        );
      const capacity = storeCapacityForOwner(
        capacitySnapshot,
        await tx.getAllBillings(),
        checkouts,
        owner.id
      );
      if (!capacity.ownerHasSlot && capacity.used >= capacity.limit)
        throw new Error(
          'All five store places are occupied or reserved. No payment was started; please contact support / 五家店的名额已占用或预留，尚未发起付款，请联系支持'
        );
      const now = this.now();
      if (!billing) {
        billing = pendingBilling(offer, owner.id, now);
        await tx.saveBilling(billing);
      }
      const attempt: BillingCheckout = {
        id: request.requestId,
        ownerUserId: owner.id,
        ...offer,
        giftEligible:
          !offer.isTest && !billing.giftUsedAt && !billing.lastPaidAt,
        status: 'reserved',
        sessionId: null,
        sessionUrl: null,
        stripeSubscriptionId: null,
        locale: request.locale === 'zh' ? 'zh' : 'en',
        createdAt: now,
        expiresAt: new Date(now.getTime() + CHECKOUT_LIFETIME_MS),
        paidAt: null,
      };
      await tx.saveCheckout(attempt);
      return attempt.id;
    });

    const result = await this.repository.transaction(async (tx) => {
      const attempt = await tx.getCheckout(attemptId);
      if (!attempt) throw new Error('Checkout reservation was not found');
      if (attempt.status === 'paid' || attempt.status === 'expired') {
        throw new Error('This checkout is no longer available');
      }
      if (attempt.sessionId && attempt.sessionUrl) {
        return { url: attempt.sessionUrl, sessionId: attempt.sessionId };
      }
      const billing = await this.requireBilling(tx, owner.id);
      let session: CheckoutSession;
      try {
        session = await this.gateway.createCheckout(
          owner,
          attempt,
          billing.stripeCustomerId
        );
      } catch (error) {
        if (!(error instanceof CheckoutNotCreatedError)) throw error;
        // Commit a definitive rejection before surfacing it to the caller.
        // Throwing inside this transaction would keep the reservation alive.
        attempt.status = 'expired';
        await tx.saveCheckout(attempt);
        return { error: error.message };
      }
      if (!session.url) throw new Error('Stripe did not return a checkout URL');
      attempt.sessionId = session.id;
      attempt.sessionUrl = session.url;
      attempt.status = 'open';
      await tx.saveCheckout(attempt);
      return { url: session.url, sessionId: session.id };
    });
    if ('error' in result) throw new CheckoutNotCreatedError(result.error);
    return result;
  }

  async schedulePlan(ownerId: string, plan: StorePlan) {
    return this.repository.transaction(async (tx) => {
      const billing = await this.requireBilling(tx, ownerId);
      if (
        billing.status !== 'active' ||
        !billing.entitlementEnd ||
        billing.entitlementEnd <= this.now()
      ) {
        throw new Error(
          'A current paid subscription is required to schedule a plan change'
        );
      }
      if (billing.isTest)
        throw new Error('Test subscriptions stay on the CAD 1 monthly plan');
      if (billing.cancelAtEnd)
        throw new Error('Resume renewal before scheduling a plan change');
      const owner = await tx.getOwner(ownerId);
      if (!owner) throw new Error('Account was not found');
      const offer = resolveOffer(
        plan,
        undefined,
        owner.email,
        this.env,
        billing
      );
      if (billing.pendingPlan === plan) return billing;
      if (billing.plan === plan && !billing.pendingPlan) return billing;
      const key = `wa-plan:${ownerId}:${billing.version + 1}`;
      billing.stripeScheduleId = await this.gateway.schedulePlan(
        billing,
        offer,
        key
      );
      billing.pendingPlan = plan === billing.plan ? null : plan;
      await this.save(tx, billing);
      return billing;
    });
  }

  async cancelRenewal(ownerId: string) {
    return this.setRenewal(ownerId, false);
  }

  async resumeRenewal(ownerId: string) {
    return this.setRenewal(ownerId, true);
  }

  private async setRenewal(ownerId: string, enabled: boolean) {
    return this.repository.transaction(async (tx) => {
      const billing = await this.requireBilling(tx, ownerId);
      if (billing.status === 'pending' || billing.status === 'suspended') {
        throw new Error('Open a new checkout to restart service');
      }
      if (
        enabled &&
        (!billing.entitlementEnd || billing.entitlementEnd <= this.now())
      ) {
        throw new Error(
          'The paid service period has ended; use checkout to restart'
        );
      }
      if (billing.cancelAtEnd === !enabled && !billing.pendingPlan)
        return billing;
      await this.gateway.setCancelAtEnd(
        billing,
        !enabled,
        `wa-renew:${ownerId}:${billing.version + 1}`
      );
      billing.cancelAtEnd = !enabled;
      billing.pendingPlan = null;
      billing.stripeScheduleId = null;
      await this.save(tx, billing);
      // No refund and no entitlement shortening, including paid introductory
      // access represented by a Stripe trial ending in three/fourteen months.
      return billing;
    });
  }

  async handleEvent(event: BillingEvent) {
    return this.repository.transaction(async (tx) => {
      if (await tx.hasEvent(event.id)) return;
      const attempt = event.checkoutId
        ? await tx.getCheckout(event.checkoutId)
        : null;
      if (event.checkoutId && !attempt) {
        throw new Error(
          'Checkout reservation is missing; retry webhook delivery'
        );
      }
      if (event.session && attempt) {
        attempt.sessionId = event.session.id;
        if (event.session.status === 'expired' && attempt.status !== 'paid') {
          attempt.status = 'expired';
        }
        await tx.saveCheckout(attempt);
        if (event.session.invoice?.paid)
          await this.applyInvoice(tx, event.session.invoice, attempt);
      }
      if (event.invoice) await this.applyInvoice(tx, event.invoice, attempt);
      if (event.subscription) {
        const snapshot = event.subscription;
        if (snapshot.invoice)
          await this.applyInvoice(tx, snapshot.invoice, attempt);
        const billing = await tx.getBilling(snapshot.ownerUserId);
        if (
          billing?.stripeSubscriptionId === snapshot.id &&
          (snapshot.cancelAtEnd || snapshot.canceled) &&
          billing.status !== 'grace'
        ) {
          billing.cancelAtEnd = true;
          billing.pendingPlan = null;
          await this.save(tx, billing);
        }
      }
      await tx.saveEvent(event.id);
    });
  }

  /** Called by the authenticated maintenance endpoint on a timer. Also used
   * before reopening checkout so an old subscription can never keep collecting. */
  async reconcile() {
    const result = await this.repository.transaction(async (tx) => {
      await this.reapCheckouts(tx);
      const billings = await tx.getAllBillings();
      for (const billing of billings) await this.reconcileOne(tx, billing);
      return { inspected: billings.length };
    });
    // The outbox is separately committed. Mail failure cannot roll back an
    // entitlement or turn a successfully handled Stripe event into a replay.
    await this.repository.transaction(async (tx) => {
      for (const notice of await tx.getNotices()) {
        const owner = await tx.getOwner(notice.ownerUserId);
        if (!owner) continue;
        await this.gateway.sendFailureNotice(owner, notice);
        await tx.markNoticeSent(notice.id, this.now());
      }
    });
    return result;
  }

  private async reapCheckouts(tx: BillingTransaction) {
    for (const attempt of await tx.getCheckouts()) {
      if (attempt.status === 'paid' || attempt.status === 'expired') continue;
      if (!attempt.sessionId) {
        // An ambiguous Stripe create result cannot simply release capacity.
        // Replay the persisted idempotent request first, including after a crash.
        const owner = await tx.getOwner(attempt.ownerUserId);
        if (!owner) continue;
        const billing = await this.requireBilling(tx, owner.id);
        let session: CheckoutSession;
        try {
          session = await this.gateway.createCheckout(
            owner,
            attempt,
            billing.stripeCustomerId
          );
        } catch (error) {
          if (!(error instanceof CheckoutNotCreatedError)) throw error;
          attempt.status = 'expired';
          await tx.saveCheckout(attempt);
          continue;
        }
        attempt.sessionId = session.id;
        attempt.sessionUrl = session.url;
        attempt.status = 'open';
        await tx.saveCheckout(attempt);
      }
      const session = await this.gateway.getCheckout(attempt.sessionId);
      if (session.invoice?.paid) {
        await this.applyInvoice(tx, session.invoice, attempt);
      } else if (session.status === 'expired') {
        attempt.status = 'expired';
        await tx.saveCheckout(attempt);
      }
    }
  }

  private async applyInvoice(
    tx: BillingTransaction,
    invoice: BillingInvoice,
    attempt: BillingCheckout | null
  ) {
    const billing = await tx.getBilling(invoice.ownerUserId);
    if (!billing) throw new Error('The invoice account is missing');
    if (invoice.initial) {
      if (!attempt)
        throw new Error('The initial checkout reservation is missing');
      if (attempt.ownerUserId !== invoice.ownerUserId)
        throw new Error('Invoice account mismatch');
      if (attempt.status === 'paid') return;
      if (!invoice.paid || !invoice.paidAt) return;
      if (
        invoice.currency !== attempt.currency ||
        invoice.subtotal !== attempt.amount ||
        invoice.priceId !== attempt.priceId
      ) {
        throw new Error(
          'Paid invoice does not match the approved checkout offer'
        );
      }
      if (
        billing.stripeSubscriptionId &&
        billing.stripeSubscriptionId !== invoice.subscriptionId &&
        billing.status !== 'suspended' &&
        billing.status !== 'pending'
      ) {
        throw new Error(
          'Another active subscription already exists for this account'
        );
      }
      const gift =
        attempt.giftEligible && !billing.giftUsedAt && !billing.lastPaidAt;
      const end = addCalendarMonths(
        invoice.paidAt,
        periodMonths(attempt.plan, gift)
      );
      await this.gateway.extendInitialPeriod(
        invoice.subscriptionId,
        end,
        attempt.id
      );
      // Billing identity and the consumed introductory offer survive suspension
      // and store data cleanup. Recovery never resets either field.
      Object.assign(billing, {
        plan: attempt.plan,
        currency: attempt.currency,
        isTest: attempt.isTest,
        stripeCustomerId: invoice.customerId,
        stripeSubscriptionId: invoice.subscriptionId,
        stripeScheduleId: null,
        status: 'active',
        periodStart: invoice.paidAt,
        entitlementEnd: end,
        graceEndsAt: null,
        suspendedAt: null,
        retentionUntil: null,
        cancelAtEnd: false,
        pendingPlan: null,
        giftUsedAt: gift ? invoice.paidAt : billing.giftUsedAt,
        lastPaidAt: invoice.paidAt,
        lastPaidInvoiceId: invoice.id,
      });
      attempt.status = 'paid';
      attempt.paidAt = invoice.paidAt;
      attempt.stripeSubscriptionId = invoice.subscriptionId;
      if (!attempt.sessionId) {
        const session = await this.gateway.getCheckoutForSubscription(
          invoice.subscriptionId
        );
        attempt.sessionId = session?.id ?? null;
      }
      await tx.saveCheckout(attempt);
      await this.save(tx, billing);
      await tx.savePayment(billing, invoice, attempt.sessionId);
      return;
    }
    if (
      billing.stripeSubscriptionId !== invoice.subscriptionId ||
      billing.status === 'suspended'
    )
      return;
    if (invoice.currency !== billing.currency)
      throw new Error('Renewal currency mismatch');
    if (invoice.paid && invoice.paidAt) {
      if (billing.entitlementEnd && invoice.periodEnd <= billing.entitlementEnd)
        return;
      const owner = await tx.getOwner(billing.ownerUserId);
      if (!owner) throw new Error('Account was not found');
      const candidatePlans: StorePlan[] = billing.isTest
        ? ['month']
        : ['month', 'year'];
      const paidPlan = candidatePlans.find(
        (plan) =>
          resolveOffer(plan, undefined, owner.email, this.env, billing)
            .priceId === invoice.priceId
      );
      if (!paidPlan) throw new Error('Renewal price is not approved');
      const renewalOffer = resolveOffer(
        paidPlan,
        undefined,
        owner.email,
        this.env,
        billing
      );
      if (invoice.subtotal !== renewalOffer.amount)
        throw new Error('Renewal amount does not match the approved offer');
      billing.plan = paidPlan;
      billing.status = 'active';
      billing.periodStart = invoice.periodStart;
      billing.entitlementEnd = invoice.periodEnd;
      billing.graceEndsAt = null;
      billing.lastPaidInvoiceId = invoice.id;
      billing.lastPaidAt = invoice.paidAt;
      if (billing.pendingPlan === paidPlan) billing.pendingPlan = null;
      await this.save(tx, billing);
      await tx.savePayment(billing, invoice, attempt?.sessionId ?? null);
    } else if (
      invoice.paymentFailed &&
      billing.entitlementEnd &&
      invoice.periodEnd > billing.entitlementEnd &&
      !billing.cancelAtEnd &&
      billing.status !== 'grace'
    ) {
      billing.status = 'grace';
      billing.graceEndsAt = new Date(
        billing.entitlementEnd.getTime() + GRACE_MS
      );
      await this.save(tx, billing);
      await tx.enqueueNotice({
        id: `renewal-failed:${invoice.id}`,
        ownerUserId: billing.ownerUserId,
        graceEndsAt: billing.graceEndsAt,
        sentAt: null,
        createdAt: this.now(),
      });
    }
  }

  private async reconcileOne(tx: BillingTransaction, billing: OwnerBilling) {
    if (
      billing.status === 'pending' ||
      billing.status === 'suspended' ||
      !billing.entitlementEnd
    )
      return;
    const now = this.now();
    if (billing.entitlementEnd > now) return;
    if (billing.stripeSubscriptionId) {
      const snapshot = await this.gateway.getSubscription(
        billing.stripeSubscriptionId
      );
      const attempt = snapshot.checkoutId
        ? await tx.getCheckout(snapshot.checkoutId)
        : null;
      if (snapshot.invoice)
        await this.applyInvoice(tx, snapshot.invoice, attempt);
      billing = await this.requireBilling(tx, billing.ownerUserId);
      if (billing.entitlementEnd && billing.entitlementEnd > now) return;
      if (
        (snapshot.canceled || snapshot.cancelAtEnd) &&
        billing.status !== 'grace'
      )
        billing.cancelAtEnd = true;
    }
    const suspensionDate = billing.cancelAtEnd
      ? billing.entitlementEnd
      : (billing.graceEndsAt ??
        new Date(billing.entitlementEnd!.getTime() + GRACE_MS));
    if (!suspensionDate || suspensionDate > now) return;
    await this.gateway.stopCollection(
      billing,
      `wa-stop:${billing.ownerUserId}:${billing.stripeSubscriptionId}`
    );
    billing.status = 'suspended';
    billing.suspendedAt = suspensionDate;
    billing.retentionUntil = addCalendarMonths(suspensionDate, 3);
    billing.pendingPlan = null;
    billing.stripeScheduleId = null;
    billing.cancelAtEnd = true;
    await this.save(tx, billing);
  }

  private async requireBilling(tx: BillingTransaction, ownerId: string) {
    const billing = await tx.getBilling(ownerId);
    if (!billing) throw new Error('No subscription is linked to this account');
    return billing;
  }

  private async save(tx: BillingTransaction, billing: OwnerBilling) {
    billing.version += 1;
    billing.updatedAt = this.now();
    await tx.saveBilling(billing);
  }
}
