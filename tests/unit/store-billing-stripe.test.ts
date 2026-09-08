import assert from 'node:assert/strict';
import { test } from 'node:test';
import Stripe from 'stripe';
import type {
  BillingCheckout,
  OwnerBilling,
} from '../../src/payment/store-billing/model';
import { StripeStoreBillingGateway } from '../../src/payment/store-billing/stripe-gateway';

function fixture() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record =
    (method: string, result: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return structuredClone(result);
    };
  const price = {
    id: 'price_usd_month',
    active: true,
    currency: 'usd',
    unit_amount: 19900,
    product: 'prod_store',
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    tax_behavior: 'exclusive',
  };
  const subscription = {
    id: 'sub_one',
    status: 'trialing',
    schedule: 'sched_one',
    items: { data: [{ price: { id: 'price_usd_month' } }] },
    trial_end: 1906502400,
    current_period_start: 1898726400,
  };
  const configs: unknown[] = [];
  const mock = {
    prices: { retrieve: async () => price },
    customers: { create: record('customer.create', { id: 'cus_one' }) },
    checkout: {
      sessions: {
        create: record('checkout.create', {
          id: 'cs_one',
          url: 'https://checkout.stripe.test/one',
          status: 'open',
          subscription: null,
        }),
      },
    },
    subscriptions: {
      retrieve: async () => subscription,
      update: record('subscription.update', subscription),
      cancel: record('subscription.cancel', subscription),
    },
    subscriptionSchedules: {
      create: record('schedule.create', { id: 'sched_one' }),
      retrieve: async () => ({ current_phase: { start_date: 1898726400 } }),
      update: record('schedule.update', { id: 'sched_one' }),
      release: record('schedule.release', {}),
      cancel: record('schedule.cancel', {}),
    },
    invoices: {
      list: (params: { status: string }) =>
        (async function* () {
          yield { id: params.status === 'open' ? 'in_unpaid' : 'in_draft' };
        })(),
      voidInvoice: record('invoice.void', {}),
      del: record('invoice.delete', {}),
    },
    billingPortal: {
      configurations: {
        list: () =>
          (async function* () {
            yield* configs;
          })(),
        create: async (params: Record<string, unknown>, options: unknown) => {
          calls.push({
            method: 'portal.configuration',
            args: [params, options],
          });
          const result = { ...params, id: 'bpc_safe' };
          configs.push(result);
          return result;
        },
      },
      sessions: {
        create: record('portal.session', {
          url: 'https://billing.stripe.test/one',
        }),
      },
    },
  };
  const gateway = new StripeStoreBillingGateway(
    mock as unknown as Stripe,
    'https://www.whataisle.com',
    async () => {}
  );
  const billing = {
    ownerUserId: 'one',
    stripeCustomerId: 'cus_one',
    stripeSubscriptionId: 'sub_one',
    stripeScheduleId: 'sched_one',
    entitlementEnd: new Date('2030-06-01T00:00:00Z'),
  } as OwnerBilling;
  return { gateway, mock, calls, price, billing, configs, subscription };
}

