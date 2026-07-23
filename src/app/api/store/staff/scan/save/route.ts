import { saveScannedProducts } from '@/ai/scan-service';
import { productRepo } from '@/data/product-repo';
import { getDb } from '@/db';
import { scanBatch, scanPhoto } from '@/db/store.schema';
import { requireStaff } from '@/lib/require-staff';
import { nanoid } from 'nanoid';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 120;

/** Friendly bilingual labels for the streamed pipeline steps. */
const STEP_LABELS: Record<string, { labelEn: string; labelZh: string }> = {
  evidence: { labelEn: 'Remembering this shelf', labelZh: '记住这个货架' },
  aliases: {
    labelEn: 'Learning its names in every language',
    labelZh: '学习它的多语言名称',
  },
  embed: { labelEn: 'Building search memory', labelZh: '生成搜索记忆' },
  save: { labelEn: "Saving to the store's memory", labelZh: '写入门店记忆' },
};

const bodySchema = z.object({
  shelfId: z.string().min(1),
  products: z
    .array(
      z.object({
        canonicalName: z.string().trim().min(1).max(200),
        category: z.string().max(50).nullable().optional(),
        thumbnailDataUrl: z.string().max(600_000).nullable().optional(),
      })
    )
    .min(1)
    .max(200),
  photos: z
    .array(
      z.object({
        storageKey: z.string(),
        detectedCount: z.number().int().nonnegative().optional(),
      })
    )
    .max(50)
    .optional(),
});

/**
 * Save reviewed products to store memory, streaming pipeline progress as SSE
 * (wherebear-style "how it's remembering" steps): `step` events while it
 * records evidence / learns aliases / embeds / upserts, then a final `done`
 * event with {saved, created, updated} — or `error`.
 */
export async function POST(req: NextRequest) {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const { shelfId, products, photos } = parsed.data;

  const repo = productRepo(staff.store.id);
  const shelf = await repo.resolveShelf(shelfId);
  if (!shelf) {
    return NextResponse.json({ error: 'shelf_not_found' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };
      const step = (key: string, status: 'start' | 'done') => {
        send('step', { key, status, ...STEP_LABELS[key] });
      };
      try {
        // Record the scan batch + photos for the evidence trail.
        step('evidence', 'start');
        const db = await getDb();
        const batchId = nanoid();
        await db.insert(scanBatch).values({
          id: batchId,
          storeId: staff.store.id,
          shelfId,
          source: 'staff',
        });
        if (photos && photos.length > 0) {
          await db.insert(scanPhoto).values(
            photos.map((p) => ({
              id: nanoid(),
              storeId: staff.store.id,
              batchId,
              shelfId,
              storageKey: p.storageKey,
              status: 'done' as const,
              facesBlurred: false,
              detectedCount: p.detectedCount ?? 0,
              processedAt: new Date(),
            }))
          );
        }
        step('evidence', 'done');

        const shelfContext = `${shelf.code}${shelf.label ? ` — ${shelf.label}` : ''}`;
        const result = await saveScannedProducts({
          storeId: staff.store.id,
          shelfId,
          shelfContext,
          products,
          onStep: step,
        });

        send('done', result);
      } catch (err) {
        console.error('[scan] save failed:', err);
        send('error', { error: 'save_failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
