import { expect, test } from '@playwright/test';

/** Signature rejection must never grant entitlement. Valid event delivery and
 * retries are exercised by the billing service/gateway suites. */

const FORGED_EVENT = JSON.stringify({
  id: 'evt_e2e_forged',
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_e2e_forged',
      object: 'checkout.session',
      payment_status: 'paid',
      metadata: { userId: 'e2e-attacker', planId: 'lifetime' },
    },
  },
});

test.describe('stripe webhook signature enforcement', () => {
  test('a request with no signature is rejected outright', async ({
    request,
  }) => {
    const res = await request.post('/api/webhooks/stripe', {
      headers: { 'content-type': 'application/json' },
      data: FORGED_EVENT,
    });
    // Missing signature and missing payload share this guard, and it is the
    // one case that does answer 4xx: nothing was delivered, so there is
    // nothing for Stripe to retry.
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('Missing payload or signature');
  });

  test('a forged signature is not processed', async ({ request }) => {
    const res = await request.post('/api/webhooks/stripe', {
      headers: {
        'content-type': 'application/json',
        // Shape-correct but not derived from the signing secret.
        'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
      },
      data: FORGED_EVENT,
    });

    // A rejected signature is an HTTP failure, not a successful fulfillment.
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid signature');
    expect(body.received).toBeUndefined();
  });
});
