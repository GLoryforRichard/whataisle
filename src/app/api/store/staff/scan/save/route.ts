import { saveScannedProducts } from '@/ai/scan-service';
import { productRepo } from '@/data/product-repo';
import { getDb } from '@/db';
import { scanBatch, scanPhoto } from '@/db/store.schema';
import { requireStaff } from '@/lib/require-staff';
import { nanoid } from 'nanoid';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 120;

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
        facesBlurred: z.number().int().nonnegative().optional(),
        detectedCount: z.number().int().nonnegative().optional(),
      })
    )
    .max(50)
    .optional(),
});

/**
 * Save reviewed products to store memory. Generates aliases + embeddings,
 * upserts products (bumping "seen N×"), records shelf locations, and logs the
 * scan batch/photos.
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

  try {
    // Record the scan batch + photos for the evidence trail.
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
          facesBlurred: (p.facesBlurred ?? 0) > 0,
          detectedCount: p.detectedCount ?? 0,
          processedAt: new Date(),
        }))
      );
    }

    const shelfContext = `${shelf.code}${shelf.label ? ` — ${shelf.label}` : ''}`;
    const result = await saveScannedProducts({
      storeId: staff.store.id,
      shelfId,
      shelfContext,
      products,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[scan] save failed:', err);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
