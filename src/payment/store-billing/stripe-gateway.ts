import Stripe from 'stripe';
import type {
  BillingEvent,
  BillingGateway,
  BillingInvoice,
  BillingNotice,
  CheckoutSession,
  SubscriptionSnapshot,
} from './contracts';
import { CheckoutNotCreatedError } from './contracts';
import {
  type BillingCheckout,
  type BillingOffer,
  type BillingOwner,
  type OwnerBilling,
  addCalendarMonths,
  periodMonths,
} from './model';

const FLOW = 'whataisle_store_v1';
const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : (value?.id ?? null);
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const dateOf = (value: number) => new Date(value * 1000);

export class StripeStoreBillingGateway implements BillingGateway {
  constructor(
    private readonly stripe: Stripe,
    private readonly baseUrl: string,
    private readonly mail: (
      owner: BillingOwner,
      notice: BillingNotice
    ) => Promise<void>,
    private readonly now: () => Date = () => new Date()
  ) {}

  async createPortal(billing: OwnerBilling) {
    if (!billing.stripeCustomerId)
      throw new Error('No paid customer is linked to this account');
    let configuration: Stripe.BillingPortal.Configuration | null = null;
    for await (const item of this.stripe.billingPortal.configurations.list({
      active: true,
      limit: 100,
    })) {
      if (item.metadata?.wa_store_portal === 'v1') {
        configuration = item;
        break;
      }
    }
    if (!configuration) {
      configuration = await this.stripe.billingPortal.configurations.create(
        {
          metadata: { wa_store_portal: 'v1' },
          default_return_url: `${this.baseUrl}/settings/billing`,
          features: {
            invoice_history: { enabled: true },
            payment_method_update: { enabled: true },
            customer_update: { enabled: false },
            subscription_cancel: { enabled: false },
            subscription_update: { enabled: false },
          },
        },
        { idempotencyKey: 'wa-store-portal-v1' }
      );
    }
    if (
      configuration.features.subscription_cancel.enabled ||
      configuration.features.subscription_update.enabled ||
      !configuration.features.payment_method_update.enabled ||
      !configuration.features.invoice_history.enabled
    ) {
      throw new Error(
        'The store billing portal configuration is unsafe; subscription changes must use the owner dashboard'
      );
    }
    const session = await this.stripe.billingPortal.sessions.create({
      customer: billing.stripeCustomerId,
      configuration: configuration.id,
      return_url: `${this.baseUrl}/settings/billing`,
    });
    return session.url;
  }

  private async approvedPrice(
    offer: Pick<BillingOffer, 'priceId' | 'amount' | 'currency' | 'plan'>
  ) {
    const price = await this.stripe.prices.retrieve(offer.priceId);
    if (
      !price.active ||
      price.currency !== offer.currency ||
      price.unit_amount !== offer.amount ||
      price.recurring?.interval !== offer.plan ||
      price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== 'licensed' ||
      price.tax_behavior !== 'exclusive'
    ) {
      throw new Error(
        'Configured Stripe price must match the approved amount, currency, interval, and exclusive tax treatment'
      );
    }
    return price;
  }

