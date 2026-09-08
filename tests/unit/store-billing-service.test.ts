import assert from 'node:assert/strict';
import { test } from 'node:test';
import Stripe from 'stripe';
import type { CapacitySnapshot } from '../../src/payment/store-billing/capacity';
import type {
  BillingEvent,
  BillingGateway,
  BillingInvoice,
  BillingNotice,
  BillingRepository,
  BillingTransaction,
  CheckoutSession,
  SubscriptionSnapshot,
} from '../../src/payment/store-billing/contracts';
import {
  type BillingCheckout,
  type BillingOffer,
  type BillingOwner,
  type OwnerBilling,
  type StorePlan,
  addCalendarMonths,
  billingAccess,
  resolveOffer,
} from '../../src/payment/store-billing/model';
import { StoreBillingService } from '../../src/payment/store-billing/service';
import { StripeStoreBillingGateway } from '../../src/payment/store-billing/stripe-gateway';

const env = {
  STRIPE_PRICE_USD_MONTH: 'price_usd_month',
  STRIPE_PRICE_USD_YEAR: 'price_usd_year',
  STRIPE_PRICE_CAD_MONTH: 'price_cad_month',
  STRIPE_PRICE_CAD_YEAR: 'price_cad_year',
  STRIPE_PRICE_CAD_TEST_MONTH: 'price_cad_test',
  STORE_BILLING_TEST_EMAILS:
    'one@example.test,two@example.test,three@example.test,four@example.test',
};

class MemoryRepository implements BillingRepository {
  state = {
    billings: new Map<string, OwnerBilling>(),
    checkouts: new Map<string, BillingCheckout>(),
    events: new Set<string>(),
    notices: new Map<string, BillingNotice>(),
    payments: new Set<string>(),
    owners: new Map<string, BillingOwner>(),
    closedStores: new Set<string>(),
    legacySubscriptions: new Set<string>(),
    capacity: {
      registryHandles: ['wherebear'],
      stores: [],
    } as CapacitySnapshot,
  };
  private lock = Promise.resolve();

  async getBilling(id: string) {
    return structuredClone(this.state.billings.get(id) ?? null);
  }
  async getBillingByStore(id: string) {
    return structuredClone(
      [...this.state.billings.values()].find((item) => item.storeId === id) ??
        null
    );
  }
  async hasLegacySubscription(id: string) {
    return this.state.legacySubscriptions.has(id);
  }

  async transaction<T>(
    run: (tx: BillingTransaction) => Promise<T>
  ): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const state = structuredClone(this.state);
    const copy = <V>(value: V) => structuredClone(value);
    const tx: BillingTransaction = {
      getCapacitySnapshot: async () => copy(state.capacity),
      getBilling: async (id) => copy(state.billings.get(id) ?? null),
      getBillingByStore: async (id) =>
        copy(
          [...state.billings.values()].find((item) => item.storeId === id) ??
            null
        ),
      getAllBillings: async () => copy([...state.billings.values()]),
      saveBilling: async (item) => {
        state.billings.set(item.ownerUserId, copy(item));
      },
      getCheckout: async (id) => copy(state.checkouts.get(id) ?? null),
      getCheckouts: async () => copy([...state.checkouts.values()]),
      saveCheckout: async (item) => {
        state.checkouts.set(item.id, copy(item));
      },
      hasEvent: async (id) => state.events.has(id),
      saveEvent: async (id) => {
        state.events.add(id);
      },
      savePayment: async (_billing, invoice) => {
        state.payments.add(invoice.id);
      },
      enqueueNotice: async (item) => {
        if (!state.notices.has(item.id)) state.notices.set(item.id, copy(item));
      },
      getNotices: async () =>
        copy([...state.notices.values()].filter((item) => !item.sentAt)),
      markNoticeSent: async (id, at) => {
        state.notices.get(id)!.sentAt = at;
      },
      getOwner: async (id) => copy(state.owners.get(id) ?? null),
      isStorePermanentlyClosed: async (id) => state.closedStores.has(id),
      hasLegacySubscription: async (id) => state.legacySubscriptions.has(id),
    };
    try {
      const result = await run(tx);
      this.state = state;
      return result;
    } finally {
      release();
    }
  }
}

