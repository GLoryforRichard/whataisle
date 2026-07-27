'use server';

import { getDb } from '@/db';
import { salesLead } from '@/db/store.schema';
import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit, hashIp } from '@/lib/rate-limit';
import { adminActionClient, actionClient } from '@/lib/safe-action';
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

export async function listCommercialOnboarding() {
  const db = await getDb();
  const leads = await db
    .select()
    .from(salesLead)
    .orderBy(desc(salesLead.createdAt))
    .limit(100);
  return { leads };
}
