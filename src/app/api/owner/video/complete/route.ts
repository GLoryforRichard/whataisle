import { mappingRepo } from '@/data/mapping-repo';
import { getDb } from '@/db';
import { storeVideo } from '@/db/store.schema';
import { requireOwnerStore } from '@/lib/require-owner-store';
import { deleteObject, getBuffer, putBuffer } from '@/storage/local-store';
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 120;

const schema = z.object({ videoId: z.string().min(1) });

/**
 * Finalize a resumable upload: stitch the received chunks into one video file,
 * mark it received, and open/refresh the mapping ticket (requirements §6).
 *
 * Local-dev stitches in memory; the production GCS driver would use compose.
 */
export async function POST(req: NextRequest) {
  const store = await requireOwnerStore();
  if (!store) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const { videoId } = parsed.data;

  const db = await getDb();
  const rows = await db
    .select()
    .from(storeVideo)
    .where(and(eq(storeVideo.storeId, store.id), eq(storeVideo.id, videoId)))
    .limit(1);
  const v = rows[0];
  if (!v) {
    return NextResponse.json({ error: 'video_not_found' }, { status: 404 });
  }

  const received = new Set(v.chunksReceived ?? []);
  if (received.size < v.totalChunks) {
    return NextResponse.json(
      { error: 'incomplete', received: received.size, total: v.totalChunks },
      { status: 409 }
    );
  }

  // Stitch chunks in order.
  const parts: Buffer[] = [];
  for (let i = 0; i < v.totalChunks; i++) {
    const key = `stores/${store.id}/videos/${videoId}/chunk-${String(i).padStart(6, '0')}`;
    const buf = await getBuffer(key);
    if (!buf) {
      return NextResponse.json(
        { error: 'chunk_missing', index: i },
        { status: 409 }
      );
    }
    parts.push(buf);
  }
  const finalKey = `stores/${store.id}/videos/${videoId}.mp4`;
  await putBuffer(finalKey, Buffer.concat(parts));

  // Clean up chunk files.
  for (let i = 0; i < v.totalChunks; i++) {
    await deleteObject(
      `stores/${store.id}/videos/${videoId}/chunk-${String(i).padStart(6, '0')}`
    );
  }

  await db
    .update(storeVideo)
    .set({ storageKey: finalKey })
    .where(eq(storeVideo.id, videoId));

  const result = await mappingRepo(store.id).completeVideo(videoId);
  return NextResponse.json({ ok: true, ...result });
}