class FakeStripe implements BillingGateway {
  async createPortal(billing: OwnerBilling) {
    return `https://billing.stripe.test/${billing.stripeCustomerId}`;
  }
  sessions = new Map<string, CheckoutSession>();
  attempts = new Map<string, BillingCheckout>();
  subscriptions = new Map<string, SubscriptionSnapshot>();
  extensions: Array<{ id: string; end: Date; key: string }> = [];
  changes: Array<{ billing: OwnerBilling; offer: BillingOffer; key: string }> =
    [];
  cancellations: Array<{ cancel: boolean; billing: OwnerBilling }> = [];
  stopped: string[] = [];
  notices: string[] = [];
  failCreateAfterRemoteSuccess = false;
  failExtendOnce = false;
  failExtendAfterRemoteSuccess = false;

  async createCheckout(_owner: BillingOwner, attempt: BillingCheckout) {
    const id = `cs_${attempt.id}`;
    this.attempts.set(attempt.id, structuredClone(attempt));
    if (!this.sessions.has(id))
      this.sessions.set(id, {
        id,
        url: `https://checkout.stripe.test/${id}`,
        status: 'open',
        subscriptionId: null,
        invoice: null,
      });
    if (this.failCreateAfterRemoteSuccess) {
      this.failCreateAfterRemoteSuccess = false;
      throw new Error('Connection dropped after Stripe accepted checkout');
    }
    return structuredClone(this.sessions.get(id)!);
  }
  async getCheckout(id: string) {
    return structuredClone(this.sessions.get(id)!);
  }
  async expireCheckout(id: string) {
    const session = this.sessions.get(id)!;
    if (session.status === 'open') session.status = 'expired';
    return structuredClone(session);
  }
  async getCheckoutForSubscription(id: string) {
    return structuredClone(
      [...this.sessions.values()].find((item) => item.subscriptionId === id) ??
        null
    );
  }
  async extendInitialPeriod(id: string, end: Date, key: string) {
    if (this.failExtendOnce) {
      this.failExtendOnce = false;
      throw new Error('Stripe temporarily unavailable');
    }
    if (!this.extensions.some((entry) => entry.key === key))
      this.extensions.push({ id, end, key });
    if (this.failExtendAfterRemoteSuccess) {
      this.failExtendAfterRemoteSuccess = false;
      throw new Error(
        'Connection dropped after Stripe accepted the period update'
      );
    }
  }
  async schedulePlan(billing: OwnerBilling, offer: BillingOffer, key: string) {
    this.changes.push(structuredClone({ billing, offer, key }));
    return `sched_${billing.ownerUserId}`;
  }
  async setCancelAtEnd(billing: OwnerBilling, cancel: boolean) {
    this.cancellations.push(structuredClone({ billing, cancel }));
    this.subscriptions.get(billing.stripeSubscriptionId!)!.cancelAtEnd = cancel;
  }
  async stopCollection(billing: OwnerBilling) {
    this.stopped.push(billing.stripeSubscriptionId!);
    this.subscriptions.get(billing.stripeSubscriptionId!)!.canceled = true;
  }
  async getSubscription(id: string) {
    return structuredClone(this.subscriptions.get(id)!);
  }
  async sendFailureNotice(_owner: BillingOwner, notice: BillingNotice) {
    this.notices.push(notice.id);
  }

  paidCheckout(attemptId: string, at: Date): BillingEvent {
    const attempt = this.attempts.get(attemptId)!;
    const invoice: BillingInvoice = {
      id: `in_${attemptId}`,
      subscriptionId: `sub_${attemptId}`,
      checkoutId: attemptId,
      ownerUserId: attempt.ownerUserId,
      customerId: `cus_${attempt.ownerUserId}`,
      paid: true,
      paymentFailed: false,
      initial: true,
      currency: attempt.currency,
      subtotal: attempt.amount,
      paidAt: at,
      periodStart: at,
      periodEnd: addCalendarMonths(at, attempt.plan === 'month' ? 1 : 12),
      priceId: attempt.priceId,
    };
    const session = this.sessions.get(`cs_${attemptId}`)!;
    Object.assign(session, {
      status: 'complete',
      subscriptionId: invoice.subscriptionId,
      invoice,
    });
    this.subscriptions.set(invoice.subscriptionId, {
      id: invoice.subscriptionId,
      checkoutId: attemptId,
      ownerUserId: attempt.ownerUserId,
      canceled: false,
      cancelAtEnd: false,
      invoice,
    });
    return {
      id: `evt_${attemptId}`,
      kind: 'invoice',
      checkoutId: attemptId,
      invoice: structuredClone(invoice),
    };
  }
}

