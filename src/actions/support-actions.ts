'use server';

import { getDb } from '@/db';
import { announcement, supportTicket } from '@/db/store.schema';
import { adminActionClient, storeActionClient } from '@/lib/safe-action';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

/**
 * Support ticket + announcement actions (requirements §7). Owner ticket
 * reporting auto-attaches store identity and context; admin actions manage
 * tickets and broadcast announcements.
 */

export const reportIssueAction = storeActionClient
  .schema(
    z.object({
      subject: z.string().trim().min(1).max(200),
      body: z.string().trim().max(2000).optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const db = await getDb();
    await db.insert(supportTicket).values({
      id: nanoid(),
      storeId: ctx.store.id,
      openedVia: 'owner',
      subject: parsedInput.subject,
      body: parsedInput.body,
      contextJson: {
        handle: ctx.store.handle,
        displayName: ctx.store.displayName,
        status: ctx.store.status,
      },
    });
    return { success: true as const };
  });

export const closeTicketAction = adminActionClient
  .schema(z.object({ ticketId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const db = await getDb();
    await db
      .update(supportTicket)
      .set({ status: 'closed' })
      .where(eq(supportTicket.id, parsedInput.ticketId));
    return { success: true as const };
  });

export const createAnnouncementAction = adminActionClient
  .schema(
    z.object({
      title: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(2000),
      titleZh: z.string().trim().max(200).optional(),
      bodyZh: z.string().trim().max(2000).optional(),
    })
  )
  .action(async ({ parsedInput }) => {
    const db = await getDb();
    await db.insert(announcement).values({
      id: nanoid(),
      title: parsedInput.title,
      body: parsedInput.body,
      titleZh: parsedInput.titleZh || null,
      bodyZh: parsedInput.bodyZh || null,
    });
    return { success: true as const };
  });