test('Stripe Checkout includes an upfront first payment plus deferred recurring price, with deterministic idempotency and exclusive tax', async () => {
  const f = fixture();
  const attempt = {
    id: 'attempt-one',
    ownerUserId: 'one',
    plan: 'month',
    currency: 'usd',
    isTest: false,
    giftEligible: true,
    priceId: 'price_usd_month',
    amount: 19900,
    locale: 'zh',
    createdAt: new Date('2030-01-31T12:00:00Z'),
    expiresAt: new Date('2030-01-31T12:31:00Z'),
  } as BillingCheckout;
  await f.gateway.createCheckout(
    { id: 'one', email: 'one@example.test', name: 'One' },
    attempt,
    null
  );
  const call = f.calls.find((item) => item.method === 'checkout.create')!;
  const params = call.args[0] as Stripe.Checkout.SessionCreateParams;
  assert.equal(params.mode, 'subscription');
  assert.equal(params.line_items!.length, 2);
  assert.equal(params.line_items![1]!.price_data!.unit_amount, 19900);
  assert.equal(params.line_items![1]!.price_data!.tax_behavior, 'exclusive');
  assert.equal(
    params.subscription_data!.trial_end,
    Date.parse('2030-04-30T12:00:00Z') / 1000
  );
  assert.equal(params.automatic_tax!.enabled, true);
  assert.equal(
    params.allow_promotion_codes,
    undefined,
    'arbitrary Stripe coupons cannot replace approved app offer selection'
  );
  assert.equal(
    params.success_url,
    'https://www.whataisle.com/zh/payment?session_id={CHECKOUT_SESSION_ID}&callback=/dashboard'
  );
  assert.deepEqual(call.args[1], { idempotencyKey: 'wa-checkout:attempt-one' });
  const submit = params.custom_text!.submit;
  assert.ok(submit);
  assert.match(submit.message, /2030-04-30/);
  assert.match(submit.message, /付款日/);
  await f.gateway.createCheckout(
    { id: 'one', email: 'one@example.test', name: 'One' },
    { ...attempt, id: 'recovery', locale: 'en', giftEligible: false },
    'cus_one'
  );
  const recovery = f.calls.filter(
    (item) => item.method === 'checkout.create'
  )[1]!.args[0] as Stripe.Checkout.SessionCreateParams;
  const recoveryText = recovery.custom_text!.submit;
  assert.ok(recoveryText);
  assert.match(recoveryText.message, /for 1 month\./);
  assert.match(recoveryText.message, /2030-02-28/);
  await f.gateway.extendInitialPeriod(
    'sub_one',
    new Date('2030-05-01T00:00:00Z'),
    'attempt-one'
  );
  const extend = f.calls.find((item) => item.method === 'subscription.update')!;
  assert.deepEqual(extend.args[1], {
    trial_end: Date.parse('2030-05-01T00:00:00Z') / 1000,
    proration_behavior: 'none',
  });
});

test('SDK invalid-request expiration races retrieve the actual Checkout state before releasing a place', async () => {
  const f = fixture();
  let retrieves = 0;
  Object.assign(f.mock.checkout.sessions, {
    expire: async () => {
      throw new Stripe.errors.StripeInvalidRequestError({
        message: 'Checkout is already expired',
        type: 'invalid_request_error',
        statusCode: 400,
      });
    },
    retrieve: async () => {
      retrieves++;
      return {
        id: 'cs_expired',
        status: 'expired',
        subscription: null,
        url: null,
      };
    },
  });
  const expired = await f.gateway.expireCheckout('cs_expired');
  assert.equal(expired.status, 'expired');
  assert.equal(retrieves, 1);
});

test('incorrect Stripe amount/currency or inclusive-tax price fails before creating a payable checkout', async () => {
  const f = fixture();
  f.price.unit_amount = 199000;
  const attempt = {
    priceId: 'price_usd_month',
    plan: 'month',
    currency: 'usd',
    amount: 19900,
  } as BillingCheckout;
  await assert.rejects(
    f.gateway.createCheckout(
      { id: 'one', email: 'one@example.test', name: 'One' },
      attempt,
      null
    ),
    /Configured Stripe price/
  );
  assert.equal(f.calls.length, 0);
  f.price.unit_amount = 19900;
  f.price.tax_behavior = 'inclusive';
  await assert.rejects(
    f.gateway.createCheckout(
      { id: 'one', email: 'one@example.test', name: 'One' },
      attempt,
      null
    ),
    /exclusive tax/
  );
  assert.equal(f.calls.length, 0);
});

test('schedule applies the new price only at the entitlement boundary, and cancel releases that schedule before setting cancellation', async () => {
  const f = fixture();
  f.price.id = 'price_usd_year';
  f.price.unit_amount = 199900;
  f.price.recurring.interval = 'year';
  await f.gateway.schedulePlan(
    f.billing,
    {
      priceId: 'price_usd_year',
      amount: 199900,
      plan: 'year',
      currency: 'usd',
      isTest: false,
    },
    'change-v1'
  );
  const call = f.calls.find((item) => item.method === 'schedule.update')!;
  const params = call.args[1] as Stripe.SubscriptionScheduleUpdateParams;
  assert.equal(
    params.phases![0]!.end_date,
    f.billing.entitlementEnd!.getTime() / 1000
  );
  assert.equal(params.phases![1]!.start_date, params.phases![0]!.end_date);
  assert.equal(params.phases![1]!.items[0]!.price, 'price_usd_year');
  assert.equal(params.phases![1]!.trial_end, undefined);
  assert.equal(params.phases![1]!.proration_behavior, 'none');
  assert.equal(params.end_behavior, 'release');
  await f.gateway.setCancelAtEnd(f.billing, true, 'cancel-v2');
  const methods = f.calls.map((item) => item.method);
  assert.ok(
    methods.indexOf('schedule.release') < methods.indexOf('subscription.update')
  );
  const cancellation = f.calls.find(
    (item) => item.method === 'subscription.update'
  )!;
  assert.equal(
    (cancellation.args[1] as Stripe.SubscriptionUpdateParams).cancel_at,
    f.billing.entitlementEnd!.getTime() / 1000
  );
  assert.equal(
    f.calls.some((item) => item.method === 'checkout.create'),
    false
  );
});