function fixture(start = '2026-01-31T16:15:00Z') {
  const repo = new MemoryRepository();
  const stripe = new FakeStripe();
  let now = new Date(start);
  const service = new StoreBillingService(
    repo,
    stripe,
    env,
    () => new Date(now)
  );
  const owner = (id = 'one') => {
    const value = { id, name: id, email: `${id}@example.test` };
    repo.state.owners.set(id, value);
    return value;
  };
  return {
    repo,
    stripe,
    service,
    owner,
    now: () => new Date(now),
    advance: (date: Date) => {
      now = date;
    },
  };
}

async function purchase(
  f: ReturnType<typeof fixture>,
  id = 'one',
  plan: StorePlan = 'month',
  promoCode?: string,
  requestId = `${id}-first`
) {
  const owner = f.owner(id);
  await f.service.createCheckout(owner, { requestId, plan, promoCode });
  const event = f.stripe.paidCheckout(requestId, f.now());
  await f.service.handleEvent(event);
  return {
    owner,
    event,
    billing: (await f.service.getOwnerBilling(owner.id))!,
  };
}

test('a real SDK invalid-request rejection releases a reserved test place immediately while a network error keeps it reserved', async () => {
  const f = fixture();
  let rejection: Error = new Stripe.errors.StripeInvalidRequestError({
    message: 'The Checkout request is invalid',
    type: 'invalid_request_error',
    statusCode: 400,
  });
  const gateway = new StripeStoreBillingGateway(
    {
      prices: {
        retrieve: async () => ({
          id: env.STRIPE_PRICE_CAD_TEST_MONTH,
          active: true,
          currency: 'cad',
          unit_amount: 100,
          product: 'prod_test',
          recurring: {
            interval: 'month',
            interval_count: 1,
            usage_type: 'licensed',
          },
          tax_behavior: 'exclusive',
        }),
      },
      customers: { create: async () => ({ id: 'cus_test' }) },
      checkout: {
        sessions: {
          create: async () => {
            throw rejection;
          },
        },
      },
    } as unknown as Stripe,
    'https://www.whataisle.com',
    async () => {},
    f.now
  );
  const service = new StoreBillingService(f.repo, gateway, env, f.now);
  // Four failed attempts must never consume the three successful-opening cap.
  for (let index = 0; index < 4; index++) {
    await assert.rejects(
      service.createCheckout(f.owner('one'), {
        requestId: `rejected-${index}`,
        plan: 'month',
        promoCode: '1CADTEST',
      }),
      /Stripe rejected this checkout/
    );
    assert.equal(
      f.repo.state.checkouts.get(`rejected-${index}`)!.status,
      'expired'
    );
  }
  rejection = new Stripe.errors.StripeConnectionError({
    message: 'Response lost after request was sent',
    type: 'api_error',
  });
  await assert.rejects(
    service.createCheckout(f.owner('one'), {
      requestId: 'ambiguous',
      plan: 'month',
      promoCode: '1CADTEST',
    }),
    /Response lost/
  );
  assert.equal(f.repo.state.checkouts.get('ambiguous')!.status, 'reserved');
});

test('parallel new-owner checkouts reserve only four places beside the registered WhereBear store', async () => {
  const f = fixture();
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) =>
      f.service.createCheckout(f.owner(`capacity-${index}`), {
        requestId: `capacity-${index}`,
        plan: 'month',
      })
    )
  );
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 4);
  assert.equal(f.stripe.sessions.size, 4);
  assert.equal(f.repo.state.checkouts.size, 4);
  for (const result of results)
    if (result.status === 'rejected')
      assert.match(result.reason.message, /All five store places/);
});

