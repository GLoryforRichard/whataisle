import { getDb } from '@/db';
import { storeVideo } from '@/db/store.schema';
import { getSession } from '@/lib/server';
import { getStorageProvider, isStoreStorageKey } from '@/storage';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Download a store walk-through video — founder/admin only. Videos are
 * platform-internal (requirements §10) and are never served on any
 * store-facing surface.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (session?.user?.role !== 'admin') {
    return new NextResponse(null, { status: 403 });
  }

  const { id } = await params;
  const db = await getDb();
  const rows = await db
    .select()
    .from(storeVideo)
    .where(eq(storeVideo.id, id))
    .limit(1);
  const video = rows[0];
  if (
    !video?.storageKey ||
    !isStoreStorageKey(video.storageKey, video.storeId)
  ) {
    return new NextResponse(null, { status: 404 });
  }

  const object = await getStorageProvider().stream(video.storageKey);
  if (!object) {
    return new NextResponse(null, { status: 404 });
  }

  const filename = (video.filename ?? 'walkthrough.mp4').replace(
    /[\r\n"]/g,
    '_'
  );
  return new NextResponse(object.body, {
    headers: {
      'Content-Type': object.contentType,
      'Content-Length': String(object.size),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
