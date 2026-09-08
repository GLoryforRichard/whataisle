/** Real Stripe TEST-mode acceptance. Disabled in ordinary unit runs.
 * Requires explicit approval to pause/restore the existing TEST webhook:
 * STORE_BILLING_SANDBOX_APPROVED=1 node --env-file=.env --import tsx --test
 *   tests/unit/store-billing-sandbox.test.ts
 * Recovery after a killed process (same previously approved scope):
 * STORE_BILLING_SANDBOX_CLEANUP_REPORT=/absolute/.env.stripe-sandbox-....json
 *   node --env-file=.env --import tsx --test tests/unit/store-billing-sandbox.test.ts
 * The runner publishes hosted Checkout URLs only in a 0600 ignored report;
 * complete each with a fresh isolated Playwright session and Stripe test card.
 * It never registers real email accounts, modifies live Stripe objects, changes
 * existing prices, or sends mail. Tests use only the existing local :5433 DB.
 * API reference: docs.stripe.com/billing/testing/test-clocks/api-advanced-usage
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { inArray } from 'drizzle-orm';
import Stripe from 'stripe';
import type {
  BillingRepository,
  BillingTransaction,
} from '../../src/payment/store-billing/contracts';
import {
  type BillingOwner,
  type OwnerBilling,
  type StorePlan,
  addCalendarMonths,
  billingAccess,
  pendingBilling,
  resolveOffer,
} from '../../src/payment/store-billing/model';
import { StoreBillingService } from '../../src/payment/store-billing/service';
import { StripeStoreBillingGateway } from '../../src/payment/store-billing/stripe-gateway';

interface SandboxReport {
  task: string;
  accountId: string;
  path: string;
  startedAt: string;
  endpoint: {
    id: string;
    url: string;
    events: string[];
    originallyEnabled: boolean;
    paused: boolean;
  } | null;
  productIds: string[];
  priceIds: string[];
  clockIds: string[];
  customerIds: string[];
  ownerIds: string[];
  sessionIds: string[];
  eventIds: string[];
  checks: string[];
  awaitingCheckout: { scenario: string; sessionId: string; url: string } | null;
  errors: string[];
  cleaned: boolean;
}

const enabled = process.env.STORE_BILLING_SANDBOX_APPROVED === '1';
const recoveryPath = process.env.STORE_BILLING_SANDBOX_CLEANUP_REPORT;

test(
  'Stripe TEST sandbox: real Checkout, calendar periods, scheduled switches, renewals, cancellation and recovery',
  { skip: !enabled && !recoveryPath, timeout: 30 * 60 * 1000 },
  async () => {
    const key = process.env.STRIPE_SECRET_KEY;
    assert.ok(
      key && /^(sk|rk)_test_/.test(key),
      'A TEST key is mandatory; live keys are refused'
    );
    const target = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
    assert.ok(
      ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) &&
        target.port === '5433',
      'Only the existing local test database on :5433 is permitted'
    );
    const stripe = new Stripe(key, { timeout: 12000, maxNetworkRetries: 1 });
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        return nextResolve(
          specifier === 'server-only'
            ? 'next/dist/compiled/server-only/empty.js'
            : specifier,
          context
        );
      },
    });
    const require = createRequire(import.meta.url);
    const { getDb } = require('../../src/db') as typeof import('../../src/db');
    const { user } =
      require('../../src/db/auth.schema') as typeof import('../../src/db/auth.schema');
    const { payment } =
      require('../../src/db/app.schema') as typeof import('../../src/db/app.schema');
    const {
      storeSubscription,
      storeCheckout,
      storeBillingEvent,
      storeBillingNotice,
    } =
      require('../../src/db/subscription.schema') as typeof import('../../src/db/subscription.schema');
    const { billingRepository } =
      require('../../src/payment/store-billing/repository') as typeof import('../../src/payment/store-billing/repository');
    const db = await getDb();
    const account = await stripe.accounts.retrieve();
    const report: SandboxReport = recoveryPath
      ? (JSON.parse(readFileSync(recoveryPath, 'utf8')) as SandboxReport)
      : {
          task: `wa-billing-${randomUUID()}`,
          accountId: account.id,
          path: resolve(`.env.stripe-sandbox-${Date.now()}.json`),
          startedAt: new Date().toISOString(),
          endpoint: null,
          productIds: [],
          priceIds: [],
          clockIds: [],
          customerIds: [],
          ownerIds: [],
          sessionIds: [],
          eventIds: [],
          checks: [],
          awaitingCheckout: null,
          errors: [],
          cleaned: false,
        };
    assert.equal(
      report.accountId,
      account.id,
      'Recovery refuses a different Stripe account'
    );
    assert.match(report.task, /^wa-billing-[a-f0-9-]+$/);
    assert.ok(
      report.path.includes('.env.stripe-sandbox-'),
      'Only a task-owned private report is accepted'
    );
    function persist() {
      writeFileSync(report.path, `${JSON.stringify(report, null, 2)}\n`, {
        mode: 0o600,
      });
      chmodSync(report.path, 0o600);
    }
    if (!recoveryPath)
      writeFileSync(report.path, '{}\n', { mode: 0o600, flag: 'wx' });
    persist();
    console.log(`Private sandbox report: ${report.path}`);
    const apiError = (error: unknown) =>
      error instanceof Stripe.errors.StripeError
        ? `${error.type}: ${error.code ?? 'no-code'}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Unknown failure';
    async function pause(ms: number) {
      await new Promise((done) => setTimeout(done, ms));
    }
    async function check(name: string, run: () => Promise<void>) {
      await run();
      report.checks.push(name);
      persist();
      console.log(`PASS ${name}`);
    }

    async function cleanup() {
      const failures: string[] = [];
      let billingFixturesUncertain = false;
      async function attempt(name: string, run: () => Promise<unknown>) {
        try {
          await run();
        } catch (error) {
          if (
            error instanceof Stripe.errors.StripeInvalidRequestError &&
            error.code === 'resource_missing'
          )
            return;
          failures.push(`${name}: ${apiError(error)}`);
        }
      }
      // Recover objects whose create request succeeded remotely before a crash
      // could persist the response. Discovery is bounded by the task metadata.
      await attempt('discover task products', async () => {
        for await (const product of stripe.products.list({ limit: 100 })) {
          if (
            product.metadata.codex_task === report.task &&
            !report.productIds.includes(product.id)
          )
            report.productIds.push(product.id);
        }
      });
      const beforeClockDiscovery = failures.length;
      await attempt('discover task clocks', async () => {
        for await (const clock of stripe.testHelpers.testClocks.list({
          limit: 100,
        })) {
          if (
            clock.name?.startsWith(`${report.task}:`) &&
            !report.clockIds.includes(clock.id)
          )
            report.clockIds.push(clock.id);
        }
      });
      if (failures.length > beforeClockDiscovery)
        billingFixturesUncertain = true;
      for (const productId of report.productIds)
        await attempt('discover task prices', async () => {
          for await (const price of stripe.prices.list({
            product: productId,
            limit: 100,
          })) {
            if (
              price.metadata.codex_task === report.task &&
              !report.priceIds.includes(price.id)
            )
              report.priceIds.push(price.id);
          }
        });
      for (const clockId of report.clockIds)
        await attempt('discover task clock customers', async () => {
          for await (const customer of stripe.customers.list({
            test_clock: clockId,
            limit: 100,
          })) {
            if (
              customer.metadata.codex_task === report.task &&
              !report.customerIds.includes(customer.id)
            )
              report.customerIds.push(customer.id);
          }
        });
      persist();
      assert.ok(
        report.ownerIds.every((id) => id.startsWith(`${report.task}-`)),
        'Only task fixture database rows may be removed'
      );
      // All deletions/cancellations happen while the TEST webhook remains paused.
      for (const id of report.sessionIds)
        await attempt('expire task checkout', async () => {
          const item = await stripe.checkout.sessions.retrieve(id);
          assert.ok(report.ownerIds.includes(item.metadata?.wa_owner_id ?? ''));
          if (item.status === 'open') await stripe.checkout.sessions.expire(id);
        });
      for (const id of report.clockIds) {
        const before = failures.length;
        await attempt('delete task clock and its subscriptions', async () => {
          const clock = await stripe.testHelpers.testClocks.retrieve(id);
          assert.ok(clock.name?.startsWith(`${report.task}:`));
          await stripe.testHelpers.testClocks.del(id);
        });
        if (failures.length > before) billingFixturesUncertain = true;
      }
      for (const id of report.customerIds) {
        const before = failures.length;
        await attempt('delete remaining task customer', async () => {
          const customer = await stripe.customers.retrieve(id);
          if (!customer.deleted) {
            assert.equal(customer.metadata.codex_task, report.task);
            await stripe.customers.del(id);
          }
        });
        if (failures.length > before) billingFixturesUncertain = true;
      }
      for (const id of report.priceIds)
        await attempt('archive task price', async () => {
          const price = await stripe.prices.retrieve(id);
          assert.equal(price.livemode, false);
          assert.equal(price.metadata.codex_task, report.task);
          await stripe.prices.update(id, { active: false });
        });
      for (const id of report.productIds)
        await attempt('archive task product', async () => {
          const product = await stripe.products.retrieve(id);
          assert.equal(product.livemode, false);
          assert.equal(product.metadata.codex_task, report.task);
          await stripe.products.update(id, { active: false });
        });
      if (report.eventIds.length)
        await attempt('remove task webhook receipts', () =>
          db
            .delete(storeBillingEvent)
            .where(inArray(storeBillingEvent.id, report.eventIds))
        );
      if (report.ownerIds.length) {
        await attempt('remove task notices', () =>
          db
            .delete(storeBillingNotice)
            .where(inArray(storeBillingNotice.ownerUserId, report.ownerIds))
        );
        await attempt('remove task payments', () =>
          db.delete(payment).where(inArray(payment.userId, report.ownerIds))
        );
        await attempt('remove task checkouts', () =>
          db
            .delete(storeCheckout)
            .where(inArray(storeCheckout.ownerUserId, report.ownerIds))
        );
        await attempt('remove task subscriptions', () =>
          db
            .delete(storeSubscription)
            .where(inArray(storeSubscription.ownerUserId, report.ownerIds))
        );
        await attempt('remove synthetic local accounts', () =>
          db.delete(user).where(inArray(user.id, report.ownerIds))
        );
      }
      // Restore after ordinary test failures, but retain the pause if Stripe
      // cannot confirm that task billing objects were removed. Recovery retries
      // cleanup before restoring. Never modify URL, secrets, API version/events.
      if (
        report.endpoint?.paused &&
        report.endpoint.originallyEnabled &&
        !billingFixturesUncertain
      ) {
        await attempt('restore original TEST webhook status', async () => {
          const endpoint = await stripe.webhookEndpoints.retrieve(
            report.endpoint!.id
          );
          assert.equal(endpoint.livemode, false);
          assert.equal(endpoint.url, report.endpoint!.url);
          assert.deepEqual(
            [...endpoint.enabled_events].sort(),
            [...report.endpoint!.events].sort()
          );
          await stripe.webhookEndpoints.update(endpoint.id, {
            disabled: false,
          });
          report.endpoint!.paused = false;
        });
      }
      if (billingFixturesUncertain)
        failures.push(
          'TEST webhook remains paused until billing fixture cleanup is confirmed; rerun cleanup'
        );
      report.awaitingCheckout = null;
      report.errors.push(...failures);
      report.cleaned = failures.length === 0;
      persist();
      if (failures.length)
        throw new Error(
          'Sandbox cleanup needs follow-up; inspect the restricted report'
        );
    }

    interface Context {
      owner: BillingOwner;
      clockId: string;
      customerId: string;
      now: Date;
      gateway: StripeStoreBillingGateway;
      service: StoreBillingService;
    }
    const environments: Record<string, string | undefined> = {
      STORE_BILLING_BONUS_CODE: 'FIELD2',
    };
    function scopedRepository(ownerId: string): BillingRepository {
      // Use the real PostgreSQL implementation while restricting maintenance to
      // this fixture; never call Stripe on pre-existing local development rows.
      return {
        getBilling: (id) => billingRepository.getBilling(id),
        getBillingByStore: (id) => billingRepository.getBillingByStore(id),
        hasLegacySubscription: (id) =>
          billingRepository.hasLegacySubscription(id),
        hasPriorPayment: (id) => billingRepository.hasPriorPayment(id),
        transaction: <T>(run: (tx: BillingTransaction) => Promise<T>) =>
          billingRepository.transaction((tx) =>
            run({
              ...tx,
              // Synthetic sandbox customers do not deploy stores. Ignore
              // unrelated local demo tenants when testing Stripe contracts.
              getCapacitySnapshot: async () => ({
                ...(await tx.getCapacitySnapshot()),
                stores: [],
              }),
              getAllBillings: async () =>
                (await tx.getAllBillings()).filter(
                  (item) => item.ownerUserId === ownerId
                ),
              getCheckouts: async () =>
                (await tx.getCheckouts()).filter(
                  (item) => item.ownerUserId === ownerId
                ),
              getNotices: async () =>
                (await tx.getNotices()).filter(
                  (item) => item.ownerUserId === ownerId
                ),
            })
          ),
      };
    }
    async function context(scenario: string, plan: StorePlan, promo?: string) {
      const clock = await stripe.testHelpers.testClocks.create({
        frozen_time: Math.floor(Date.now() / 1000),
        name: `${report.task}: ${scenario}`,
      });
      report.clockIds.push(clock.id);
      persist();
      const owner = {
        id: `${report.task}-${scenario}`,
        email: `${report.task}-${scenario}@example.test`,
        name: 'WhatAisle synthetic Stripe acceptance',
      };
      const customer = await stripe.customers.create({
        email: owner.email,
        name: owner.name,
        test_clock: clock.id,
        metadata: { codex_task: report.task, scenario },
        address: {
          country: 'CA',
          line1: '123 Test Street',
          city: 'Toronto',
          state: 'ON',
          postal_code: 'M5V 2T6',
        },
      });
      report.customerIds.push(customer.id);
      report.ownerIds.push(owner.id);
      persist();
      await db.insert(user).values({
        ...owner,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      environments.STORE_BILLING_TEST_EMAILS = [
        environments.STORE_BILLING_TEST_EMAILS,
        owner.email,
      ]
        .filter(Boolean)
        .join(',');
      const offer = resolveOffer(plan, promo, owner.email, environments, null);
      await db.insert(storeSubscription).values({
        ...pendingBilling(offer, owner.id, new Date(clock.frozen_time * 1000)),
        stripeCustomerId: customer.id,
      });
      const ctx = {
        owner,
        clockId: clock.id,
        customerId: customer.id,
        now: new Date(clock.frozen_time * 1000),
      } as Context;
      ctx.gateway = new StripeStoreBillingGateway(
        stripe,
        'http://localhost:3100',
        async () => {},
        () => ctx.now
      );
      ctx.service = new StoreBillingService(
        scopedRepository(owner.id),
        ctx.gateway,
        environments,
        () => ctx.now
      );
      return ctx;
    }
    async function checkout(ctx: Context, plan: StorePlan, promoCode?: string) {
      // Checkout expiration is wall-clock time, independently of the simulated
      // customer's billing clock. Restore the simulated clock before settlement.
      const simulated = ctx.now;
      ctx.now = new Date();
      let result: { url: string; sessionId: string };
      try {
        result = await ctx.service.createCheckout(ctx.owner, {
          plan,
          promoCode,
          requestId: randomUUID(),
          locale: 'en',
        });
      } finally {
        ctx.now = simulated;
      }
      report.sessionIds.push(result.sessionId);
      report.awaitingCheckout = {
        scenario: ctx.owner.id.split('-').at(-1)!,
        sessionId: result.sessionId,
        url: result.url,
      };
      persist();
      console.log(
        'CHECKOUT_READY: complete the test card form using the URL in the private report.'
      );
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        const session = await stripe.checkout.sessions.retrieve(
          result.sessionId
        );
        if (
          session.status === 'complete' &&
          session.payment_status === 'paid'
        ) {
          const eventId = `${report.task}:${randomUUID()}`;
          report.eventIds.push(eventId);
          persist();
          const parsed = await ctx.gateway.readEvent({
            id: eventId,
            type: 'checkout.session.completed',
            data: { object: session },
          } as unknown as Stripe.Event);
          assert.ok(parsed);
          await ctx.service.handleEvent(parsed);
          report.awaitingCheckout = null;
          persist();
          const billing = (await ctx.service.getOwnerBilling(ctx.owner.id))!;
          assert.ok(
            billing.lastPaidAt &&
              billing.entitlementEnd &&
              billing.stripeSubscriptionId
          );
          assert.ok(billingAccess(billing, ctx.now).accessAllowed);
          const recorded = await db
            .select()
            .from(payment)
            .where(inArray(payment.sessionId, [result.sessionId]));
          assert.ok(
            recorded.some((item) => item.paid && item.userId === ctx.owner.id)
          );
          return billing;
        }
        if (session.status === 'expired')
          throw new Error('The test Checkout expired before completion');
        await pause(1000);
      }
      throw new Error('Timed out awaiting isolated test Checkout completion');
    }
    async function advance(ctx: Context, targetDate: Date) {
      while (ctx.now < targetDate) {
        const next = Math.min(
          targetDate.getTime(),
          ctx.now.getTime() + 56 * 86400000
        );
        await stripe.testHelpers.testClocks.advance(ctx.clockId, {
          frozen_time: Math.floor(next / 1000),
        });
        const deadline = Date.now() + 60000;
        while (true) {
          const clock = await stripe.testHelpers.testClocks.retrieve(
            ctx.clockId
          );
          if (clock.status === 'ready') {
            ctx.now = new Date(clock.frozen_time * 1000);
            break;
          }
          if (clock.status === 'internal_failure' || Date.now() >= deadline)
            throw new Error('Test clock did not become ready');
          await pause(500);
        }
      }
    }
    async function sync(ctx: Context) {
      const billing = (await ctx.service.getOwnerBilling(ctx.owner.id))!;
      const snapshot = await ctx.gateway.getSubscription(
        billing.stripeSubscriptionId!
      );
      const id = `${report.task}:${randomUUID()}`;
      report.eventIds.push(id);
      persist();
      await ctx.service.handleEvent({
        id,
        kind: 'subscription',
        checkoutId: snapshot.checkoutId,
        subscription: snapshot,
      });
      return (await ctx.service.getOwnerBilling(ctx.owner.id))!;
    }
    async function chargedInvoices(billing: OwnerBilling) {
      const rows = await stripe.invoices.list({
        subscription: billing.stripeSubscriptionId!,
        limit: 100,
      });
      return rows.data.filter(
        (item) => item.status === 'paid' && item.amount_paid > 0
      );
    }
    async function replaceCard(
      ctx: Context,
      card: 'pm_card_visa' | 'pm_card_chargeCustomerFail'
    ) {
      const method = await stripe.paymentMethods.attach(card, {
        customer: ctx.customerId,
      });
      await stripe.customers.update(ctx.customerId, {
        invoice_settings: { default_payment_method: method.id },
      });
      const billing = (await ctx.service.getOwnerBilling(ctx.owner.id))!;
      if (billing.stripeSubscriptionId && billing.status !== 'suspended')
        await stripe.subscriptions.update(billing.stripeSubscriptionId, {
          default_payment_method: method.id,
        });
    }

    try {
      if (recoveryPath) {
        await cleanup();
        return;
      }
      const endpoints = (await stripe.webhookEndpoints.list({ limit: 100 }))
        .data;
      const active = endpoints.filter(
        (item) => !item.livemode && item.status === 'enabled'
      );
      assert.equal(
        active.length,
        1,
        'Review again if there is more than the one approved active TEST endpoint'
      );
      const endpoint = active[0]!;
      assert.equal(new URL(endpoint.url).hostname, 'whataisle.com');
      report.endpoint = {
        id: endpoint.id,
        url: endpoint.url,
        events: [...endpoint.enabled_events],
        originallyEnabled: true,
        paused: false,
      };
      persist();
      // Persist the restoration obligation before the external mutation, so a
      // dropped response/crash cannot lose the fact that delivery may be paused.
      report.endpoint.paused = true;
      persist();
      await stripe.webhookEndpoints.update(endpoint.id, { disabled: true });
      assert.equal(
        (await stripe.webhookEndpoints.retrieve(endpoint.id)).status,
        'disabled'
      );
      const product = await stripe.products.create({
        name: 'WhatAisle isolated billing acceptance',
        metadata: { codex_task: report.task },
      });
      report.productIds.push(product.id);
      persist();
      for (const [currency, amount, plan, envName] of [
        ['usd', 19900, 'month', 'STRIPE_PRICE_USD_MONTH'],
        ['usd', 199900, 'year', 'STRIPE_PRICE_USD_YEAR'],
        ['cad', 19900, 'month', 'STRIPE_PRICE_CAD_MONTH'],
        ['cad', 199900, 'year', 'STRIPE_PRICE_CAD_YEAR'],
        ['cad', 100, 'month', 'STRIPE_PRICE_CAD_TEST_MONTH'],
      ] as const) {
        const price = await stripe.prices.create({
          product: product.id,
          currency,
          unit_amount: amount,
          recurring: { interval: plan },
          tax_behavior: 'exclusive',
          metadata: { codex_task: report.task },
        });
        assert.equal(price.livemode, false);
        report.priceIds.push(price.id);
        environments[envName] = price.id;
        persist();
      }
      await check(
        'USD monthly offline bonus grants three calendar months and writes the successful Checkout callback record',
        async () => {
          const ctx = await context('usd', 'month', 'FIELD2');
          const initial = await checkout(ctx, 'month', 'FIELD2');
          assert.deepEqual(
            initial.entitlementEnd,
            addCalendarMonths(initial.lastPaidAt!, 3)
          );
          assert.equal((await chargedInvoices(initial)).length, 1);
          const changed = await ctx.service.schedulePlan(ctx.owner.id, 'year');
          assert.deepEqual(changed.entitlementEnd, initial.entitlementEnd);
          assert.equal((await chargedInvoices(initial)).length, 1);
          await advance(
            ctx,
            new Date(initial.entitlementEnd!.getTime() + 7200000)
          );
          const annual = await sync(ctx);
          assert.equal(annual.plan, 'year');
          assert.deepEqual(
            annual.entitlementEnd,
            addCalendarMonths(initial.entitlementEnd!, 12)
          );
          assert.equal(
            (await chargedInvoices(annual)).filter(
              (item) => item.subtotal === 199900
            ).length,
            1
          );
          await ctx.service.schedulePlan(ctx.owner.id, 'month');
          await ctx.service.cancelRenewal(ctx.owner.id);
          const canceled = (await ctx.service.getOwnerBilling(ctx.owner.id))!;
          assert.equal(canceled.pendingPlan, null);
          assert.deepEqual(canceled.entitlementEnd, annual.entitlementEnd);
          const count = (await chargedInvoices(canceled)).length;
          await advance(
            ctx,
            new Date(canceled.entitlementEnd!.getTime() + 7200000)
          );
          await ctx.service.reconcile();
          assert.equal(
            (await ctx.service.getOwnerBilling(ctx.owner.id))!.status,
            'suspended'
          );
          assert.equal((await chargedInvoices(canceled)).length, count);
        }
      );
      await check(
        'INCAD plus offline bonus grants fourteen months then switches to CAD monthly without a second gift',
        async () => {
          const ctx = await context('cad', 'year', 'INCAD FIELD2');
          const initial = await checkout(ctx, 'year', 'INCAD FIELD2');
          assert.equal(initial.currency, 'cad');
          assert.deepEqual(
            initial.entitlementEnd,
            addCalendarMonths(initial.lastPaidAt!, 14)
          );
          await ctx.service.schedulePlan(ctx.owner.id, 'month');
          await advance(
            ctx,
            new Date(initial.entitlementEnd!.getTime() + 7200000)
          );
          const monthly = await sync(ctx);
          assert.equal(monthly.plan, 'month');
          assert.deepEqual(
            monthly.entitlementEnd,
            addCalendarMonths(initial.entitlementEnd!, 1)
          );
          assert.deepEqual(monthly.giftUsedAt, initial.giftUsedAt);
          assert.equal(
            (await chargedInvoices(monthly)).filter(
              (item) => item.subtotal === 19900
            ).length,
            1
          );
        }
      );
      await check(
        'CAD 1 renews without consuming openings; failed renewal gets seven days then no arrears; recovery starts a fresh month',
        async () => {
          const ctx = await context('test', 'month', '1CADTEST');
          const initial = await checkout(ctx, 'month', '1CADTEST');
          assert.equal(initial.giftUsedAt, null);
          assert.deepEqual(
            initial.entitlementEnd,
            addCalendarMonths(initial.lastPaidAt!, 1)
          );
          await advance(
            ctx,
            new Date(initial.entitlementEnd!.getTime() + 7200000)
          );
          const renewed = await sync(ctx);
          assert.equal((await chargedInvoices(renewed)).length, 2);
          await replaceCard(ctx, 'pm_card_chargeCustomerFail');
          await advance(
            ctx,
            new Date(renewed.entitlementEnd!.getTime() + 7200000)
          );
          const failed = await sync(ctx);
          assert.equal(failed.status, 'grace');
          assert.equal(
            failed.graceEndsAt!.getTime() - renewed.entitlementEnd!.getTime(),
            7 * 86400000
          );
          assert.equal(billingAccess(failed, ctx.now).accessAllowed, true);
          await advance(ctx, failed.graceEndsAt!);
          await ctx.service.reconcile();
          const suspended = (await ctx.service.getOwnerBilling(ctx.owner.id))!;
          assert.equal(suspended.status, 'suspended');
          assert.deepEqual(
            suspended.retentionUntil,
            addCalendarMonths(suspended.suspendedAt!, 3)
          );
          assert.equal(
            (
              await stripe.invoices.list({
                subscription: suspended.stripeSubscriptionId!,
                status: 'open',
              })
            ).data.length,
            0
          );
          await advance(ctx, new Date(ctx.now.getTime() + 86400000));
          await replaceCard(ctx, 'pm_card_visa');
          const recovered = await checkout(ctx, 'month', '1CADTEST');
          assert.deepEqual(
            recovered.entitlementEnd,
            addCalendarMonths(recovered.lastPaidAt!, 1)
          );
          assert.equal(recovered.giftUsedAt, null);
          const attempts = await db
            .select()
            .from(storeCheckout)
            .where(inArray(storeCheckout.ownerUserId, [ctx.owner.id]));
          assert.equal(
            attempts.filter((item) => item.status === 'paid').length,
            2
          );
        }
      );
    } catch (error) {
      report.errors.push(apiError(error));
      persist();
      throw new Error(
        'Stripe sandbox acceptance failed; details are in the restricted report'
      );
    } finally {
      try {
        if (!report.cleaned) await cleanup();
      } finally {
        await (
          db as unknown as {
            $client: { end(options: { timeout: number }): Promise<void> };
          }
        ).$client.end({ timeout: 5 });
        hooks.deregister();
      }
    }
  }
);