test('an ambiguous checkout keeps the last physical place reserved until Stripe confirms expiration', async () => {
  const f = fixture();
  for (const id of ['one', 'two', 'three'])
    await f.service.createCheckout(f.owner(id), {
      requestId: id,
      plan: 'month',
    });
  f.stripe.failCreateAfterRemoteSuccess = true;
  await assert.rejects(
    f.service.createCheckout(f.owner('four'), {
      requestId: 'four',
      plan: 'month',
    }),
    /Connection dropped/
  );
  await assert.rejects(
    f.service.createCheckout(f.owner('five'), {
      requestId: 'five',
      plan: 'month',
    }),
    /All five store places/
  );
  assert.equal(f.stripe.sessions.size, 4);
  // A timestamp alone is insufficient: the session may have been paid remotely.
  f.advance(new Date(f.now().getTime() + 86400000));
  await assert.rejects(
    f.service.createCheckout(f.owner('five'), {
      requestId: 'five',
      plan: 'month',
    }),
    /All five store places/
  );
  await f.stripe.expireCheckout('cs_four');
  await f.service.createCheckout(f.owner('five'), {
    requestId: 'five',
    plan: 'month',
  });
  assert.equal(f.repo.state.checkouts.get('four')!.status, 'expired');
  assert.equal(f.repo.state.checkouts.get('five')!.status, 'open');
});

test('registry deduplication, paid unbuilt stores, legacy runtimes and failed cleanup all count; existing owners reuse their place', async () => {
  const f = fixture();
  await purchase(f, 'paid-unbuilt');
  await f.service.cancelRenewal('paid-unbuilt');
  f.repo.state.capacity = {
    registryHandles: ['wherebear', 'legacy', 'archived'],
    stores: [
      ['wb', 'wherebear', 'active', 'ready'],
      ['legacy-owner', 'legacy', 'closed', null],
      ['retained-owner', 'retained', 'suspended', 'failed'],
      ['cleanup-owner', 'cleanup', 'closing', 'failed'],
      ['archived-owner', 'archived', 'closed', 'archived'],
    ].map(([ownerUserId, handle, status, runtimeStatus]) => ({
      id: `${handle}-id`,
      ownerUserId: ownerUserId!,
      handle: handle!,
      status: status!,
      runtimeStatus,
    })),
  };
  f.repo.state.billings.set('archived-owner', {
    ...f.repo.state.billings.get('paid-unbuilt')!,
    ownerUserId: 'archived-owner',
    storeId: 'archived-id',
    status: 'suspended',
  });
  f.repo.state.checkouts.set('archived-paid', {
    ...f.repo.state.checkouts.get('paid-unbuilt-first')!,
    id: 'archived-paid',
    ownerUserId: 'archived-owner',
  });
  const purchaseNew = () =>
    f.service.createCheckout(f.owner('new'), {
      requestId: 'new',
      plan: 'month',
    });
  await assert.rejects(purchaseNew(), /All five store places/);
  await f.service.createCheckout(f.owner('retained-owner'), {
    requestId: 'restore-existing',
    plan: 'month',
  });
  await assert.rejects(purchaseNew(), /All five store places/);
  const closing = f.repo.state.capacity.stores.find(
    (store) => store.handle === 'cleanup'
  )!;
  closing.runtimeStatus = 'archived';
  await assert.rejects(purchaseNew(), /All five store places/);
  // Only the worker's complete acknowledgement releases this physical store.
  closing.status = 'closed';
  await purchaseNew();
  assert.equal(f.repo.state.checkouts.get('new')!.status, 'open');
  await assert.rejects(
    f.service.createCheckout(f.owner('archived-owner'), {
      requestId: 'reopen-archived',
      plan: 'month',
    }),
    /Store cleanup has started/
  );
});

test('formal monthly/annual USD and CAD charge once and grant exactly 3/14 calendar months from payment', async () => {
  for (const plan of ['month', 'year'] as const) {
    for (const promo of [undefined, 'INCAD']) {
      const f = fixture();
      const { billing } = await purchase(f, 'one', plan, promo);
      assert.equal(billing.currency, promo ? 'cad' : 'usd');
      assert.equal(
        billing.entitlementEnd!.toISOString(),
        plan === 'month'
          ? '2026-04-30T16:15:00.000Z'
          : '2027-03-31T16:15:00.000Z'
      );
      assert.equal(
        f.stripe.attempts.get('one-first')!.amount,
        plan === 'month' ? 19900 : 199900
      );
      assert.equal(f.stripe.extensions.length, 1);
      assert.equal(f.repo.state.payments.size, 1);
      assert.equal(billingAccess(billing, f.now()).setupAllowed, true);
    }
  }
});

