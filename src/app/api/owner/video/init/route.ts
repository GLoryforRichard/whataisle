import { mappingRepo } from '@/data/mapping-repo';
import { getDb } from '@/db';
import { storeVideo } from '@/db/store.schema';
import { requireOwnerStore } from '@/lib/require-owner-store';
import { getStorageProvider } from '@/storage';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_CHUNKS,
  MAX_VIDEO_DURATION_SECONDS,
  VIDEO_CONTENT_TYPES,
  extensionForVideoType,
  videoTypeFromFilename,
} from '@/storage/video';
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  filename: z.string().max(255).optional(),
  contentType: z.enum(VIDEO_CONTENT_TYPES).optional(),
  sizeBytes: z.number().int().positive().max(MAX_VIDEO_BYTES).optional(),
  durationSeconds: z
    .number()
    .positive()
    .max(MAX_VIDEO_DURATION_SECONDS)
    .optional(),
  totalChunks: z.number().int().positive().max(MAX_VIDEO_CHUNKS),
});

/**
 * Start a resumable walk-through video upload. Returns a videoId + storage key
 * prefix; chunks are POSTed to /api/owner/video/chunk.
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

  const inferredType = videoTypeFromFilename(parsed.data.filename);
  if (!inferredType) {
    return NextResponse.json(
      { error: 'unsupported_video_type' },
      { status: 415 }
    );
  }
  if (parsed.data.contentType && parsed.data.contentType !== inferredType) {
    return NextResponse.json({ error: 'video_type_mismatch' }, { status: 400 });
  }
  const contentType = parsed.data.contentType ?? inferredType;

  const videoId = await mappingRepo(store.id).createVideo({
    storageKey: '',
    filename: parsed.data.filename ?? null,
    totalChunks: parsed.data.totalChunks,
  });

  const finalKey = `stores/${store.id}/videos/${videoId}.${extensionForVideoType(contentType)}`;
  const originHeader = req.headers.get('origin');
  const requestHost = req.headers.get('host');
  let origin: string | undefined;
  try {
    if (originHeader && new URL(originHeader).host === requestHost) {
      origin = originHeader;
    }
  } catch {
    // Invalid Origin is ignored; the session remains usable outside browsers.
  }

  try {
    const upload = await getStorageProvider().createResumableUpload({
      key: finalKey,
      contentType,
      contentLength: parsed.data.sizeBytes,
      origin,
    });

    const db = await getDb();
    await db
      .update(storeVideo)
      .set({ storageKey: finalKey })
      .where(and(eq(storeVideo.storeId, store.id), eq(storeVideo.id, videoId)));

    return NextResponse.json(
      { videoId, upload },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.error('[video] failed to initialize upload', error);
    const db = await getDb();
    await db
      .delete(storeVideo)
      .where(and(eq(storeVideo.storeId, store.id), eq(storeVideo.id, videoId)));
    return NextResponse.json({ error: 'upload_init_failed' }, { status: 503 });
  }
}
