import { processShelfPhoto } from '@/ai/scan-service';
import { productRepo } from '@/data/product-repo';
import { requireStaff } from '@/lib/require-staff';
import { nanoid } from 'nanoid';
import { type NextRequest, NextResponse } from 'next/server';

// Dense shelves (50+ product types) measured ~117s end-to-end through the
// full rows-hd + grid-readout pipeline — 120 was too tight a ceiling.
export const maxDuration = 180;

/**
 * Process one shelf photo (multipart: shelfId, image).
 *
 * One route call per photo so a single failure never blocks the batch
 * (requirements §4.2). Returns the deduped detected products with thumbnail
 * data URLs for the staff to review before saving.
 */
export async function POST(req: NextRequest) {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const shelfId = form.get('shelfId');
  const file = form.get('image');
  if (typeof shelfId !== 'string' || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const repo = productRepo(staff.store.id);
  const shelf = await repo.resolveShelf(shelfId);
  if (!shelf) {
    return NextResponse.json({ error: 'shelf_not_found' }, { status: 404 });
  }

  const photoId = nanoid();
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const shelfContext = `${shelf.code}${shelf.label ? ` — ${shelf.label}` : ''}`;
    const result = await processShelfPhoto({
      storeId: staff.store.id,
      shelfId,
      shelfContext,
      imageBuffer: buffer,
      photoId,
    });
    return NextResponse.json({
      photoId,
      storageKey: result.storageKey,
      products: result.products,
    });
  } catch (err) {
    console.error('[scan] photo processing failed:', err);
    return NextResponse.json(
      { photoId, error: 'processing_failed' },
      { status: 500 }
    );
  }
}
