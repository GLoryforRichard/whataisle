'use server';

import { userActionClient } from '@/lib/safe-action';
import { hasAcceptedCurrentTerms } from '@/lib/terms';
import {
  getOwnerBilling,
  getStoreBillingService,
  hasLegacyStoreSubscription,
} from '@/payment/store-billing';
import { StoreOfferError, billingAccess } from '@/payment/store-billing/model';
import { z } from 'zod';

export const getStoreBillingAction = userActionClient
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    const billing = await getOwnerBilling(ctx.user.id);
    return {
      success: true,
      billing,
      access: billingAccess(billing, new Date()),
      legacySubscription:
        !billing?.lastPaidAt && (await hasLegacyStoreSubscription(ctx.user.id)),
    };
  });

export const createStoreBillingPortalAction = userActionClient
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => ({
    success: true,
    url: await getStoreBillingService().createPortal(ctx.user.id),
  }));

export const createStoreCheckoutAction = userActionClient
  .inputSchema(
    z.object({
      requestId: z.uuid(),
      plan: z.enum(['month', 'year']),
      promoCode: z.string().max(96).optional(),
      locale: z.enum(['en', 'zh']).optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    if (!ctx.user.emailVerified)
      throw new Error(
        'Please verify your email before paying / 请先验证邮箱再付款'
      );
    if (!(await hasAcceptedCurrentTerms(ctx.user.id)))
      throw new Error(
        'Please accept the current terms in your dashboard before paying / 请先在控制台确认最新服务条款'
      );
    const checkout = await getStoreBillingService().createCheckout(
      ctx.user,
      parsedInput
    );
    return { success: true, ...checkout };
  });

export const previewStoreOfferAction = userActionClient
  .inputSchema(
    z.object({
      plan: z.enum(['month', 'year']),
      promoCode: z.string().max(96).optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    try {
      return {
        success: true as const,
        offer: await getStoreBillingService().previewOffer(
          ctx.user,
          parsedInput
        ),
      };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof StoreOfferError
            ? error.message
            : 'Unable to preview offer; please try again',
      };
    }
  });

export const scheduleStorePlanAction = userActionClient
  .inputSchema(z.object({ plan: z.enum(['month', 'year']) }))
  .action(async ({ parsedInput, ctx }) => ({
    success: true,
    billing: await getStoreBillingService().schedulePlan(
      ctx.user.id,
      parsedInput.plan
    ),
  }));

export const cancelStoreRenewalAction = userActionClient
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => ({
    success: true,
    billing: await getStoreBillingService().cancelRenewal(ctx.user.id),
  }));

export const resumeStoreRenewalAction = userActionClient
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => ({
    success: true,
    billing: await getStoreBillingService().resumeRenewal(ctx.user.id),
  }));