test('payment time, not opening checkout or completing setup, starts the introductory period', async () => {
  const f = fixture('2026-08-31T23:58:00Z');
  await f.service.createCheckout(f.owner(), {
    requestId: 'late',
    plan: 'month',
  });
  f.advance(new Date('2026-09-01T00:03:00Z'));
  await f.service.handleEvent(f.stripe.paidCheckout('late', f.now()));
  const billing = (await f.service.getOwnerBilling('one'))!;
  assert.equal(
    billing.entitlementEnd!.toISOString(),
    '2026-12-01T00:03:00.000Z'
  );
  await f.service.attachStore('one', 'store-one');
  assert.equal(
    (await f.service.getStoreServiceAccess('store-one')).accessAllowed,
    true
  );
  assert.equal(
    (await f.service.getStoreServiceAccess('store-other')).accessAllowed,
    false
  );
  await assert.rejects(
    f.service.attachStore('one', 'store-other'),
    /already belongs/
  );
});

test('unpaid checkout and incorrect amount cannot grant access; failed fulfillment is retryable', async () => {
  const f = fixture();
  await f.service.createCheckout(f.owner(), {
    requestId: 'retry',
    plan: 'month',
  });
  const event = f.stripe.paidCheckout('retry', f.now());
  const unpaid = structuredClone(event);
  unpaid.id = 'evt-unpaid';
  unpaid.invoice!.paid = false;
  unpaid.invoice!.paidAt = null;
  await f.service.handleEvent(unpaid);
  assert.equal(
    billingAccess(await f.service.getOwnerBilling('one'), f.now())
      .accessAllowed,
    false
  );
  const wrong = structuredClone(event);
  wrong.invoice!.subtotal = 100;
  await assert.rejects(f.service.handleEvent(wrong), /approved checkout offer/);
  assert.equal(f.repo.state.events.has(event.id), false);
  f.stripe.failExtendOnce = true;
  await assert.rejects(f.service.handleEvent(event), /temporarily unavailable/);
  assert.equal(f.repo.state.events.has(event.id), false);
  assert.equal(f.repo.state.payments.size, 0);
  f.stripe.failExtendAfterRemoteSuccess = true;
  await assert.rejects(
    f.service.handleEvent(event),
    /accepted the period update/
  );
  assert.equal(f.repo.state.events.has(event.id), false);
  assert.equal(f.repo.state.payments.size, 0);
  assert.equal((await f.service.getOwnerBilling('one'))!.giftUsedAt, null);
  await f.service.handleEvent(event);
  await f.service.handleEvent(event);
  await f.service.handleEvent({ ...event, id: 'different-event-same-invoice' });
  assert.equal(f.repo.state.payments.size, 1);
  assert.equal(f.stripe.extensions.length, 1);
});

test('concurrent tabs and ambiguous network failure reuse a single remote checkout', async () => {
  const f = fixture();
  const owner = f.owner();
  f.stripe.failCreateAfterRemoteSuccess = true;
  await assert.rejects(
    f.service.createCheckout(owner, { requestId: 'stable', plan: 'month' }),
    /Connection dropped/
  );
  const checkouts = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      f.service.createCheckout(owner, {
        requestId: `refresh-${i}`,
        plan: 'month',
      })
    )
  );
  assert.equal(new Set(checkouts.map((item) => item.sessionId)).size, 1);
  assert.equal(f.stripe.sessions.size, 1);
  assert.equal(f.repo.state.checkouts.size, 1);
});

test('test offer is allowlisted, monthly only, with three concurrent successful openings and no gifted time', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.createCheckout(f.owner('outsider'), {
      requestId: 'outside',
      plan: 'month',
      promoCode: '1CADTEST',
    }),
    /designated accounts/
  );
  await assert.rejects(
    f.service.createCheckout(f.owner(), {
      requestId: 'year-test',
      plan: 'year',
      promoCode: '1CADTEST',
    }),
    /monthly only/
  );
  const results = await Promise.allSettled(
    ['one', 'two', 'three', 'four'].map((id) =>
      f.service.createCheckout(f.owner(id), {
        requestId: id,
        plan: 'month',
        promoCode: '1CADTEST',
      })
    )
  );
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 3);
  for (const attempt of f.repo.state.checkouts.values()) {
    await f.service.handleEvent(f.stripe.paidCheckout(attempt.id, f.now()));
    const billing = (await f.service.getOwnerBilling(attempt.ownerUserId))!;
    assert.equal(billing.currency, 'cad');
    assert.equal(billing.giftUsedAt, null);
    assert.equal(
      billing.entitlementEnd!.toISOString(),
      '2026-02-28T16:15:00.000Z'
    );
    assert.equal(attempt.amount, 100);
  }
  assert.equal(f.stripe.extensions.length, 3);
  assert.ok(
    f.stripe.extensions.every(
      (item) => item.end.toISOString() === '2026-02-28T16:15:00.000Z'
    )
  );
  assert.equal(
    [...f.repo.state.checkouts.values()].filter(
      (item) => item.status === 'paid'
    ).length,
    3
  );
});

