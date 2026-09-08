import 'server-only';

import { getBaseUrl } from '@/lib/urls';
import { sendEmail } from '@/mail';
import Stripe from 'stripe';
import type { BillingNotice } from './contracts';
import { billingAccess, type BillingOwner } from './model';
import { billingRepository } from './repository';
import { StoreBillingService } from './service';
import { StripeStoreBillingGateway } from './stripe-gateway';

export type { OwnerBilling, StorePlan, StoreCurrency } from './model';

let singleton: {
  service: StoreBillingService;
  gateway: StripeStoreBillingGateway;
} | null = null;

async function sendFailureNotice(owner: BillingOwner, notice: BillingNotice) {
  const date = notice.graceEndsAt.toISOString().slice(0, 10);
  const url = `${getBaseUrl()}/settings/billing`;
  const text = `Your WhatAisle subscription payment could not be completed. Your store remains available until ${date}. Update your payment method at ${url} to keep service running.\n\nWhatAisle 续费未成功。店铺可继续使用至 ${date}，请到账户账单页更新付款方式。`;
  const result = await sendEmail({
    to: owner.email,
    subject: 'WhatAisle: update your payment method / 请更新付款方式',
    text,
    html: `<p>${text.replaceAll('\n', '<br>')}</p>`,
  });
  if (!result.success)
    throw new Error('Subscription failure notice could not be delivered');
}

function runtime() {
  if (!singleton) {
    if (!process.env.STRIPE_SECRET_KEY)
      throw new Error('Billing is not configured: STRIPE_SECRET_KEY');
    const gateway = new StripeStoreBillingGateway(
      new Stripe(process.env.STRIPE_SECRET_KEY),
      getBaseUrl(),
      sendFailureNotice
    );
    singleton = {
      service: new StoreBillingService(billingRepository, gateway, process.env),
      gateway,
    };
  }
  return singleton;
}

export const getStoreBillingService = () => runtime().service;
export const getOwnerBilling = (ownerId: string) =>
  billingRepository.getBilling(ownerId);
export const hasLegacyStoreSubscription = (ownerId: string) =>
  billingRepository.hasLegacySubscription(ownerId);
export const attachStoreToBilling = (ownerId: string, storeId: string) =>
  runtime().service.attachStore(ownerId, storeId);
export const getStoreServiceAccess = async (storeId: string) =>
  billingAccess(await billingRepository.getBillingByStore(storeId), new Date());
export const reconcileStoreBilling = () => runtime().service.reconcile();

/** Returns true for this flow so legacy handlers cannot overwrite new billing
 * semantics or grant access from an uncharged trial/checkout completion. */
export async function handleStoreBillingEvent(event: Stripe.Event) {
  const parsed = await runtime().gateway.readEvent(event);
  if (!parsed) return false;
  await runtime().service.handleEvent(parsed);
  return true;
}
