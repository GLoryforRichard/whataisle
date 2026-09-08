import { handleWebhookEvent } from '@/payment';
import { type NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

/**
 * Stripe webhook handler
 * This endpoint receives webhook events from Stripe and processes them
 *
 * @param req The incoming request
 * @returns NextResponse
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Get the request body as text
  const payload = await req.text();

  // Get the Stripe signature from headers
  const signature = req.headers.get('stripe-signature') || '';

  try {
    // Validate inputs
    if (!payload || !signature) {
      console.warn('Stripe webhook: missing payload or signature');
      return NextResponse.json(
        { error: 'Missing payload or signature' },
        { status: 400 }
      );
    }

    // Process the webhook event
    await handleWebhookEvent(payload, signature);

    // Return success
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('Error in webhook route:', error);

    // Failed fulfillment must be retried: acknowledging it loses paid orders.
    // The subscription service commits its event key together with fulfillment.
    const invalidSignature =
      error instanceof Stripe.errors.StripeSignatureVerificationError;
    return NextResponse.json(
      {
        error: invalidSignature
          ? 'Invalid signature'
          : 'Webhook processing failed; retry required',
      },
      { status: invalidSignature ? 400 : 503 }
    );
  }
}