test('suspension cancels the schedule with no invoice/proration and removes collectible unpaid invoices', async () => {
  const f = fixture();
  await f.gateway.stopCollection(f.billing, 'stop-one');
  assert.deepEqual(
    f.calls.map((item) => item.method),
    ['schedule.cancel', 'invoice.void', 'invoice.delete']
  );
  assert.deepEqual(f.calls[0]!.args[1], { invoice_now: false, prorate: false });
  assert.equal(f.calls[1]!.args[0], 'in_unpaid');
  assert.equal(f.calls[2]!.args[0], 'in_draft');
});

test('portal explicitly disables subscription changes and refuses a configuration altered to bypass owner billing', async () => {
  const f = fixture();
  await f.gateway.createPortal(f.billing);
  const configuration = f.calls.find(
    (item) => item.method === 'portal.configuration'
  )!.args[0] as Stripe.BillingPortal.ConfigurationCreateParams;
  assert.equal(configuration.features.subscription_cancel!.enabled, false);
  assert.equal(configuration.features.subscription_update!.enabled, false);
  assert.equal(configuration.features.payment_method_update!.enabled, true);
  const session = f.calls.find((item) => item.method === 'portal.session')!
    .args[0] as Stripe.BillingPortal.SessionCreateParams;
  assert.equal(session.configuration, 'bpc_safe');
  configuration.features.subscription_update!.enabled = true;
  await assert.rejects(
    f.gateway.createPortal(f.billing),
    /configuration is unsafe/
  );
  assert.equal(
    f.calls.filter((item) => item.method === 'portal.session').length,
    1
  );
});

test('Stripe invoice normalization distinguishes an unattempted draft from a failed charge and a later successful retry', async () => {
  const f = fixture();
  const invoice = {
    id: 'in_renewal',
    subscription: 'sub_one',
    customer: 'cus_one',
    status: 'draft',
    paid: false,
    attempt_count: 0,
    last_finalization_error: null,
    currency: 'usd',
    subtotal: 19900,
    subtotal_excluding_tax: 19900,
    billing_reason: 'subscription_cycle',
    status_transitions: { paid_at: null as number | null },
    lines: {
      data: [
        {
          type: 'subscription',
          price: { id: 'price_usd_month' },
          period: { start: 1906502400, end: 1909180800 },
        },
      ],
    },
  };
  Object.assign(f.mock.invoices, { retrieve: async () => invoice });
  Object.assign(f.subscription, {
    metadata: {
      flow: 'whataisle_store_v1',
      wa_owner_id: 'one',
      wa_checkout_id: 'attempt-one',
    },
  });
  const event = {
    id: 'evt_any_delivery_order',
    type: 'invoice.payment_failed',
    data: { object: { id: invoice.id } },
  } as unknown as Stripe.Event;
  assert.equal(
    (await f.gateway.readEvent(event))!.invoice!.paymentFailed,
    false
  );
  invoice.status = 'open';
  invoice.attempt_count = 1;
  assert.equal(
    (await f.gateway.readEvent(event))!.invoice!.paymentFailed,
    true
  );
  invoice.status = 'paid';
  invoice.paid = true;
  invoice.status_transitions.paid_at = 1906502500;
  const recovered = (await f.gateway.readEvent(event))!.invoice!;
  assert.equal(recovered.paid, true);
  assert.equal(
    recovered.paymentFailed,
    false,
    'Stale failure deliveries read the successful current invoice'
  );
});
