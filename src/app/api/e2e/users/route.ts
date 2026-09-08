import {
  account,
  apikey,
  creditTransaction,
  payment,
  session,
  user,
  userCredit,
  store,
  storeRuntime,
  storeOwnerEntry,
  storeSubscription,
  storeCheckout,
  storeBillingNotice,
} from '@/db/schema';
import { getDb } from '@/db';
import { isValidE2ETestRequest } from '@/lib/e2e';
import { PaymentScenes, PaymentTypes } from '@/payment/types';
import { inArray, like, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import {
  addCalendarMonths,
  pendingBilling,
} from '@/payment/store-billing/model';

const TEST_EMAIL_PATTERN = 'e2e-%@example.test';

function isE2EEmail(email: string) {
  return email.startsWith('e2e-') && email.endsWith('@example.test');
}

function notFound() {
  return NextResponse.json({ error: 'Not Found' }, { status: 404 });
}

export async function PATCH(request: Request) {
  if (!isValidE2ETestRequest(request)) {
    return notFound();
  }

  const body = (await request.json()) as {
    email?: unknown;
    emailVerified?: unknown;
    role?: unknown;
    hasPaid?: unknown;
  };
  const email = typeof body.email === 'string' ? body.email : '';

  if (!isE2EEmail(email)) {
    return NextResponse.json({ error: 'Invalid test email' }, { status: 400 });
  }

  const updates: {
    emailVerified?: boolean;
    role?: string | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (typeof body.emailVerified === 'boolean') {
    updates.emailVerified = body.emailVerified;
  }
  if (body.role === null || body.role === 'admin' || body.role === 'user') {
    updates.role = body.role === 'user' ? null : body.role;
  }

  const db = await getDb();
  const [updatedUser] = await db
    .update(user)
    .set(updates)
    .where(eq(user.email, email))
    .returning({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
    });

  if (!updatedUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Seed confirmed subscription entitlement for isolated UI journeys. Stripe's
  // real gateway/service is covered separately; no external payment is sent.
  if (body.hasPaid === true) {
    const priceId =
      process.env.NEXT_PUBLIC_STRIPE_PRICE_LIFETIME ?? 'price_e2e_lifetime';
    const existing = await db
      .select({ id: payment.id })
      .from(payment)
      .where(eq(payment.userId, updatedUser.id))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(payment).values({
        id: `e2e-payment-${updatedUser.id}`,
        priceId,
        type: PaymentTypes.ONE_TIME,
        scene: PaymentScenes.LIFETIME,
        userId: updatedUser.id,
        customerId: 'e2e-customer',
        sessionId: `cs_e2e_${updatedUser.id}`,
        status: 'completed',
        paid: true,
      });
    }
    const now = new Date();
    const initial = pendingBilling(
      {
        plan: 'month',
        currency: 'usd',
        isTest: false,
        amount: 19900,
        priceId: 'price_e2e_month',
      },
      updatedUser.id,
      now
    );
    await db
      .insert(storeSubscription)
      .values({
        ...initial,
        status: 'active',
        periodStart: now,
        entitlementEnd: addCalendarMonths(now, 3),
        giftUsedAt: now,
        lastPaidAt: now,
      })
      .onConflictDoNothing();
  }

  return NextResponse.json({
    user: updatedUser,
    checkoutSessionId:
      body.hasPaid === true ? `cs_e2e_${updatedUser.id}` : null,
  });
}

export async function DELETE(request: Request) {
  if (!isValidE2ETestRequest(request)) {
    return notFound();
  }

  const email = new URL(request.url).searchParams.get('email');
  // Preparation fixtures delete only their own account. A present but invalid
  // filter must never fall through to the legacy all-E2E cleanup below.
  if (email !== null && !isE2EEmail(email)) {
    return NextResponse.json({ error: 'Invalid test email' }, { status: 400 });
  }

  const db = await getDb();
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(
      email === null
        ? like(user.email, TEST_EMAIL_PATTERN)
        : eq(user.email, email)
    );
  const userIds = rows.map((row) => row.id);

  if (userIds.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  await db.delete(apikey).where(inArray(apikey.userId, userIds));
  await db.delete(session).where(inArray(session.userId, userIds));
  await db.delete(account).where(inArray(account.userId, userIds));
  await db
    .delete(creditTransaction)
    .where(inArray(creditTransaction.userId, userIds));
  await db.delete(userCredit).where(inArray(userCredit.userId, userIds));
  await db.delete(payment).where(inArray(payment.userId, userIds));
  const tenantRows = await db
    .select({ id: store.id })
    .from(store)
    .where(inArray(store.ownerUserId, userIds));
  const storeIds = tenantRows.map((row) => row.id);
  if (storeIds.length) {
    await db
      .delete(storeOwnerEntry)
      .where(inArray(storeOwnerEntry.storeId, storeIds));
    await db
      .delete(storeRuntime)
      .where(inArray(storeRuntime.storeId, storeIds));
  }
  await db
    .delete(storeCheckout)
    .where(inArray(storeCheckout.ownerUserId, userIds));
  await db
    .delete(storeBillingNotice)
    .where(inArray(storeBillingNotice.ownerUserId, userIds));
  await db
    .delete(storeSubscription)
    .where(inArray(storeSubscription.ownerUserId, userIds));
  await db.delete(user).where(inArray(user.id, userIds));

  return NextResponse.json({ deleted: userIds.length });
}
