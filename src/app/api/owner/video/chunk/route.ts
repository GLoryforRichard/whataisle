import { mappingRepo } from '@/data/mapping-repo';
import { requireOwnerStore } from '@/lib/require-owner-store';
import { putBuffer } from '@/storage/local-store';
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
    !(chunk instanceof Blob)
  ) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const buffer = Buffer.from(await chunk.arrayBuffer());
  // Chunk key is scoped to the store so the files ACL applies.
  await putBuffer(
    `stores/${store.id}/videos/${videoId}/chunk-${String(chunkIndex).padStart(6, '0')}`,
    buffer
  );

  const progress = await mappingRepo(store.id).recordChunk(
    videoId,
    chunkIndex,
    buffer.length
  );
  if (!progress) {
    return NextResponse.json({ error: 'video_not_found' }, { status: 404 });
  }
  return NextResponse.json(progress);
}