test('confirmed Stripe expiration releases a test reservation, while a delayed paid event does not', async () => {
  const f = fixture();
  for (const id of ['one', 'two', 'three'])
    await f.service.createCheckout(f.owner(id), {
      requestId: id,
      plan: 'month',
      promoCode: '1CADTEST',
    });
  f.stripe.sessions.get('cs_one')!.status = 'expired';
  f.stripe.paidCheckout('two', f.now()); // payment is known remotely before webhook delivery
  await f.service.createCheckout(f.owner('four'), {
    requestId: 'four',
    plan: 'month',
    promoCode: '1CADTEST',
  });
  assert.equal(f.repo.state.checkouts.get('one')!.status, 'expired');
  assert.equal(f.repo.state.checkouts.get('two')!.status, 'paid');
  assert.equal(f.repo.state.checkouts.get('four')!.status, 'open');
});

test('both plan directions schedule at entitlement end without charging; cancellation removes the pending change', async () => {
  for (const currentPlan of ['month', 'year'] as const) {
    const f = fixture();
    const { billing } = await purchase(f, 'one', currentPlan, 'INCAD');
    const next = currentPlan === 'month' ? 'year' : 'month';
    const changed = await f.service.schedulePlan('one', next);
    assert.equal(changed.plan, currentPlan);
    assert.equal(changed.pendingPlan, next);
    assert.equal(changed.currency, 'cad');
    assert.deepEqual(changed.entitlementEnd, billing.entitlementEnd);
    assert.equal(
      f.stripe.changes[0]!.offer.amount,
      next === 'year' ? 199900 : 19900
    );
    assert.equal(
      f.stripe.sessions.size,
      1,
      'a plan change never opens an immediate charge'
    );
    const canceled = await f.service.cancelRenewal('one');
    assert.equal(canceled.cancelAtEnd, true);
    assert.equal(canceled.pendingPlan, null);
    assert.deepEqual(canceled.entitlementEnd, billing.entitlementEnd);
    assert.equal(billingAccess(canceled, f.now()).accessAllowed, true);
    await assert.rejects(f.service.schedulePlan('one', next), /Resume renewal/);
    assert.equal((await f.service.resumeRenewal('one')).cancelAtEnd, false);
  }
});

