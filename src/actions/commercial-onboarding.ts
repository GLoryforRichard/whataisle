'use server';

import { getDb } from '@/db';
import { salesLead, storeInvite } from '@/db/store.schema';
import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit, hashIp } from '@/lib/rate-limit';
import { adminActionClient, actionClient } from '@/lib/safe-action';
import { createInviteToken, hashInviteToken } from '@/lib/store-invites';
import { getBaseUrl } from '@/lib/urls';
import { sendEmail } from '@/mail';
import { and, desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const leadSchema = z.object({
  storeName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(100),
  email: z.email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(30).optional(),
  city: z.string().trim().min(2).max(100),
  province: z.string().trim().min(2).max(80),
  storeCount: z.number().int().min(1).max(100),
  preferredLanguage: z.enum(['en', 'zh']),
  message: z.string().trim().max(1000).optional(),
  marketingConsent: z.boolean(),
});

export const submitSalesLeadAction = actionClient
  .schema(leadSchema)
  .action(async ({ parsedInput }) => {
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const reporterHash = hashIp(ip, 'sales-lead');
    const allowed = await checkRateLimit(`lead:${reporterHash}`, {
      windowSeconds: 60 * 60,
      max: 5,
    });
    if (!allowed) {
      return { success: false as const, error: 'rate_limited' as const };
    }

    const db = await getDb();
    await db.insert(salesLead).values({
      id: nanoid(),
      ...parsedInput,
      phone: parsedInput.phone || null,
      message: parsedInput.message || null,
      marketingConsentAt: parsedInput.marketingConsent ? new Date() : null,
      reporterHash,
    });

    await sendEmail({
      to: 'WhatAisle <support@whataisle.com>',
      subject: `Demo request: ${parsedInput.storeName}`,
      html: `<p>New demo request from ${parsedInput.contactName} (${parsedInput.email}).</p><p>${parsedInput.city}, ${parsedInput.province} · ${parsedInput.storeCount} store(s) · ${parsedInput.preferredLanguage}</p>`,
    }).catch(() => {});

    return { success: true as const };
  });

const inviteSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
});

export const createStoreInviteAction = adminActionClient
  .schema(inviteSchema)
  .action(async ({ parsedInput, ctx }) => {
    const db = await getDb();
    await db
      .update(storeInvite)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(storeInvite.email, parsedInput.email),
          eq(storeInvite.status, 'pending')
        )
      );

    const token = createInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.insert(storeInvite).values({
      id: nanoid(),
      email: parsedInput.email,
      tokenHash: hashInviteToken(token),
      createdByUserId: ctx.user.id,
      expiresAt,
    });

    const inviteUrl = `${getBaseUrl()}/auth/register?invite=${encodeURIComponent(token)}`;
    const result = await sendEmail({
      to: parsedInput.email,
      subject: 'Your WhatAisle store invitation',
      html: `<p>You have been invited to set up a WhatAisle store.</p><p><a href="${inviteUrl}">Accept your invitation</a>. This private link expires in 7 days.</p>`,
    });
    if (!result.success) {
      return { success: false as const, error: 'email_failed' as const };
    }
    return { success: true as const, expiresAt: expiresAt.toISOString() };
  });

export async function listCommercialOnboarding() {
  const db = await getDb();
  const [leads, invites] = await Promise.all([
    db.select().from(salesLead).orderBy(desc(salesLead.createdAt)).limit(100),
    db
      .select()
      .from(storeInvite)
      .orderBy(desc(storeInvite.createdAt))
      .limit(100),
  ]);
  return { leads, invites };
}
