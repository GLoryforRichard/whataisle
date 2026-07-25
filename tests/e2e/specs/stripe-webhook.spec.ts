import { expect, test } from '@playwright/test';

/**
 * Stripe webhook signature enforcement.
 *
 * This route is the only path that grants paid entitlement, and it is
 * unauthenticated by necessity — the guard is the signature. So the thing
 * worth testing is that an unsigned or forged event cannot get through.
 *
 * Scope note: the *happy* path stays out of E2E, and not for want of
 * fixtures. `constructEvent` verifies locally, but the handlers behind it
 * (onCreateSubscription, checkout completion) call the Stripe API to fetch
 * the session, so a genuinely-signed event would need either network or a
 * mocked Stripe client. Entitlement itself is covered by paywall.spec.ts,
 * which seeds the payment row directly.
 *
 * Also note the route answers 200 to processing failures on purpose — Stripe
 * treats 4xx/5xx as undelivered and retries for three days. So "rejected"
 * here means "did not process", read from the body, not from the status.
 */

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

    // 200 by design (see the note above) — the body is what says it failed.
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.error).toBe('Webhook handler failed');
    expect(body.received).toBe(true);
  });
});