test('renewal failures get seven days, then stop collection; recovery starts a fresh normal period with no arrears or repeat gift', async () => {
  const f = fixture();
  const { event, billing } = await purchase(f);
  const end = billing.entitlementEnd!;
  const failure: BillingInvoice = {
    ...event.invoice!,
    id: 'in-renewal',
    initial: false,
    paid: false,
    paymentFailed: true,
    paidAt: null,
    periodStart: end,
    periodEnd: addCalendarMonths(end, 1),
  };
  f.stripe.subscriptions.get(billing.stripeSubscriptionId!)!.invoice = failure;
  f.advance(end);
  await f.service.handleEvent({
    id: 'evt-failed',
    kind: 'invoice',
    checkoutId: 'one-first',
    invoice: failure,
  });
  await f.service.reconcile();
  const grace = (await f.service.getOwnerBilling('one'))!;
  assert.equal(grace.status, 'grace');
  assert.equal(grace.graceEndsAt!.getTime() - end.getTime(), 7 * 86400000);
  assert.equal(f.stripe.notices.length, 1);
  assert.equal(billingAccess(grace, f.now()).accessAllowed, true);
  // Stripe's account-level dunning settings may stop the subscription early;
  // the already-promised seven-day service grace must still be honored.
  f.stripe.subscriptions.get(billing.stripeSubscriptionId!)!.canceled = true;
  await f.service.handleEvent({
    id: 'evt-stripe-stopped-early',
    kind: 'subscription',
    checkoutId: 'one-first',
    subscription: await f.stripe.getSubscription(billing.stripeSubscriptionId!),
  });
  await f.service.reconcile();
  assert.equal((await f.service.getOwnerBilling('one'))!.status, 'grace');
  assert.equal(f.stripe.stopped.length, 0);
  f.advance(grace.graceEndsAt!);
  await f.service.reconcile();
  const suspended = (await f.service.getOwnerBilling('one'))!;
  assert.equal(suspended.status, 'suspended');
  assert.deepEqual(suspended.suspendedAt, grace.graceEndsAt);
  assert.deepEqual(
    suspended.retentionUntil,
    addCalendarMonths(grace.graceEndsAt!, 3)
  );
  assert.equal(f.stripe.stopped.length, 1);
  assert.equal(billingAccess(suspended, f.now()).accessAllowed, false);
  f.advance(addCalendarMonths(f.now(), 1));
  const recovered = await purchase(f, 'one', 'year', undefined, 'recovery');
  assert.deepEqual(
    recovered.billing.entitlementEnd,
    addCalendarMonths(f.now(), 12)
  );
  assert.deepEqual(recovered.billing.giftUsedAt, billing.giftUsedAt);
  assert.equal(recovered.billing.retentionUntil, null);
  assert.equal(f.stripe.extensions.length, 2);
  assert.equal(f.stripe.attempts.get('recovery')!.giftEligible, false);
  await f.service.handleEvent({ ...event, id: 'old-paid-replayed' });
  assert.deepEqual(
    (await f.service.getOwnerBilling('one'))!.entitlementEnd,
    recovered.billing.entitlementEnd
  );
});

test('canceled first annual keeps fourteen months; retention starts at actual service end and cleanup blocks new charges', async () => {
  const f = fixture();
  const { billing } = await purchase(f, 'one', 'year');
  await f.service.attachStore('one', 'store-one');
  await f.service.cancelRenewal('one');
  assert.equal((await f.service.getOwnerBilling('one'))!.retentionUntil, null);
  f.advance(billing.entitlementEnd!);
  await f.service.reconcile();
  const suspended = (await f.service.getOwnerBilling('one'))!;
  assert.deepEqual(
    suspended.retentionUntil,
    addCalendarMonths(billing.entitlementEnd!, 3)
  );
  assert.equal(
    f.stripe.notices.length,
    0,
    'no cancellation or retention-expiry nag email'
  );
  f.repo.state.closedStores.add('store-one');
  await assert.rejects(
    f.service.createCheckout(f.owner(), {
      requestId: 'cleaned',
      plan: 'month',
    }),
    /cleanup has started/
  );
  assert.equal(f.stripe.sessions.size, 1);
});

test('switching to annual after introductory monthly period buys twelve months; stale failure cannot regress renewed entitlement', async () => {
  const f = fixture();
  const { billing, event } = await purchase(f);
  await f.service.schedulePlan('one', 'year');
  const renewal: BillingInvoice = {
    ...event.invoice!,
    id: 'in-year',
    initial: false,
    subtotal: 199900,
    priceId: 'price_usd_year',
    periodStart: billing.entitlementEnd!,
    periodEnd: addCalendarMonths(billing.entitlementEnd!, 12),
    paidAt: billing.entitlementEnd!,
  };
  await f.service.handleEvent({
    id: 'evt-year',
    kind: 'invoice',
    checkoutId: 'one-first',
    invoice: renewal,
  });
  const updated = (await f.service.getOwnerBilling('one'))!;
  assert.equal(updated.plan, 'year');
  assert.equal(updated.pendingPlan, null);
  assert.deepEqual(updated.entitlementEnd, renewal.periodEnd);
  assert.equal(f.stripe.extensions.length, 1);
  await f.service.handleEvent({
    id: 'evt-late-failure',
    kind: 'invoice',
    checkoutId: 'one-first',
    invoice: { ...renewal, paid: false, paidAt: null, paymentFailed: true },
  });
  assert.equal((await f.service.getOwnerBilling('one'))!.status, 'active');
});

