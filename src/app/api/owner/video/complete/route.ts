import { Readable } from 'node:stream';
import { mappingRepo } from '@/data/mapping-repo';
import { getDb } from '@/db';
import { storeVideo } from '@/db/store.schema';
import { requirePaidOwnerStore } from '@/lib/require-owner-store';
import { notifyVideoUploaded } from '@/lib/video-upload-notification';
import {
  contentTypeForKey,
  getStorageProvider,
  isStoreStorageKey,
  type StorageProvider,
} from '@/storage';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_CHUNKS,
  VIDEO_CONTENT_TYPES,
} from '@/storage/video';
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 120;

const schema = z.object({ videoId: z.string().min(1) });

function chunkKey(storeId: string, videoId: string, index: number): string {
  return `stores/${storeId}/videos/${videoId}/chunk-${String(index).padStart(6, '0')}`;
}

function concatenateObjects(
  provider: StorageProvider,
  keys: string[]
): Readable {
  return Readable.from(
    (async function* () {
      for (const key of keys) {
        const object = await provider.stream(key);
        if (!object) throw new Error(`Missing video chunk: ${key}`);
        const reader = object.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) yield value;
          }
        } finally {
          reader.releaseLock();
        }
      }
    })()
  );
}

async function validateStoredVideo(
  provider: StorageProvider,
  key: string
): Promise<'missing' | 'invalid' | 'valid'> {
  const object = await provider.stream(key);
  if (!object) return 'missing';
  await object.body.cancel().catch(() => undefined);
  if (
    object.size <= 0 ||
    object.size > MAX_VIDEO_BYTES ||
    !VIDEO_CONTENT_TYPES.includes(
      object.contentType as (typeof VIDEO_CONTENT_TYPES)[number]
    )
  ) {
    return 'invalid';
  }
  return 'valid';
}

/**
 * Finalize a direct GCS upload or stream legacy chunks into one object. No
 * path buffers the complete video in application memory.
 */
export async function POST(req: NextRequest) {
  const access = await requirePaidOwnerStore();
  if ('error' in access) {
    return NextResponse.json(
      { error: access.error },
      { status: access.error === 'payment_required' ? 402 : 401 }
    );
  }
  const { store, ownerEmail } = access;
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
  const video = rows[0];
  if (!video?.storageKey || !isStoreStorageKey(video.storageKey, store.id)) {
    return NextResponse.json({ error: 'video_not_found' }, { status: 404 });
  }

  const provider = getStorageProvider();
  if (video.status === 'received') {
    const state = await validateStoredVideo(provider, video.storageKey);
    if (state !== 'valid') {
      return NextResponse.json({ error: 'video_not_found' }, { status: 404 });
    }
    const result = await mappingRepo(store.id).completeVideo(videoId);
    return NextResponse.json({ ok: true, ...result });
  }

  const received = new Set(video.chunksReceived ?? []);
  if (received.size === 0) {
    const state = await validateStoredVideo(provider, video.storageKey);
    if (state === 'missing') {
      return NextResponse.json({ error: 'incomplete' }, { status: 409 });
    }
    if (state === 'invalid') {
      await provider.delete(video.storageKey);
      return NextResponse.json({ error: 'invalid_video' }, { status: 413 });
    }
  } else {
    if (
      video.totalChunks <= 0 ||
      video.totalChunks > MAX_VIDEO_CHUNKS ||
      received.size !== video.totalChunks ||
      Array.from({ length: video.totalChunks }, (_, i) => i).some(
        (i) => !received.has(i)
      )
    ) {
      return NextResponse.json(
        {
          error: 'incomplete',
          received: received.size,
          total: video.totalChunks,
        },
        { status: 409 }
      );
    }

    const keys = Array.from({ length: video.totalChunks }, (_, index) =>
      chunkKey(store.id, videoId, index)
    );
    let totalSize = 0;
    for (let index = 0; index < keys.length; index++) {
      const object = await provider.stream(keys[index]);
      if (!object) {
        return NextResponse.json(
          { error: 'chunk_missing', index },
          { status: 409 }
        );
      }
      totalSize += object.size;
      await object.body.cancel().catch(() => undefined);
      if (totalSize > MAX_VIDEO_BYTES) {
        return NextResponse.json({ error: 'video_too_large' }, { status: 413 });
      }
    }

    try {
      await provider.put({
        key: video.storageKey,
        data: concatenateObjects(provider, keys),
        contentType: contentTypeForKey(video.storageKey),
        contentLength: totalSize,
        cacheControl: 'private, no-store',
      });
    } catch (error) {
      console.error('[video] failed to assemble chunks', error);
      return NextResponse.json(
        { error: 'upload_finalize_failed' },
        { status: 503 }
      );
    }

    await provider.deletePrefix(`stores/${store.id}/videos/${videoId}/`);
  }

  await db
    .update(storeVideo)
    .set({ storageKey: video.storageKey })
    .where(and(eq(storeVideo.storeId, store.id), eq(storeVideo.id, videoId)));

  const result = await mappingRepo(store.id).completeVideo(videoId);

  // Ops notification with a signed download link. Fire-and-forget: the
  // idempotent retry path above intentionally does not re-notify.
  notifyVideoUploaded({
    store,
    videoId,
    storageKey: video.storageKey,
    filename: video.filename,
    sizeBytes: video.sizeBytes,
    ownerEmail,
  }).catch((error) => console.error('[video] notify failed', error));

  return NextResponse.json(
    { ok: true, ...result },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