  async createCheckout(
    owner: BillingOwner,
    attempt: BillingCheckout,
    customerId: string | null
  ): Promise<CheckoutSession> {
    const price = await this.approvedPrice(attempt);
    const customer =
      customerId ??
      (
        await this.stripe.customers.create(
          {
            email: owner.email,
            name: owner.name,
            metadata: { wa_owner_id: owner.id },
          },
          { idempotencyKey: `wa-customer:${owner.id}` }
        )
      ).id;
    const metadata = {
      flow: FLOW,
      wa_checkout_id: attempt.id,
      wa_owner_id: owner.id,
    };
    const end = addCalendarMonths(
      attempt.createdAt,
      periodMonths(attempt.plan, true)
    );
    const localePrefix = attempt.locale === 'zh' ? '/zh' : '';
    const firstPeriod = periodMonths(attempt.plan, attempt.giftEligible);
    const firstAmount = `${attempt.currency.toUpperCase()} ${(attempt.amount / 100).toFixed(2)}`;
    const estimatedRenewal = addCalendarMonths(attempt.createdAt, firstPeriod)
      .toISOString()
      .slice(0, 10);
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer,
          payment_method_types: ['card'],
          billing_address_collection: 'required',
          customer_update: { address: 'auto', name: 'auto' },
          automatic_tax: { enabled: true },
          tax_id_collection: { enabled: true },
          locale: attempt.locale === 'zh' ? 'zh' : 'en',
          expires_at: seconds(attempt.expiresAt),
          metadata,
          client_reference_id: owner.id,
          success_url: `${this.baseUrl}${localePrefix}/payment?session_id={CHECKOUT_SESSION_ID}&callback=/dashboard`,
          cancel_url: `${this.baseUrl}${localePrefix}/settings/billing`,
          line_items: [
            { price: price.id, quantity: 1 },
            ...(attempt.giftEligible
              ? [
                  {
                    price_data: {
                      currency: attempt.currency,
                      unit_amount: attempt.amount,
                      product: idOf(price.product)!,
                      tax_behavior: 'exclusive' as const,
                    },
                    quantity: 1,
                  },
                ]
              : []),
          ],
          subscription_data: {
            metadata,
            ...(attempt.giftEligible ? { trial_end: seconds(end) } : {}),
          },
          custom_text: {
            submit: {
              message:
                attempt.locale === 'zh'
                  ? `现在支付 ${firstAmount}（另加适用税费），包含 ${firstPeriod} 个月服务。按今天付款预计 ${estimatedRenewal} 续费；实际从付款日计算，准确日期见账户。可在账户取消续费。`
                  : `Pay ${firstAmount} plus tax for ${firstPeriod} ${firstPeriod === 1 ? 'month' : 'months'}. If paid today, renew around ${estimatedRenewal}. Your payment date sets the final renewal date shown in your account. Cancel renewal there.`,
            },
          },
        },
        { idempotencyKey: `wa-checkout:${attempt.id}` }
      );
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError)
        throw new CheckoutNotCreatedError(
          'Stripe rejected this checkout; start a new checkout'
        );
      throw error;
    }
    return this.checkoutSnapshot(session);
  }

  async getCheckout(id: string) {
    const session = await this.stripe.checkout.sessions.retrieve(id);
    return this.checkoutSnapshot(session);
  }

  async expireCheckout(id: string) {
    try {
      await this.stripe.checkout.sessions.expire(
        id,
        {},
        { idempotencyKey: `wa-expire:${id}` }
      );
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError))
        throw error;
      // A customer might pay between the request and expiration. Retrieve the
      // authoritative result; never release a place just because expire failed.
    }
    return this.getCheckout(id);
  }

  async getCheckoutForSubscription(id: string) {
    const sessions = await this.stripe.checkout.sessions.list({
      subscription: id,
      limit: 1,
    });
    return sessions.data[0] ? this.checkoutSnapshot(sessions.data[0]) : null;
  }

  private async checkoutSnapshot(
    session: Stripe.Checkout.Session
  ): Promise<CheckoutSession> {
    const subscriptionId = idOf(session.subscription);
    let invoice: BillingInvoice | null = null;
    if (
      subscriptionId &&
      session.status === 'complete' &&
      session.payment_status === 'paid'
    ) {
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      const invoiceId =
        idOf(session.invoice) ?? idOf(subscription.latest_invoice);
      if (invoiceId)
        invoice = await this.invoiceSnapshot(
          await this.stripe.invoices.retrieve(invoiceId),
          subscription
        );
    }
    return {
      id: session.id,
      url: session.url,
      status: session.status ?? 'open',
      subscriptionId,
      invoice,
    };
  }

  async extendInitialPeriod(
    subscriptionId: string,
    end: Date,
    checkoutId: string
  ) {
    // An old initial-invoice replay must not move a currently renewing
    // subscription backwards; reconciliation will read its latest paid invoice.
    if (end <= this.now()) return;
    await this.stripe.subscriptions.update(
      subscriptionId,
      { trial_end: seconds(end), proration_behavior: 'none' },
      { idempotencyKey: `wa-intro:${checkoutId}` }
    );
  }

  async schedulePlan(
    billing: OwnerBilling,
    offer: BillingOffer,
    operationKey: string
  ) {
    const price = await this.approvedPrice(offer);
    if (!billing.stripeSubscriptionId || !billing.entitlementEnd)
      throw new Error('Subscription is not ready');
    const subscription = await this.stripe.subscriptions.retrieve(
      billing.stripeSubscriptionId
    );
    const scheduleId =
      idOf(subscription.schedule) ??
      (
        await this.stripe.subscriptionSchedules.create(
          { from_subscription: subscription.id },
          { idempotencyKey: `${operationKey}:create` }
        )
      ).id;
    const schedule =
      await this.stripe.subscriptionSchedules.retrieve(scheduleId);
    const currentPrice = subscription.items.data[0]?.price.id;
    if (!currentPrice || !schedule.current_phase)
      throw new Error('Subscription schedule has no current billing phase');
    await this.stripe.subscriptionSchedules.update(
      scheduleId,
      {
        end_behavior: 'release',
        proration_behavior: 'none',
        phases: [
          {
            start_date: schedule.current_phase.start_date,
            end_date: seconds(billing.entitlementEnd),
            items: [{ price: currentPrice, quantity: 1 }],
            proration_behavior: 'none',
            ...(subscription.trial_end &&
            subscription.trial_end > seconds(this.now())
              ? { trial_end: subscription.trial_end }
              : {}),
            automatic_tax: { enabled: true },
          },
          {
            start_date: seconds(billing.entitlementEnd),
            items: [{ price: price.id, quantity: 1 }],
            iterations: 1,
            billing_cycle_anchor: 'phase_start',
            proration_behavior: 'none',
            automatic_tax: { enabled: true },
          },
        ],
      },
      { idempotencyKey: `${operationKey}:update` }
    );
    return scheduleId;
  }

  async setCancelAtEnd(
    billing: OwnerBilling,
    cancel: boolean,
    operationKey: string
  ) {
    if (!billing.stripeSubscriptionId || !billing.entitlementEnd)
      throw new Error('Subscription is not ready');
    const subscription = await this.stripe.subscriptions.retrieve(
      billing.stripeSubscriptionId
    );
    const scheduleId = idOf(subscription.schedule);
    if (scheduleId) {
      // Release removes every future phase before applying cancellation. A
      // pending annual switch must never collect after cancellation succeeds.
      await this.stripe.subscriptionSchedules.release(
        scheduleId,
        { preserve_cancel_date: false },
        { idempotencyKey: `${operationKey}:release` }
      );
    }
    if (cancel && billing.entitlementEnd <= this.now()) {
      await this.stopCollection(billing, operationKey);
      return;
    }
    await this.stripe.subscriptions.update(
      subscription.id,
      {
        cancel_at: cancel ? seconds(billing.entitlementEnd) : '',
        proration_behavior: 'none',
      },
      { idempotencyKey: `${operationKey}:cancel` }
    );
  }

  async stopCollection(billing: OwnerBilling, operationKey: string) {
    if (!billing.stripeSubscriptionId) return;
    const subscription = await this.stripe.subscriptions.retrieve(
      billing.stripeSubscriptionId
    );
    if (subscription.status !== 'canceled') {
      const scheduleId = idOf(subscription.schedule);
      if (scheduleId) {
        await this.stripe.subscriptionSchedules.cancel(
          scheduleId,
          { invoice_now: false, prorate: false },
          { idempotencyKey: `${operationKey}:schedule` }
        );
      } else {
        await this.stripe.subscriptions.cancel(
          subscription.id,
          { invoice_now: false, prorate: false },
          { idempotencyKey: `${operationKey}:subscription` }
        );
      }
    }
    // A canceled subscription alone leaves open invoices collectible. Void
    // them explicitly, and remove unfinalized invoices, to avoid back-billing.
    for await (const invoice of this.stripe.invoices.list({
      subscription: subscription.id,
      status: 'open',
      limit: 100,
    })) {
      await this.stripe.invoices.voidInvoice(
        invoice.id,
        {},
        { idempotencyKey: `${operationKey}:void:${invoice.id}` }
      );
    }
    for await (const invoice of this.stripe.invoices.list({
      subscription: subscription.id,
      status: 'draft',
      limit: 100,
    })) {
      await this.stripe.invoices.del(invoice.id);
    }
  }

  async getSubscription(id: string): Promise<SubscriptionSnapshot> {
    return this.subscriptionSnapshot(
      await this.stripe.subscriptions.retrieve(id)
    );
  }

  private async subscriptionSnapshot(
    subscription: Stripe.Subscription
  ): Promise<SubscriptionSnapshot> {
    const latestInvoiceId = idOf(subscription.latest_invoice);
    const invoice = latestInvoiceId
      ? await this.invoiceSnapshot(
          await this.stripe.invoices.retrieve(latestInvoiceId),
          subscription
        )
      : null;
    return {
      id: subscription.id,
      checkoutId: subscription.metadata.wa_checkout_id ?? null,
      ownerUserId: subscription.metadata.wa_owner_id ?? '',
      canceled: subscription.status === 'canceled',
      cancelAtEnd:
        subscription.cancel_at_period_end || subscription.cancel_at !== null,
      invoice,
    };
  }

  private async invoiceSnapshot(
    invoice: Stripe.Invoice,
    subscription: Stripe.Subscription
  ): Promise<BillingInvoice> {
    // The invoice line period, not today's subscription period, is authoritative
    // when an old paid event is replayed after the next renewal already happened.
    const line = invoice.lines.data.find(
      (item) => item.type === 'subscription'
    );
    if (!line?.price)
      throw new Error('Subscription invoice has no recurring price');
    return {
      id: invoice.id,
      subscriptionId: subscription.id,
      checkoutId: subscription.metadata.wa_checkout_id ?? null,
      ownerUserId: subscription.metadata.wa_owner_id ?? '',
      customerId: idOf(invoice.customer) ?? '',
      paid: invoice.status === 'paid' && invoice.paid,
      paymentFailed:
        invoice.status !== 'paid' &&
        (invoice.attempt_count > 0 ||
          !!invoice.last_finalization_error ||
          invoice.status === 'uncollectible'),
      initial: invoice.billing_reason === 'subscription_create',
      currency: invoice.currency,
      subtotal: invoice.subtotal_excluding_tax ?? invoice.subtotal,
      paidAt: invoice.status_transitions.paid_at
        ? dateOf(invoice.status_transitions.paid_at)
        : null,
      periodStart: dateOf(line.period.start),
      periodEnd: dateOf(line.period.end),
      priceId: line.price.id,
    };
  }

  async readEvent(event: Stripe.Event): Promise<BillingEvent | null> {
    if (event.type.startsWith('checkout.session.')) {
      const object = event.data.object as Stripe.Checkout.Session;
      if (object.metadata?.flow !== FLOW) return null;
      const session = await this.getCheckout(object.id);
      return {
        id: event.id,
        kind: 'checkout',
        checkoutId: object.metadata.wa_checkout_id ?? null,
        session,
      };
    }
    if (
      [
        'invoice.paid',
        'invoice.payment_failed',
        'invoice.payment_action_required',
        'invoice.finalization_failed',
      ].includes(event.type)
    ) {
      const object = await this.stripe.invoices.retrieve(
        (event.data.object as Stripe.Invoice).id
      );
      const subscriptionId = idOf(object.subscription);
      if (!subscriptionId) return null;
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      if (subscription.metadata.flow !== FLOW) return null;
      const invoice = await this.invoiceSnapshot(object, subscription);
      return {
        id: event.id,
        kind: 'invoice',
        checkoutId: invoice.checkoutId,
        invoice,
      };
    }
    if (event.type.startsWith('customer.subscription.')) {
      const object = event.data.object as Stripe.Subscription;
      if (object.metadata.flow !== FLOW) return null;
      const snapshot = await this.getSubscription(object.id);
      return {
        id: event.id,
        kind: 'subscription',
        checkoutId: snapshot.checkoutId,
        subscription: snapshot,
      };
    }
    return null;
  }

  sendFailureNotice(owner: BillingOwner, notice: BillingNotice) {
    return this.mail(owner, notice);
  }
}