test('existing formal currency and test status cannot be changed by promo input', () => {
  const f = fixture();
  const fake = { currency: 'usd', isTest: false } as OwnerBilling;
  assert.throws(
    () => resolveOffer('month', 'INCAD', f.owner().email, env, fake),
    /original currency/
  );
  assert.throws(
    () => resolveOffer('month', '1CADTEST', f.owner().email, env, fake),
    /test status/
  );
  assert.throws(
    () => resolveOffer('month', 'bad', f.owner().email, env, null),
    /Unknown promotion/
  );
  assert.equal(
    addCalendarMonths(new Date('2024-02-29T12:00:00Z'), 12).toISOString(),
    '2025-02-28T12:00:00.000Z'
  );
});

test('changing the selected offer expires the old session before creating a second payable checkout', async () => {
  const f = fixture();
  const owner = f.owner();
  await f.service.createCheckout(owner, {
    requestId: 'monthly',
    plan: 'month',
  });
  await f.service.createCheckout(owner, { requestId: 'annual', plan: 'year' });
  assert.equal(f.stripe.sessions.get('cs_monthly')!.status, 'expired');
  assert.equal(f.stripe.sessions.get('cs_annual')!.status, 'open');
  assert.equal(f.repo.state.checkouts.get('monthly')!.status, 'expired');
  assert.equal(f.repo.state.checkouts.get('annual')!.amount, 199900);
});

test('an existing legacy subscription blocks a second purchase before creating a new payable session', async () => {
  const f = fixture();
  const owner = f.owner();
  f.repo.state.legacySubscriptions.add(owner.id);
  await assert.rejects(
    f.service.createCheckout(owner, {
      requestId: 'would-double-charge',
      plan: 'month',
    }),
    /legacy subscription/
  );
  assert.equal(f.stripe.sessions.size, 0);
  assert.equal(f.repo.state.checkouts.size, 0);
});

test('normal renewal invoice draft remains available before reconciliation and produces no failure email', async () => {
  const f = fixture();
  const { billing, event } = await purchase(f);
  const end = billing.entitlementEnd!;
  const pending: BillingInvoice = {
    ...event.invoice!,
    id: 'in-pending',
    initial: false,
    paid: false,
    paymentFailed: false,
    paidAt: null,
    periodStart: end,
    periodEnd: addCalendarMonths(end, 1),
  };
  f.stripe.subscriptions.get(billing.stripeSubscriptionId!)!.invoice = pending;
  f.advance(end);
  assert.equal(
    billingAccess(await f.service.getOwnerBilling('one'), f.now())
      .accessAllowed,
    true,
    'No downtime at the renewal boundary before a worker runs'
  );
  f.advance(new Date(end.getTime() + 3600000));
  await f.service.reconcile();
  assert.equal((await f.service.getOwnerBilling('one'))!.status, 'active');
  assert.equal(f.repo.state.notices.size, 0);
  assert.equal(f.stripe.notices.length, 0);
  assert.equal(f.stripe.stopped.length, 0);
  const paid = { ...pending, paid: true, paidAt: f.now() };
  f.stripe.subscriptions.get(billing.stripeSubscriptionId!)!.invoice = paid;
  await f.service.handleEvent({
    id: 'evt-settled',
    kind: 'invoice',
    checkoutId: 'one-first',
    invoice: paid,
  });
  assert.deepEqual(
    (await f.service.getOwnerBilling('one'))!.entitlementEnd,
    pending.periodEnd
  );
  assert.equal(f.repo.state.notices.size, 0);
});

test('unsettled renewal cannot extend access indefinitely even without a failure webhook', async () => {
  const f = fixture();
  const { billing, event } = await purchase(f);
  const end = billing.entitlementEnd!;
  f.stripe.subscriptions.get(billing.stripeSubscriptionId!)!.invoice = {
    ...event.invoice!,
    id: 'in-stuck-draft',
    initial: false,
    paid: false,
    paymentFailed: false,
    paidAt: null,
    periodStart: end,
    periodEnd: addCalendarMonths(end, 1),
  };
  f.advance(new Date(end.getTime() + 7 * 86400000));
  assert.equal(
    billingAccess(await f.service.getOwnerBilling('one'), f.now())
      .accessAllowed,
    false
  );
  await f.service.reconcile();
  assert.equal((await f.service.getOwnerBilling('one'))!.status, 'suspended');
  assert.equal(f.stripe.stopped.length, 1);
  assert.equal(f.stripe.notices.length, 0);
});
