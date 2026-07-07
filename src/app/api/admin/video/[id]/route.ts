import { getDb } from '@/db';
import { storeVideo } from '@/db/store.schema';
import { getSession } from '@/lib/server';
import { getBuffer } from '@/storage/local-store';
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
  if (!video?.storageKey) {
    return new NextResponse(null, { status: 404 });
  }

  const buffer = await getBuffer(video.storageKey);
  if (!buffer) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${video.filename ?? 'walkthrough.mp4'}"`,
    },
  });
}
