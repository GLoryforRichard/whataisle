import { mappingRepo } from '@/data/mapping-repo';
import { getDb } from '@/db';
import { storeVideo } from '@/db/store.schema';
import { requireOwnerStore } from '@/lib/require-owner-store';
import { getStorageProvider } from '@/storage';
import { MAX_VIDEO_CHUNKS, VIDEO_CHUNK_BYTES } from '@/storage/video';
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * Receive one video chunk (multipart: videoId, chunkIndex, chunk).
 *
 * Idempotent — re-uploading a chunk after a network drop just overwrites it,
 * so uploads resume without restarting (requirements §6). Chunks are stitched
 * on /complete.
 */
export async function POST(req: NextRequest) {
  const store = await requireOwnerStore();
  if (!store) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const videoId = form.get('videoId');
  const chunkIndex = Number(form.get('chunkIndex'));
  const chunk = form.get('chunk');
  if (
    typeof videoId !== 'string' ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    !(chunk instanceof Blob) ||
    chunk.size <= 0 ||
    chunk.size > VIDEO_CHUNK_BYTES
  ) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const db = await getDb();
  const videos = await db
    .select()
    .from(storeVideo)
    .where(and(eq(storeVideo.storeId, store.id), eq(storeVideo.id, videoId)))
    .limit(1);
  const video = videos[0];
  if (!video) {
    return NextResponse.json({ error: 'video_not_found' }, { status: 404 });
  }
  if (
    video.status !== 'uploading' ||
    video.totalChunks > MAX_VIDEO_CHUNKS ||
    chunkIndex >= video.totalChunks
  ) {
    return NextResponse.json({ error: 'invalid_chunk' }, { status: 409 });
  }

  const buffer = Buffer.from(await chunk.arrayBuffer());
  const chunkKey = `stores/${store.id}/videos/${videoId}/chunk-${String(chunkIndex).padStart(6, '0')}`;
  await getStorageProvider().put({
    key: chunkKey,
    data: buffer,
    contentType: 'application/octet-stream',
    cacheControl: 'private, no-store',
  });

  const wasAlreadyReceived = new Set(video.chunksReceived ?? []).has(
    chunkIndex
  );
  const progress = await mappingRepo(store.id).recordChunk(
    videoId,
    chunkIndex,
    wasAlreadyReceived ? 0 : buffer.length
  );
  if (!progress) {
    await getStorageProvider().delete(chunkKey);
    return NextResponse.json({ error: 'video_not_found' }, { status: 404 });
  }
  return NextResponse.json(progress, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
